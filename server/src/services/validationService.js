import { supabaseAdmin } from '../lib/supabase.js';
import { badRequest, forbidden, notFound, HttpError, unavailable } from '../lib/errors.js';
import { ROLES } from './authService.js';
import { scorePair } from '../lib/duplicates.js';
import { notify } from './notificationService.js';

/**
 * Data Validation & Duplicate Detection module (Batch 4).
 *
 * Responsibilities of this service:
 *  1. Validation queue for barangay and CSWD staff — Tambacan-only, with
 *     search and filters (status, purok, submission date, duplicate flag).
 *  2. Full record detail for review: profile, documents, status history,
 *     verification reviews, and duplicate flags with their evidence.
 *  3. Duplicate detection at submission time using normalized comparisons of
 *     name, date of birth, mobile number, purok and family size — a name
 *     match alone only ever produces a LOW-confidence flag for a human.
 *  4. Reviewer decisions on flags (confirm / dismiss / request information)
 *     recorded with reviewer, timestamp, decision and notes.
 *  5. Local distribution monitoring and barangay report preparation data.
 *
 * No external government database, national ID or biometric integration is
 * used anywhere in this module (explicitly out of capstone scope).
 *
 * KEEP IN SYNC: the workflow statuses below mirror applicationService.STATUS.
 */

const STAFF_ROLES = [ROLES.BARANGAY_STAFF, ROLES.CSWD_STAFF];

const WORKFLOW_STATUSES = Object.freeze([
  'Draft', 'Pending', 'Under Verification', 'Needs Correction', 'Approved', 'Rejected'
]);

/** Statuses that appear in the staff validation queue (submitted records). */
const QUEUE_STATUSES = Object.freeze([
  'Pending', 'Under Verification', 'Needs Correction', 'Approved', 'Rejected'
]);

const FLAG_STATUSES = Object.freeze(['Flagged', 'Cleared', 'Confirmed']);
const DECISIONS = Object.freeze(['confirm', 'dismiss', 'request_info']);

const APP_COLUMNS = [
  'id', 'beneficiary_number', 'user_id',
  'first_name', 'middle_name', 'last_name', 'sex', 'date_of_birth',
  'civil_status', 'mobile_number', 'purok', 'barangay', 'city_municipality', 'province',
  'household_size', 'monthly_family_income', 'income_level', 'house_status',
  'incident_type', 'incident_date', 'incident_description', 'damage_extent',
  'application_status', 'status_reason', 'submitted_at',
  'validation_status', 'duplicate_of', 'vulnerability_score', 'vulnerability_class',
  'data_origin', 'created_at', 'updated_at'
].join(', ');

const FLAG_COLUMNS =
  'id, beneficiary_id, candidate_id, duplicate_of, similarity_score, status, confidence, match_details, decision, reviewed_by, reviewed_at, notes, created_at, updated_at';

const RECORD_SUMMARY_COLUMNS =
  'id, beneficiary_number, first_name, middle_name, last_name, purok, barangay, application_status, submitted_at, validation_status, duplicate_of, vulnerability_class';

const DOCUMENT_COLUMNS =
  'id, beneficiary_id, uploaded_by, bucket, storage_path, file_name, mime_type, size_bytes, purpose, status, status_reason, created_at';

const HISTORY_COLUMNS =
  'id, beneficiary_id, from_status, to_status, reason, actor_role, created_at';

const REVIEW_COLUMNS =
  'id, beneficiary_id, reviewer_id, reviewer_role, stage, outcome, remarks, created_at';

function admin() {
  if (!supabaseAdmin) {
    throw unavailable('The Data Validation module requires Supabase configuration on the server.');
  }
  return supabaseAdmin;
}

function assertStaff(user) {
  if (!user || !STAFF_ROLES.includes(user.role)) {
    throw forbidden('Only barangay and CSWD staff can use the validation module.');
  }
}

