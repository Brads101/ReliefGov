import { supabaseAdmin } from '../lib/supabase.js';
import { badRequest, forbidden, notFound, HttpError, unavailable } from '../lib/errors.js';
import { ROLES } from './authService.js';
import { scoreRecordAsync, modelStatusAsync } from '../ml/backend.js';
import { CLASSES, MANUAL_CATEGORY_INDEX, SCORABLE_STATUSES, MODEL_VERSION } from '../ml/config.js';
import { indicatorSnapshot, snapshotChanged } from '../ml/features.js';
import { notifyRole } from './notificationService.js';

/**
 * Random Forest Vulnerability Scoring module (Batch 5).
 *
 * Responsibilities of this service:
 *  1. Score validated beneficiary records (Under Verification / Approved)
 *     with the Random Forest model and store each run as an auditable row
 *     in `vulnerability_scores` (model version, scoring date, input record
 *     reference, result, indicators, probabilities, explanation).
 *  2. Keep the full score HISTORY: a new run supersedes the previous
 *     current score; nothing is ever deleted.
 *  3. Detect STALE scores — when the documented indicators (the four
 *     profile indicators plus the attached damage-photo evidence flag)
 *     change after scoring, or when the stored score came from an older
 *     model version than the one currently configured, the score no longer
 *     matches what a fresh run would produce.
 *  4. Let CSWD flag a questionable score and record an authorized manual
 *     correction (reason required; attributed and timestamped).
 *  5. Expose honest model status: dataset provenance (historical for the
 *     collected-records model; the legacy 'synthetic' label survives only on
 *     rows scored by the earlier model), evaluation metrics measured on the
 *     200 held-out rows the notebook withheld from fitting (with the
 *     full-data figure labelled separately as training-set agreement),
 *     feature list, and availability.
 *
 * HONESTY & FAIRNESS RULES ENFORCED HERE:
 *  - Every score the CURRENT model produces carries dataset_type =
 *    'historical' (collected household records). Rows scored by the retired
 *    synthetic model keep dataset_type = 'synthetic' forever so the record
 *    never misrepresents where its number came from.
 *  - Scores never change application_status, validation_status, or
 *    eligibility. The model is decision-support only; the human review step
 *    for assistance decisions stays in applicationService (CSWD).
 *  - Scored rows are read-only for staff clients (server writes with the
 *    service role; RLS gives staff SELECT ONLY).
 *  - Tambacan-only: everything in this module is scoped to Barangay
 *    Tambacan inside the service layer, never from client input.
 */

const STAFF_ROLES = [ROLES.BARANGAY_STAFF, ROLES.CSWD_STAFF];

const SCORE_COLUMNS =
  'id, beneficiary_id, model_version, score, class, top_factors, evaluated_on, ' +
  'status, source, dataset_type, probabilities, confidence, indicator_snapshot, ' +
  'scored_by, corrected_by, correction_reason, flag_note, flagged_by, flagged_at, created_at';

const RECORD_COLUMNS =
  'id, beneficiary_number, first_name, middle_name, last_name, sex, date_of_birth, is_pwd, ' +
  'purok, barangay, household_size, income_level, damage_extent, house_status, housing_type, ' +
  'application_status, validation_status, vulnerability_score, vulnerability_class, submitted_at, updated_at';

/** States a staff list row can be in, in display priority order. */
const STATES = Object.freeze(['flagged', 'stale', 'scored', 'missing']);

const SORT_KEYS = Object.freeze(['score', 'class', 'name', 'date']);

function admin() {
  if (!supabaseAdmin) {
    throw unavailable('The Vulnerability Scoring module requires Supabase configuration on the server.');
  }
  return supabaseAdmin;
}

function assertStaff(user) {
  if (!user || !STAFF_ROLES.includes(user.role)) {
    throw forbidden('Only barangay and CSWD staff can use the scoring module.');
  }
}

const isCswd = (user) => user?.role === ROLES.CSWD_STAFF;

const fullName = (row) =>
  [row?.first_name, row?.middle_name, row?.last_name].filter(Boolean).join(' ');

async function audit(actorId, action, entityId, detail) {
  try {
    await admin().from('audit_logs').insert({
      actor_id: actorId,
      action,
      entity: 'vulnerability_scores',
      entity_id: entityId,
      detail
    });
  } catch (err) {
    console.warn('[ReliefGov] audit log write failed:', err.message);
  }
}