const fullName = (row) =>
  [row?.first_name, row?.middle_name, row?.last_name].filter(Boolean).join(' ');

async function audit(actorId, action, entityId, detail) {
  try {
    await admin().from('audit_logs').insert({
      actor_id: actorId,
      action,
      entity: 'validation_results',
      entity_id: entityId,
      detail
    });
  } catch (err) {
    console.warn('[ReliefGov] audit log write failed:', err.message);
  }
}

/* ------------------------------------------------------------------ */
/* Record access (staff only, Tambacan only)                           */
/* ------------------------------------------------------------------ */

/**
 * Loads a record for staff review; anything outside Tambacan — and any
 * record the applicant has not submitted yet (Draft) — is a 404. Drafts
 * stay private until submission puts them in the validation queue.
 */
async function getRecordOrThrow(id) {
  const { data, error } = await admin()
    .from('beneficiaries')
    .select(APP_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data || data.barangay !== 'Tambacan' || data.application_status === 'Draft') {
    // Study scope: records outside Barangay Tambacan are never exposed,
    // and unsubmitted drafts are the applicant's private workspace.
    throw notFound('Application record not found.');
  }
  return data;
}

/** Ids of records touched by at least one OPEN duplicate flag. */
async function openFlaggedIds() {
  const { data, error } = await admin()
    .from('validation_results')
    .select('beneficiary_id, candidate_id')
    .eq('status', 'Flagged');
  if (error) throw new HttpError(500, error.message);
  const ids = new Set();
  for (const row of data || []) {
    if (row.beneficiary_id) ids.add(row.beneficiary_id);
    if (row.candidate_id) ids.add(row.candidate_id);
  }
  return ids;
}

async function countOpenFlags(beneficiaryId) {
  const { count, error } = await admin()
    .from('validation_results')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'Flagged')
    .or(`beneficiary_id.eq.${beneficiaryId},candidate_id.eq.${beneficiaryId}`);
  if (error) throw new HttpError(500, error.message);
  return count || 0;
}

/**
 * Keeps beneficiaries.validation_status in step with open duplicate flags:
 * an open flag marks a still-Pending record as Flagged; clearing the last
 * flag returns it to Pending. Verified / Rejected / Duplicate outcomes are
 * never downgraded by this recomputation.
 */
async function applyFlagState(beneficiaryId) {
  if (!beneficiaryId) return;
  const { data: record, error } = await admin()
    .from('beneficiaries')
    .select('id, validation_status')
    .eq('id', beneficiaryId)
    .maybeSingle();
  if (error || !record) return;
  const open = await countOpenFlags(beneficiaryId);
  let next = record.validation_status;
  if (open > 0 && record.validation_status === 'Pending') next = 'Flagged';
  else if (open === 0 && record.validation_status === 'Flagged') next = 'Pending';
  if (next !== record.validation_status) {
    await admin().from('beneficiaries').update({ validation_status: next }).eq('id', beneficiaryId);
  }
}

/* ------------------------------------------------------------------ */
/* Validation queue                                                    */
/* ------------------------------------------------------------------ */

/**
 * Staff validation queue with search and filters. Always scoped to
 * Barangay Tambacan; Draft applications are not in the queue because they
 * have never been submitted.
 */
export async function listQueue(user, filters = {}) {
  assertStaff(user);
  const search = String(filters.search || '').trim().replace(/[%_,()]/g, '');
  const status = String(filters.status || '').trim();
  const purok = String(filters.purok || '').trim();
  const from = String(filters.from || '').trim();
  const to = String(filters.to || '').trim();
  const duplicate = String(filters.duplicate || '').trim();
  const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 100);
  const offset = Math.max(Number(filters.offset) || 0, 0);

  if (status && !WORKFLOW_STATUSES.includes(status)) {
    throw badRequest('Unknown application status filter.', {
      status: `Must be one of: ${WORKFLOW_STATUSES.join(', ')}.`
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
  if (duplicate && duplicate !== 'flagged') {
    throw badRequest('Unknown duplicate filter.', { duplicate: "Use 'flagged' or leave empty." });
  }

  const flagged = await openFlaggedIds();

  let query = admin()
    .from('beneficiaries')
    .select(APP_COLUMNS, { count: 'exact' })
    .eq('barangay', 'Tambacan')
    .neq('application_status', 'Draft')
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('application_status', status);
  if (purok) query = query.eq('purok', purok);
  if (from) query = query.gte('submitted_at', new Date(`${from}T00:00:00`).toISOString());
  if (to) query = query.lte('submitted_at', new Date(`${to}T23:59:59.999`).toISOString());
  if (duplicate === 'flagged') query = query.in('id', [...flagged]);
  if (search) {
    query = query.or(
      `first_name.ilike.%${search}%,last_name.ilike.%${search}%,beneficiary_number.ilike.%${search}%`
    );
  }

  const { data, error, count } = await query;
  if (error) throw new HttpError(500, `Failed to read the validation queue: ${error.message}`);

  const rows = (data || []).map((row) => ({
    ...row,
    full_name: fullName(row),
    duplicate_flagged: flagged.has(row.id)
  }));

  return {
    total: count ?? rows.length,
    rows,
    scope: { barangay: 'Tambacan', city: 'Iligan City', province: 'Lanao del Norte' },
    filters_applied: { search, status, purok, from, to, duplicate }
  };
}

/* ------------------------------------------------------------------ */
/* Duplicate flags                                                     */
/* ------------------------------------------------------------------ */

async function hydrateFlags(flags) {
  const recordIds = [...new Set(
    flags.flatMap((f) => [f.beneficiary_id, f.candidate_id]).filter(Boolean)
  )];
  const reviewerIds = [...new Set(flags.map((f) => f.reviewed_by).filter(Boolean))];

  const [recordsResult, reviewersResult] = await Promise.all([
    recordIds.length
      ? admin().from('beneficiaries').select(RECORD_SUMMARY_COLUMNS).in('id', recordIds).eq('barangay', 'Tambacan')
      : Promise.resolve({ data: [] }),
    reviewerIds.length
      ? admin().from('profiles').select('id, full_name, role').in('id', reviewerIds)
      : Promise.resolve({ data: [] })
  ]);
  if (recordsResult.error) throw new HttpError(500, recordsResult.error.message);
  if (reviewersResult.error) throw new HttpError(500, reviewersResult.error.message);

  const recordsById = new Map((recordsResult.data || []).map((r) => [r.id, r]));
  const reviewersById = new Map((reviewersResult.data || []).map((r) => [r.id, r]));

  return flags.map((flag) => ({
    ...flag,
    flagged_record: recordsById.get(flag.beneficiary_id) || null,
    candidate_record: recordsById.get(flag.candidate_id) || null,
    reviewer: flag.reviewed_by ? reviewersById.get(flag.reviewed_by) || null : null
  }));
}

/** Duplicate flags with evidence. Default: open flags awaiting review. */
export async function listFlags(user, { status = 'Flagged', limit = 50 } = {}) {
  assertStaff(user);
  const flagStatus = String(status || 'Flagged').trim() || 'Flagged';
  if (!FLAG_STATUSES.includes(flagStatus)) {
    throw badRequest('Unknown flag status filter.', {
      status: `Must be one of: ${FLAG_STATUSES.join(', ')}.`
    });
  }
  const { data, error } = await admin()
    .from('validation_results')
    .select(FLAG_COLUMNS)
    .eq('status', flagStatus)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 50, 1), 100));
  if (error) throw new HttpError(500, error.message);

  const flags = await hydrateFlags(data || []);
  return { total: flags.length, flags, status: flagStatus };
}

/**
 * Duplicate-review decision: confirm, dismiss, or request further
 * information. Records reviewer, timestamp, decision and notes. Never
 * deletes a record and never changes an application status — the human
 * workflow keeps the final say on every application.
 */