/**
 * Loads a beneficiary record for scoring. Drafts and anything outside
 * Tambacan are 404 (consistent with the validation module).
 *
 * The record is enriched with the documentary damage-evidence flag
 * (`damage_photo`: 1 when a non-rejected "Damage photos" document is on
 * file) before it leaves this service — the ML backends only ever receive
 * plain record fields and never query the database themselves.
 */
async function getRecordOrThrow(id) {
  const { data, error } = await admin()
    .from('beneficiaries')
    .select(RECORD_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data || data.barangay !== 'Tambacan' || data.application_status === 'Draft') {
    throw notFound('Beneficiary record not found.');
  }
  return withDamageEvidence(data);
}

/**
 * Beneficiary ids that have documentary damage evidence on file: at least
 * one `Damage photos` document that staff has not rejected. Rejected
 * evidence never reaches the model.
 */
async function loadDamagePhotoSet(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (unique.length === 0) return new Set();
  const { data, error } = await admin()
    .from('documents')
    .select('beneficiary_id')
    .in('beneficiary_id', unique)
    .eq('purpose', 'Damage photos')
    .neq('status', 'Rejected');
  if (error) throw new HttpError(500, error.message);
  return new Set((data || []).map((d) => d.beneficiary_id));
}

async function loadSupportingDocsSet(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (unique.length === 0) return new Set();
  const { data, error } = await admin()
    .from('documents')
    .select('beneficiary_id')
    .in('beneficiary_id', unique)
    .neq('status', 'Rejected');
  if (error) return new Set();
  return new Set((data || []).map((d) => d.beneficiary_id));
}

/** Returns the record with documentary evidence flags from its documents. */
async function withDamageEvidence(record) {
  const [photoSet, docSet] = await Promise.all([
    loadDamagePhotoSet([record.id]),
    loadSupportingDocsSet([record.id])
  ]);
  const isFlood = record.purok
    ? /purok\s*0?[1-4](?:[a-z\-]|$)/i.test(String(record.purok).trim())
    : record.housing_type === 'Yes' || record.location_flood_exposure === 'Yes';
  return {
    ...record,
    location_flood_exposure: isFlood ? 'Yes' : 'No',
    damage_photo: photoSet.has(record.id) ? 1 : 0,
    supporting_documents_complete: docSet.has(record.id) ? 'Yes' : 'No'
  };
}

/**
 * A MODEL-produced score computed with an older pipeline than the one
 * currently configured is stale too (re-run recommended). Manual
 * corrections are exempt — they are the reviewer's standing decision, not
 * a model artifact.
 */
const isModelStale = (score) => Boolean(score) && score.source === 'model' && score.model_version !== MODEL_VERSION;

/** The current (non-superseded) score for a record, or null. */
async function currentScore(beneficiaryId) {
  const { data, error } = await admin()
    .from('vulnerability_scores')
    .select(SCORE_COLUMNS)
    .eq('beneficiary_id', beneficiaryId)
    .eq('status', 'current')
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return data || null;
}

/* ------------------------------------------------------------------ */
/* Model status                                                        */
/* ------------------------------------------------------------------ */

/**
 * Honest model status — never claims more than what is loaded and
 * measured. `evaluation.evaluatedOn` states in full that the headline
 * figures come from the 200 rows the notebook held out of training — an
 * internal hold-out, never presented as external or real-world validity
 * evidence — while `evaluation.fullDataAgreement` keeps the 1,000-row
 * figure explicitly labelled as training-set agreement.
 */
export async function getModelStatus() {
  return modelStatusAsync();
}

/* ------------------------------------------------------------------ */
/* Scoring list                                                        */
/* ------------------------------------------------------------------ */

function stateOf(record, score) {
  if (!score) return 'missing';
  if (score.flagged_at) return 'flagged';
  if (snapshotChanged(record, score.indicator_snapshot) || isModelStale(score)) return 'stale';
  return 'scored';
}

/**
 * Staff scoring list — Tambacan only. Each row carries the current score
 * (or null), the derived state (missing / stale / flagged / scored), and
 * a `dataset_badge` so demo data is always labelled.
 */