export async function decideFlag(user, flagId, input) {
  assertStaff(user);

  const action = String(input?.action || '').trim();
  if (!DECISIONS.includes(action)) {
    throw badRequest('Unknown duplicate-review action.', {
      action: 'Choose confirm, dismiss, or request_info.'
    });
  }
  // Clearing (unflagging) a duplicate flag is reserved for the central office.
  // Barangay Staff may view flags and record confirm / request-info decisions,
  // but they cannot dismiss — including by calling this endpoint directly.
  if (action === 'dismiss' && user.role !== ROLES.CSWD_STAFF) {
    throw forbidden('Only CSWD Staff can clear or dismiss a duplicate flag.');
  }
  const notes = String(input?.notes || '').trim();
  if (notes.length < 5) {
    throw badRequest('A decision note is required.', {
      notes: 'Write at least 5 characters explaining the decision.'
    });
  }
  if (notes.length > 500) {
    throw badRequest('The decision note is too long.', { notes: 'Keep it under 500 characters.' });
  }

  const { data: flag, error } = await admin()
    .from('validation_results')
    .select(FLAG_COLUMNS)
    .eq('id', flagId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!flag) throw notFound('Duplicate flag not found.');
  if (flag.status !== 'Flagged') {
    throw new HttpError(409, `This flag was already ${flag.status === 'Confirmed' ? 'confirmed' : 'dismissed'}. Decisions are final and kept for audit.`, {
      status: flag.status
    });
  }
  if (action === 'confirm' && !flag.candidate_id) {
    throw new HttpError(409, 'This flag has no candidate record to confirm a duplicate against.');
  }

  const now = new Date().toISOString();
  const update = { decision: action, reviewed_by: user.id, reviewed_at: now, notes };
  if (action === 'confirm') {
    update.status = 'Confirmed';
    update.duplicate_of = flag.candidate_id;
  } else if (action === 'dismiss') {
    update.status = 'Cleared';
  }
  // request_info keeps the flag open — staff still need the information.

  const { data: updated, error: updateError } = await admin()
    .from('validation_results')
    .update(update)
    .eq('id', flagId)
    .eq('status', 'Flagged') // optimistic lock against a concurrent decision
    .select(FLAG_COLUMNS)
    .maybeSingle();
  if (updateError) throw new HttpError(500, updateError.message);
  if (!updated) {
    throw new HttpError(409, 'The flag was decided by someone else while you were acting on it. Please refresh.');
  }

  if (action === 'confirm') {
    // Link the flagged record to the original. Nothing is deleted, and the
    // application keeps its current status for staff to decide separately.
    const { error: linkError } = await admin()
      .from('beneficiaries')
      .update({ duplicate_of: flag.candidate_id, validation_status: 'Duplicate' })
      .eq('id', flag.beneficiary_id);
    if (linkError) throw new HttpError(500, linkError.message);
    await applyFlagState(flag.beneficiary_id);
    await applyFlagState(flag.candidate_id);
  } else if (action === 'dismiss') {
    await applyFlagState(flag.beneficiary_id);
    await applyFlagState(flag.candidate_id);
  } else {
    const { data: record } = await admin()
      .from('beneficiaries')
      .select('user_id, beneficiary_number')
      .eq('id', flag.beneficiary_id)
      .maybeSingle();
    if (record?.user_id) {
      await notify(record.user_id, {
        title: 'Additional information needed',
        body: 'The reviewing office needs more information about your application. Please wait for guidance from the barangay office or CSWD.',
        level: 'warning',
        category: 'validation',
        link_path: '/validation'
      });
    }
  }

  await audit(user.id, `validation.${action}`, flag.beneficiary_id, {
    flag_id: flag.id,
    candidate_id: flag.candidate_id,
    confidence: flag.confidence,
    similarity_score: flag.similarity_score,
    notes
  });

  const { data: reloaded } = await admin()
    .from('validation_results')
    .select(FLAG_COLUMNS)
    .eq('id', flagId)
    .maybeSingle();
  const [hydrated] = await hydrateFlags([reloaded || updated]);
  return { flag: hydrated };
}

/* ------------------------------------------------------------------ */
/* Duplicate detection (runs on submission and on staff rescan)        */
/* ------------------------------------------------------------------ */

/**
 * Compares a submitted application against every other submitted Tambacan
 * record it has not been compared to before, and files a flag for every
 * pair that meets the confidence rules in lib/duplicates.js.
 *
 * A name match alone produces at most a LOW-confidence flag; nothing is
 * auto-merged, auto-rejected or deleted by this scan.
 */
export async function scanForDuplicates(application) {
  if (!application?.id) return { created: 0, compared: 0 };

  const { data: candidates, error: candError } = await admin()
    .from('beneficiaries')
    .select('id, beneficiary_number, user_id, first_name, middle_name, last_name, date_of_birth, mobile_number, purok, household_size, application_status, validation_status')
    .eq('barangay', 'Tambacan')
    .neq('id', application.id)
    .neq('application_status', 'Draft')
    .neq('validation_status', 'Duplicate');
  if (candError) throw new HttpError(500, candError.message);

  // Pairs already compared (any outcome) are never re-flagged automatically:
  // a reviewer already had (or is having) a look at them.
  const { data: existing, error: existingError } = await admin()
    .from('validation_results')
    .select('beneficiary_id, candidate_id')
    .or(`beneficiary_id.eq.${application.id},candidate_id.eq.${application.id}`);
  if (existingError) throw new HttpError(500, existingError.message);
  const linked = new Set();
  for (const row of existing || []) {
    linked.add(row.beneficiary_id);
    if (row.candidate_id) linked.add(row.candidate_id);
  }
  linked.add(application.id);

  const rows = [];
  let compared = 0;
  for (const candidate of candidates || []) {
    if (linked.has(candidate.id)) continue;
    if (candidate.user_id && candidate.user_id === application.user_id) continue;
    compared += 1;
    const result = scorePair(application, candidate);
    if (!result.flagged) continue;
    rows.push({
      beneficiary_id: application.id,
      candidate_id: candidate.id,
      similarity_score: result.score,
      status: 'Flagged',
      confidence: result.confidence,
      match_details: {
        name_similarity: result.nameSimilarity,
        matches: result.matches,
        evidence: result.evidence,
        flagged_name: fullName(application),
        flagged_reference: application.beneficiary_number,
        candidate_name: fullName(candidate),
        candidate_reference: candidate.beneficiary_number
      }
    });
  }

  if (rows.length > 0) {
    const { error: insertError } = await admin().from('validation_results').insert(rows);
    if (insertError) throw new HttpError(500, insertError.message);
    await applyFlagState(application.id);
    for (const candidateId of new Set(rows.map((r) => r.candidate_id))) {
      await applyFlagState(candidateId);
    }
  }

  return { created: rows.length, compared };
}

/** Staff-triggered re-scan of one record (e.g. after corrected resubmission). */
export async function rescanRecord(user, id) {
  assertStaff(user);
  const application = await getRecordOrThrow(id);
  const result = await scanForDuplicates(application);
  await audit(user.id, 'validation.rescan', application.id, {
    created: result.created,
    compared: result.compared
  });
  return result;
}