export async function listScores(user, filters = {}) {
  assertStaff(user);
  const search = String(filters.search || '').trim().replace(/[%_,()]/g, '');
  const klass = String(filters.class || '').trim();
  const state = String(filters.state || '').trim();
  const sort = String(filters.sort || 'score').trim();
  const order = String(filters.order || 'desc').trim();
  const from = String(filters.from || '').trim();
  const to = String(filters.to || '').trim();
  const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 100);
  const offset = Math.max(Number(filters.offset) || 0, 0);

  if (klass && !CLASSES.includes(klass)) {
    throw badRequest('Unknown priority class filter.', {
      class: `Must be one of: ${CLASSES.join(', ')}.`
    });
  }
  if (state && !STATES.includes(state)) {
    throw badRequest('Unknown score state filter.', {
      state: `Must be one of: ${STATES.join(', ')}.`
    });
  }
  if (from && Number.isNaN(Date.parse(from))) {
    throw badRequest('Invalid submission date filter.', { from: 'Use a valid date (YYYY-MM-DD).' });
  }
  if (to && Number.isNaN(Date.parse(to))) {
    throw badRequest('Invalid submission date filter.', { to: 'Use a valid date (YYYY-MM-DD).' });
  }
  if (from && to && Date.parse(from) > Date.parse(to)) {
    throw badRequest('The submission date range is inverted.', { from: 'Start date must be on or before the end date.' });
  }
  if (!SORT_KEYS.includes(sort)) {
    throw badRequest('Unknown sort key.', { sort: `Must be one of: ${SORT_KEYS.join(', ')}.` });
  }
  if (order !== 'asc' && order !== 'desc') {
    throw badRequest('Unknown sort order.', { order: "Use 'asc' or 'desc'." });
  }

  let query = admin()
    .from('beneficiaries')
    .select(RECORD_COLUMNS, { count: 'exact' })
    .eq('barangay', 'Tambacan')
    .neq('application_status', 'Draft');

  if (from) query = query.gte('submitted_at', new Date(`${from}T00:00:00`).toISOString());
  if (to) query = query.lte('submitted_at', new Date(`${to}T23:59:59.999`).toISOString());

  if (search) {
    query = query.or(
      `first_name.ilike.%${search}%,last_name.ilike.%${search}%,beneficiary_number.ilike.%${search}%`
    );
  }

  const { data, error, count } = await query;
  if (error) throw new HttpError(500, `Failed to read the scoring list: ${error.message}`);

  const records = data || [];
  // Documentary damage evidence (attached, non-rejected photo) travels with
  // every row so staleness and the "indicators" preview reflect what the
  // model would actually see on a fresh run.
  const photoSet = await loadDamagePhotoSet(records.map((r) => r.id));
  const enriched = records.map((r) => ({ ...r, damage_photo: photoSet.has(r.id) ? 1 : 0 }));
  const scores = await Promise.all(enriched.map((r) => currentScore(r.id)));

  let all = enriched.map((record, i) => {
    const score = scores[i];
    return {
      id: record.id,
      beneficiary_number: record.beneficiary_number,
      full_name: fullName(record),
      purok: record.purok,
      application_status: record.application_status,
      vulnerability_class: score ? score.class : null,
      score: score ? Number(score.score) : null,
      confidence: score && score.confidence !== null ? Number(score.confidence) : null,
      source: score ? score.source : null,
      dataset_type: score ? score.dataset_type : null,
      scored_at: score ? score.created_at : null,
      submitted_at: record.submitted_at,
      flagged: Boolean(score?.flagged_at),
      state: stateOf(record, score),
      indicators: score ? score.indicator_snapshot : indicatorSnapshot(record),
      scorable: SCORABLE_STATUSES.includes(record.application_status)
    };
  });

  // Counts describe the whole (search-filtered) dataset so the UI can show
  // filter chips with real totals; state/class filters then narrow the rows.
  const counts = {
    total: all.length,
    scored: all.filter((r) => r.state !== 'missing').length,
    missing: all.filter((r) => r.state === 'missing').length,
    stale: all.filter((r) => r.state === 'stale').length,
    flagged: all.filter((r) => r.state === 'flagged').length
  };

  let rows = all;
  if (state) rows = rows.filter((r) => r.state === state);
  if (klass) rows = rows.filter((r) => r.vulnerability_class === klass);

  const dir = order === 'asc' ? 1 : -1;
  const classRank = Object.fromEntries(CLASSES.map((c, i) => [c, i]));
  rows.sort((a, b) => {
    if (sort === 'name') return dir * a.full_name.localeCompare(b.full_name);
    if (sort === 'date') {
      const av = a.scored_at ? Date.parse(a.scored_at) : -Infinity;
      const bv = b.scored_at ? Date.parse(b.scored_at) : -Infinity;
      return dir * (av - bv);
    }
    if (sort === 'class') {
      // Rows recorded before the category list was reduced to three may carry
      // a retired category — it ranks above the current top class so legacy
      // audit rows still sort correctly instead of producing NaN ordering.
      const rankOf = (c) => (c ? (classRank[c] ?? CLASSES.length) : -1);
      const av = rankOf(a.vulnerability_class);
      const bv = rankOf(b.vulnerability_class);
      return dir * (av - bv);
    }
    // sort=score: unscored rows always sort last regardless of direction.
    if (a.score === null && b.score === null) return a.full_name.localeCompare(b.full_name);
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return dir * (a.score - b.score);
  });

  const page = rows.slice(offset, offset + limit);

  return {
    total: rows.length,
    counts,
    rows: page,
    model: await publicModelSummary(),
    scope: { barangay: 'Tambacan', city: 'Iligan City', province: 'Lanao del Norte' },
    filters_applied: { search, class: klass, state, sort, order }
  };
}