/** Staff-triggered re-scan across all submitted records. */
export async function rescanAllRecords(user) {
  assertStaff(user);
  const { data: records, error } = await admin()
    .from('beneficiaries')
    .select('id, beneficiary_number, user_id, first_name, middle_name, last_name, date_of_birth, mobile_number, purok, household_size, application_status, validation_status, barangay')
    .eq('barangay', 'Tambacan')
    .neq('application_status', 'Draft');
  if (error) throw new HttpError(500, error.message);

  let totalCreated = 0;
  let totalCompared = 0;
  for (const record of records || []) {
    const res = await scanForDuplicates(record);
    totalCreated += res.created || 0;
    totalCompared += res.compared || 0;
  }

  await audit(user.id, 'validation.rescan_all', null, {
    created: totalCreated,
    compared: totalCompared,
    records_count: (records || []).length
  });

  return {
    created: totalCreated,
    compared: totalCompared,
    totalRecords: (records || []).length
  };
}

/* ------------------------------------------------------------------ */
/* Record detail for review                                            */
/* ------------------------------------------------------------------ */

function capabilitiesFor(user, application, reviews = []) {
  const status = application.application_status;
  const isCswd = user.role === ROLES.CSWD_STAFF;
  const isBarangay = user.role === ROLES.BARANGAY_STAFF;

  // Approach 1 (Barangay Endorsement Gate): An application must be verified
  // by Barangay Staff before CSWD staff can make a final decision.
  const verifiedByBarangay = (reviews || []).some(
    (r) => r.reviewer_role === ROLES.BARANGAY_STAFF || r.stage === 'barangay_verification' || r.stage === 'barangay'
  );

  return {
    canStartVerification: status === 'Pending' && isBarangay,
    canReturnForCorrection: status === 'Pending' && isBarangay,
    canApprove: status === 'Under Verification' && isCswd && verifiedByBarangay,
    canReject: status === 'Under Verification' && isCswd && verifiedByBarangay,
    verifiedByBarangay,
    canRescan: status !== 'Draft',
    canReviewDuplicates: true,
    canReviewDocuments: true,
    // Clearing (unflagging) a duplicate flag is a CSWD decision; barangay
    // staff can view the flag status but cannot dismiss it.
    canDismissFlag: isCswd,
    finalDecisionRole: 'cswd_staff'
  };
}

/** Full review bundle for one record (staff only, Tambacan only). */
export async function getDetail(user, id) {
  assertStaff(user);
  const application = await getRecordOrThrow(id);

  const [documents, history, reviews, rawFlags] = await Promise.all([
    admin()
      .from('documents')
      .select(DOCUMENT_COLUMNS)
      .eq('beneficiary_id', application.id)
      .order('created_at', { ascending: false })
      .then((r) => { if (r.error) throw new HttpError(500, r.error.message); return r.data || []; }),
    admin()
      .from('application_status_history')
      .select(HISTORY_COLUMNS)
      .eq('beneficiary_id', application.id)
      .order('created_at', { ascending: true })
      .then((r) => { if (r.error) throw new HttpError(500, r.error.message); return r.data || []; }),
    admin()
      .from('verification_reviews')
      .select(REVIEW_COLUMNS)
      .eq('beneficiary_id', application.id)
      .order('created_at', { ascending: false })
      .then((r) => { if (r.error) throw new HttpError(500, r.error.message); return r.data || []; }),
    admin()
      .from('validation_results')
      .select(FLAG_COLUMNS)
      .or(`beneficiary_id.eq.${application.id},candidate_id.eq.${application.id}`)
      .order('created_at', { ascending: false })
      .then((r) => { if (r.error) throw new HttpError(500, r.error.message); return r.data || []; })
  ]);

  let applicant = null;
  if (application.user_id) {
    const { data } = await admin()
      .from('profiles')
      .select('id, full_name, email, role')
      .eq('id', application.user_id)
      .maybeSingle();
    applicant = data || null;
  }

  const flags = await hydrateFlags(rawFlags);

  return {
    application,
    applicant,
    documents,
    history,
    reviews,
    flags,
    capabilities: capabilitiesFor(user, application, reviews)
  };
}

export default {
  listQueue,
  listFlags,
  decideFlag,
  scanForDuplicates,
  rescanRecord,
  rescanAllRecords,
  getDetail
};