/** Compact, honest model block embedded in list responses. */
async function publicModelSummary() {
  const status = await modelStatusAsync();
  if (!status.available) {
    return { available: false, reason: status.reason, modelVersion: status.modelVersion };
  }
  return {
    available: true,
    modelVersion: status.modelVersion,
    trainedAt: status.trainedAt,
    datasetType: status.dataset.type,
    datasetLabel: status.dataset.label,
    disclaimer: status.dataset.disclaimer
  };
}

/* ------------------------------------------------------------------ */
/* Scoring detail                                                      */
/* ------------------------------------------------------------------ */

/**
 * Full scoring bundle for one record: current score, complete history
 * (superseded rows included — auditability), live staleness comparison,
 * capabilities for the acting user, and honest model status.
 */
export async function getDetail(user, id) {
  assertStaff(user);
  const record = await getRecordOrThrow(id);

  const { data: history, error } = await admin()
    .from('vulnerability_scores')
    .select(SCORE_COLUMNS)
    .eq('beneficiary_id', id)
    .order('created_at', { ascending: false });
  if (error) throw new HttpError(500, error.message);

  const current = (history || []).find((r) => r.status === 'current') || null;
  const liveIndicators = indicatorSnapshot(record);
  const stale = current
    ? snapshotChanged(record, current.indicator_snapshot) || isModelStale(current)
    : false;

  return {
    record: {
      ...record,
      full_name: fullName(record)
    },
    indicators: liveIndicators,
    current: current ? shapeScore(current, { stale }) : null,
    history: (history || []).map((row) =>
      shapeScore(row, { stale: row.status === 'current' && stale })
    ),
    state: stateOf(record, current),
    scorable: SCORABLE_STATUSES.includes(record.application_status),
    model: await modelStatusAsync(),
    capabilities: capabilitiesFor(user, record, current)
  };
}

function capabilitiesFor(user, record, current) {
  const cswd = isCswd(user);
  const scorable = SCORABLE_STATUSES.includes(record.application_status);
  return {
    // Computing or re-running a score is a CSWD action; barangay staff get a
    // read-only view of the same scores (UI hides the control, the API refuses).
    canScore: scorable && cswd,
    canFlag: Boolean(current) && cswd,
    canCorrect: Boolean(current) && cswd,
    isCswd: cswd,
    scorableStatuses: SCORABLE_STATUSES,
    note: null
  };
}

function shapeScore(row, { stale }) {
  return {
    id: row.id,
    beneficiary_id: row.beneficiary_id,
    status: row.status,
    source: row.source,
    model_version: row.model_version,
    score: Number(row.score),
    class: row.class,
    probabilities: row.probabilities || null,
    confidence: row.confidence !== null ? Number(row.confidence) : null,
    dataset_type: row.dataset_type,
    evaluated_on: row.evaluated_on,
    indicators: row.indicator_snapshot,
    top_factors: row.top_factors || [],
    scored_by: row.scored_by,
    scored_at: row.created_at,
    corrected_by: row.corrected_by,
    correction_reason: row.correction_reason,
    flag_note: row.flag_note,
    flagged_by: row.flagged_by,
    flagged_at: row.flagged_at,
    stale
  };
}

/* ------------------------------------------------------------------ */
/* Run / rescore                                                       */
/* ------------------------------------------------------------------ */

/**
 * Runs the Random Forest on one validated record.
 *
 * Rules:
 *  - CSWD Staff only. Barangay Staff may view scores, but generating or
 *    re-running them is refused with 403 (no API bypass of the UI control).
 *  - Only records in a SCORABLE status (Under Verification / Approved)
 *    are scored — the model input must be validated beneficiary data.
 *  - If a fresh current score already exists, the run is idempotent
 *    (`unchanged: true`) unless `force: true` is passed.
 *  - Each run appends a new row and supersedes the previous current score
 *    — full history is preserved for audit.
 *  - The beneficiaries mirror columns (vulnerability_score/class) are
 *    updated so dashboards, reports, and the applicant's own view stay in
 *    step.
 *  - Model unavailability answers 503 with actionable guidance; missing or
 *    invalid indicators answer 400 with per-indicator details. Nothing is
 *    ever fabricated.
 */
export async function runScore(user, id, body = {}) {
  assertStaff(user);
  // Model generation / regeneration is a CSWD action. Barangay Staff can view
  // scores but cannot create, re-run or refresh them — enforced here so a
  // direct API call cannot bypass the hidden UI control.
  if (!isCswd(user)) {
    throw forbidden('Only CSWD Staff can generate or regenerate vulnerability scores.');
  }
  const record = await getRecordOrThrow(id);

  if (!SCORABLE_STATUSES.includes(record.application_status)) {
    throw new HttpError(409,
      `A vulnerability score can only be computed for records with status: ` +
      `${SCORABLE_STATUSES.join(' or ')}. This record is "${record.application_status}".`,
      { application_status: record.application_status, scorable_statuses: SCORABLE_STATUSES }
    );
  }

  const existing = await currentScore(id);
  const force = body.force === true || body.force === 'true';

  if (
    existing &&
    !snapshotChanged(record, existing.indicator_snapshot) &&
    !isModelStale(existing) &&
    !force
  ) {
    // Fresh score already exists (model OR authorized correction) — no
    // duplicate rows for the same inputs, and a standing correction is only
    // replaced when staff explicitly forces a re-run. A score produced by an
    // OLDER model version is not "fresh": it re-runs so the queue never sits
    // on results the current pipeline would no longer produce.
    return { unchanged: true, score: shapeScore(existing, { stale: false }) };
  }

  // scoreRecordAsync validates the four indicators (throws 400 with details)
  // and throws 503 when the configured ML backend cannot produce a score.
  const result = await scoreRecordAsync(record);

  const snapshot = indicatorSnapshot(record);

  // The partial unique index allows only ONE current row per beneficiary,
  // so the previous current score must be superseded before the new row is
  // inserted (and restored if the insert fails — no score is ever lost).
  const previous = existing;
  if (previous) {
    const { error: supErr } = await admin()
      .from('vulnerability_scores')
      .update({ status: 'superseded' })
      .eq('id', previous.id)
      .eq('status', 'current');
    if (supErr) throw new HttpError(500, `Failed to archive the previous score: ${supErr.message}`);
  }

  let inserted;
  try {
    const { data, error } = await admin()
      .from('vulnerability_scores')
      .insert({
        beneficiary_id: id,
        model_version: result.modelVersion,
        score: result.priorityIndex,
        class: result.class,
        top_factors: (result.explanation || []).map((e) => ({
          indicator: e.indicator,
          value: e.value,
          deviation: e.deviation,
          split_share: e.splitShare
        })),
        evaluated_on: result.datasetLabel,
        status: 'current',
        source: 'model',
        dataset_type: result.datasetType === 'synthetic-development' ? 'synthetic' : 'historical',
        probabilities: result.probabilities,
        confidence: result.confidence,
        indicator_snapshot: snapshot,
        scored_by: user.id
      })
      .select(SCORE_COLUMNS)
      .single();
    if (error) throw new HttpError(500, `Failed to store the score: ${error.message}`);
    inserted = data;
  } catch (err) {
    // Restore the archived row as current so the record keeps its score.
    if (previous) {
      await admin()
        .from('vulnerability_scores')
        .update({ status: 'current' })
        .eq('id', previous.id);
    }
    throw err;
  }

  await syncMirror(record, {
    score: result.priorityIndex,
    klass: result.class
  });
  await audit(user.id, 'scoring.run', inserted.id, {
    beneficiary_id: id,
    model_version: result.modelVersion,
    class: result.class,
    priority_index: result.priorityIndex,
    confidence: result.confidence,
    dataset_type: result.dataset_type,
    forced: force
  });

  return { unchanged: false, score: shapeScore(inserted, { stale: false }) };
}

/** Keeps the beneficiaries mirror columns in step with the current score. */
async function syncMirror(record, { score, klass }) {
  const { error } = await admin()
    .from('beneficiaries')
    .update({ vulnerability_score: score, vulnerability_class: klass })
    .eq('id', record.id);
  if (error) throw new HttpError(500, `Failed to update the beneficiary record: ${error.message}`);
}

/**
 * Staff coordination alert for a scoring change (Batch 6). Score VALUES are
 * never sent to beneficiaries — this notifies staff roles only, because
 * scores are restricted decision-support data. Failures never interrupt
 * the scoring action itself.
 */
async function alertStaff(title, body, level = 'info') {
  try {
    await notifyRole(ROLES.CSWD_STAFF, { title, body, level, category: 'scoring', link_path: '/scoring' });
  } catch (err) {
    console.warn('[ReliefGov] scoring notification failed:', err.message);
  }
}

/* ------------------------------------------------------------------ */
/* Flag a questionable score (CSWD)                                     */
/* ------------------------------------------------------------------ */

/**
 * Flags the current score as questionable. The score stays visible with
 * its flag badge; staff can then correct it or re-run the model. Requires
 * a meaningful note (>= 5 characters).
 */
export async function flagScore(user, scoreId, body = {}) {
  if (!isCswd(user)) {
    throw forbidden('Only CSWD Staff can flag or correct scoring results.');
  }
  const note = String(body.note || body.notes || '').trim();
  if (note.length < 5) {
    throw badRequest('A note of at least 5 characters is required to flag a score.', {
      note: 'Explain what looks questionable about this result.'
    });
  }

  const { data: score, error } = await admin()
    .from('vulnerability_scores')
    .select(SCORE_COLUMNS)
    .eq('id', scoreId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!score) throw notFound('Score not found.');
  if (score.status !== 'current') {
    throw new HttpError(409, 'Only the current score can be flagged. Superseded scores are kept for audit.');
  }
  if (score.flagged_at) {
    throw new HttpError(409, 'This score is already flagged.');
  }

  const { data: updated, error: updErr } = await admin()
    .from('vulnerability_scores')
    .update({
      flag_note: note,
      flagged_by: user.id,
      flagged_at: new Date().toISOString()
    })
    .eq('id', scoreId)
    .select(SCORE_COLUMNS)
    .single();
  if (updErr) throw new HttpError(500, updErr.message);

  await audit(user.id, 'scoring.flag', scoreId, { note });
  await alertStaff(
    'Vulnerability score flagged for review',
    `A current vulnerability score was flagged as questionable: ${note}`,
    'warning'
  );
  return { score: shapeScore(updated, { stale: false }) };
}

/* ------------------------------------------------------------------ */
/* Authorized manual correction (CSWD)                                  */
/* ------------------------------------------------------------------ */

/**
 * Records an authorized manual correction: a NEW current row with
 * source = 'manual', the class chosen by the reviewer, the documented
 * category index for display, and a mandatory reason. The model score is
 * superseded, never deleted — the history shows who overrode what and why.
 *
 * This does NOT approve or reject anything: eligibility stays with the
 * CSWD review step in applicationService.
 */
export async function correctScore(user, scoreId, body = {}) {
  if (!isCswd(user)) {
    throw forbidden('Only CSWD Staff can flag or correct scoring results.');
  }
  const klass = String(body.class || '').trim();
  const reason = String(body.reason || body.notes || '').trim();

  if (!CLASSES.includes(klass)) {
    throw badRequest('Choose a valid priority class.', {
      class: `Must be one of: ${CLASSES.join(', ')}.`
    });
  }
  if (reason.length < 5) {
    throw badRequest('A correction reason of at least 5 characters is required.', {
      reason: 'Document why this correction is authorized.'
    });
  }

  const { data: score, error } = await admin()
    .from('vulnerability_scores')
    .select(SCORE_COLUMNS)
    .eq('id', scoreId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!score) throw notFound('Score not found.');
  if (score.status !== 'current') {
    throw new HttpError(409, 'Only the current score can be corrected. Superseded scores are kept for audit.');
  }

  const record = await getRecordOrThrow(score.beneficiary_id);

  // One current row per beneficiary: archive first, then insert, restoring
  // on failure (see runScore).
  const { error: supErr } = await admin()
    .from('vulnerability_scores')
    .update({ status: 'superseded' })
    .eq('id', score.id)
    .eq('status', 'current');
  if (supErr) throw new HttpError(500, `Failed to archive the previous score: ${supErr.message}`);

  let inserted;
  try {
    const { data, error: insErr } = await admin()
      .from('vulnerability_scores')
      .insert({
        beneficiary_id: score.beneficiary_id,
        model_version: 'manual-correction',
        score: MANUAL_CATEGORY_INDEX[klass],
        class: klass,
        top_factors: [],
        evaluated_on: 'staff-correction',
        status: 'current',
        source: 'manual',
        dataset_type: score.dataset_type,
        probabilities: null,
        confidence: null,
        indicator_snapshot: indicatorSnapshot(record),
        scored_by: user.id,
        corrected_by: user.id,
        correction_reason: reason
      })
      .select(SCORE_COLUMNS)
      .single();
    if (insErr) throw new HttpError(500, `Failed to store the correction: ${insErr.message}`);
    inserted = data;
  } catch (err) {
    await admin()
      .from('vulnerability_scores')
      .update({ status: 'current' })
      .eq('id', score.id);
    throw err;
  }

  await syncMirror(record, { score: MANUAL_CATEGORY_INDEX[klass], klass });
  await audit(user.id, 'scoring.correct', inserted.id, {
    beneficiary_id: score.beneficiary_id,
    overrides_score_id: scoreId,
    previous_class: score.class,
    corrected_class: klass,
    reason
  });
  await alertStaff(
    'Vulnerability score manually corrected',
    `A vulnerability score was corrected from ${score.class} to ${klass}. Reason: ${reason}`,
    'info'
  );

  return { score: shapeScore(inserted, { stale: false }) };
}

/* ------------------------------------------------------------------ */
/* Dashboard summary (staff)                                            */
/* ------------------------------------------------------------------ */

/**
 * Aggregated scoring state for the dashboard panel: scored/missing/stale
 * counts plus the class breakdown — all computed from current scores.
 */
export async function getSummary(user) {
  assertStaff(user);
  const { data: records, error } = await admin()
    .from('beneficiaries')
    .select('id, application_status, household_size, income_level, damage_extent, house_status')
    .eq('barangay', 'Tambacan')
    .neq('application_status', 'Draft');
  if (error) throw new HttpError(500, error.message);

  const rows = records || [];
  const [scores, photoSet] = await Promise.all([
    Promise.all(rows.map((r) => currentScore(r.id))),
    loadDamagePhotoSet(rows.map((r) => r.id))
  ]);

  const byClass = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  let scored = 0;
  let missing = 0;
  let stale = 0;
  let flagged = 0;
  let scorable = 0;

  rows.forEach((record, i) => {
    const score = scores[i];
    if (SCORABLE_STATUSES.includes(record.application_status)) scorable += 1;
    if (!score) {
      missing += 1;
      return;
    }
    scored += 1;
    byClass[score.class] = (byClass[score.class] || 0) + 1;
    if (score.flagged_at) flagged += 1;
    else {
      const live = { ...record, damage_photo: photoSet.has(record.id) ? 1 : 0 };
      if (snapshotChanged(live, score.indicator_snapshot) || isModelStale(score)) stale += 1;
    }
  });

  return {
    total: rows.length,
    scorable,
    scored,
    missing,
    stale,
    flagged,
    by_class: byClass,
    model: await publicModelSummary()
  };
}

export default {
  getModelStatus,
  listScores,
  getDetail,
  runScore,
  flagScore,
  correctScore,
  getSummary
};
