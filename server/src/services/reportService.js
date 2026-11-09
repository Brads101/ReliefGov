import { supabaseAdmin } from '../lib/supabase.js';
import { badRequest, forbidden, HttpError, unavailable } from '../lib/errors.js';
import { ROLES } from './authService.js';
import { notifyRole } from './notificationService.js';

/**
 * Monitoring & Reporting — batch 4 slice: barangay-level report
 * preparation and submission for CSWD oversight.
 *
 * Every report snapshots LIVE counts for Barangay Tambacan at the moment
 * it is prepared (parameters.snapshot) so the numbers on paper always match
 * what the office saw. Creating a report submits it to CSWD oversight —
 * both roles read the same list. CSV/PDF exports arrive with the full
 * Monitoring & Reporting batch.
 *
 * KEEP IN SYNC: REPORT_TYPES mirrors the reports.report_type check
 * constraint in migration 0002.
 */

export const REPORT_TYPES = Object.freeze([
  'Beneficiary registry',
  'Validation summary',
  'Duplicate review',
  'Vulnerability summary',
  'Aid distribution',
  'Activity log',
  'Period summary'
]);

const STAFF_ROLES = Object.freeze([ROLES.BARANGAY_STAFF, ROLES.CSWD_STAFF]);

const REPORT_COLUMNS = 'id, report_type, format, parameters, row_count, generated_by, created_at';

function admin() {
  if (!supabaseAdmin) {
    throw unavailable('The Reporting module requires Supabase configuration on the server.');
  }
  return supabaseAdmin;
}

function assertStaff(user) {
  if (!user || !STAFF_ROLES.includes(user.role)) {
    throw forbidden('Only barangay and CSWD staff can prepare or view reports.');
  }
}

function optionalDate(value, field) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    throw badRequest(`Invalid ${field} date.`, { [field]: 'Use a valid date (YYYY-MM-DD).' });
  }
  const year = new Date(parsed).getFullYear();
  if (year < 1900 || year > 2100) {
    throw badRequest(`Invalid ${field} date.`, { [field]: 'Please enter a valid year between 1900 and 2100.' });
  }
  return raw;
}

const tally = (rows, key) => {
  const counts = {};
  for (const row of rows) {
    const value = row[key] ?? '—';
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
};

/** Live Tambacan snapshot for one report type. All figures come from the
 *  database — nothing on a report is hard-coded. */
async function buildSnapshot(reportType, { dateFrom, dateTo }) {
  const db = admin();
  const inRange = (query) => {
    if (!dateFrom && !dateTo) return query;
    return query
      .not('submitted_at', 'is', null)
      .gte('submitted_at', dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : '1970-01-01')
      .lte('submitted_at', dateTo ? new Date(`${dateTo}T23:59:59.999`).toISOString() : new Date(Date.now() + 8.64e7).toISOString());
  };

  if (reportType === 'Beneficiary registry') {
    const { data, error } = await inRange(
      db.from('beneficiaries').select('validation_status, application_status, purok').eq('barangay', 'Tambacan')
    );
    if (error) throw new HttpError(500, error.message);
    const rows = data || [];
    return {
      row_count: rows.length,
      snapshot: {
        total: rows.length,
        by_validation_status: tally(rows, 'validation_status'),
        by_application_status: tally(rows, 'application_status'),
        by_purok: tally(rows, 'purok')
      }
    };
  }

  if (reportType === 'Validation summary') {
    const [apps, flags] = await Promise.all([
      inRange(
        db.from('beneficiaries').select('application_status, validation_status').eq('barangay', 'Tambacan')
          .neq('application_status', 'Draft')
      ),
      db.from('validation_results').select('id, status, confidence', { count: 'exact', head: false })
    ]);
    if (apps.error) throw new HttpError(500, apps.error.message);
    if (flags.error) throw new HttpError(500, flags.error.message);
    const rows = apps.data || [];
    const flagRows = flags.data || [];
    return {
      row_count: rows.length,
      snapshot: {
        submitted_total: rows.length,
        by_application_status: tally(rows, 'application_status'),
        by_validation_status: tally(rows, 'validation_status'),
        open_duplicate_flags: flagRows.filter((f) => f.status === 'Flagged').length,
        confirmed_duplicates: flagRows.filter((f) => f.status === 'Confirmed').length,
        dismissed_flags: flagRows.filter((f) => f.status === 'Cleared').length,
        flags_by_confidence: tally(flagRows.filter((f) => f.status === 'Flagged'), 'confidence')
      }
    };
  }

  if (reportType === 'Vulnerability summary') {
    const { data, error } = await db
      .from('beneficiaries')
      .select('vulnerability_class, vulnerability_score')
      .eq('barangay', 'Tambacan');
    if (error) throw new HttpError(500, error.message);
    const rows = data || [];
    const scored = rows.filter((r) => r.vulnerability_class);
    return {
      row_count: rows.length,
      snapshot: {
        total_profiles: rows.length,
        scored_profiles: scored.length,
        by_class: tally(scored, 'vulnerability_class')
      }
    };
  }

  if (reportType === 'Aid distribution') {
    const { data, error } = await db
      .from('aid_distributions')
      .select('assistance_type, status, quantity, amount')
      .eq('barangay', 'Tambacan');
    if (error) throw new HttpError(500, error.message);
    const rows = data || [];
    return {
      row_count: rows.length,
      snapshot: {
        total_records: rows.length,
        by_status: tally(rows, 'status'),
        by_assistance_type: tally(rows, 'assistance_type'),
        total_amount: rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
        total_quantity: rows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0)
      }
    };
  }

  if (reportType === 'Duplicate review') {
    const { data, error } = await db
      .from('validation_results')
      .select('id, status, confidence, similarity_score, decision, reviewed_at, created_at, beneficiary_id, candidate_id');
    if (error) throw new HttpError(500, error.message);
    const rows = data || [];
    return {
      row_count: rows.length,
      snapshot: {
        total_flags: rows.length,
        by_status: tally(rows, 'status'),
        by_confidence: tally(rows.filter((r) => r.confidence), 'confidence'),
        awaiting_review: rows.filter((r) => r.status === 'Flagged' || r.status === 'Pending').length,
        confirmed: rows.filter((r) => r.status === 'Confirmed').length,
        dismissed: rows.filter((r) => r.status === 'Cleared').length
      }
    };
  }

  if (reportType === 'Period summary') {
    const [apps, flags, scores, aid] = await Promise.all([
      inRange(db.from('beneficiaries').select('application_status, submitted_at').eq('barangay', 'Tambacan').neq('application_status', 'Draft')),
      db.from('validation_results').select('status, created_at'),
      db.from('vulnerability_scores').select('class, status, created_at').eq('status', 'current'),
      db.from('aid_distributions').select('status, distributed_at, created_at').eq('barangay', 'Tambacan')
    ]);
    if (apps.error) throw new HttpError(500, apps.error.message);
    if (flags.error) throw new HttpError(500, flags.error.message);
    if (scores.error) throw new HttpError(500, scores.error.message);
    if (aid.error) throw new HttpError(500, aid.error.message);

    const inPeriod = (iso) => {
      if (!dateFrom && !dateTo) return true;
      const t = new Date(iso || 0).getTime();
      if (Number.isNaN(t)) return false;
      if (dateFrom && t < Date.parse(`${dateFrom}T00:00:00`)) return false;
      if (dateTo && t > Date.parse(`${dateTo}T23:59:59.999`)) return false;
      return true;
    };

    const appRows = apps.data || [];
    const scoreRows = scores.data || [];
    const aidRows = (aid.data || []).filter((r) => inPeriod(r.distributed_at || r.created_at));
    const flagRows = (flags.data || []).filter((r) => inPeriod(r.created_at));

    return {
      row_count: appRows.length + flagRows.length + scoreRows.length + aidRows.length,
      snapshot: {
        period_from: dateFrom || 'Inception',
        period_to: dateTo || 'Today',
        applications_submitted: appRows.length,
        by_application_status: tally(appRows, 'application_status'),
        duplicate_flags_filed: flagRows.length,
        by_flag_status: tally(flagRows, 'status'),
        current_scores: scoreRows.length,
        by_priority_class: tally(scoreRows, 'class'),
        distributions_recorded: aidRows.length,
        by_distribution_status: tally(aidRows, 'status')
      }
    };
  }

  // 'Activity log'
  let query = db.from('audit_logs').select('action, created_at').order('created_at', { ascending: false });
  if (dateFrom) query = query.gte('created_at', new Date(`${dateFrom}T00:00:00`).toISOString());
  if (dateTo) query = query.lte('created_at', new Date(`${dateTo}T23:59:59.999`).toISOString());
  const { data, error } = await query.limit(1000);
  if (error) throw new HttpError(500, error.message);
  const rows = data || [];
  return {
    row_count: rows.length,
    snapshot: {
      total_actions: rows.length,
      by_action: tally(rows, 'action'),
      recent: rows.slice(0, 10)
    }
  };
}

/** Prepared reports, newest first — the same list for both staff roles
 *  (barangay prepares and submits; CSWD oversees). */
export async function listReports(user) {
  assertStaff(user);
  const { data, error } = await admin()
    .from('reports')
    .select(REPORT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new HttpError(500, error.message);

  const preparerIds = [...new Set((data || []).map((r) => r.generated_by).filter(Boolean))];
  let preparers = [];
  if (preparerIds.length) {
    const { data: profiles, error: profileError } = await admin()
      .from('profiles')
      .select('id, full_name, role')
      .in('id', preparerIds);
    if (!profileError) preparers = profiles || [];
  }
  const byId = new Map(preparers.map((p) => [p.id, p]));

  const reports = (data || []).map((report) => ({
    ...report,
    prepared_by: report.generated_by ? byId.get(report.generated_by) || null : null
  }));
  return { reports, total: reports.length };
}

/** Prepares a barangay-level report and submits it for CSWD oversight. */
export async function createReport(user, body) {
  assertStaff(user);

  const reportType = String(body?.report_type || '').trim();
  if (!REPORT_TYPES.includes(reportType)) {
    throw badRequest('Choose a valid report type.', {
      report_type: `Must be one of: ${REPORT_TYPES.join(', ')}.`
    });
  }
  const dateFrom = optionalDate(body?.date_from, 'date_from');
  const dateTo = optionalDate(body?.date_to, 'date_to');
  if (dateFrom && dateTo && Date.parse(dateFrom) > Date.parse(dateTo)) {
    throw badRequest('The report period is inverted.', { date_from: 'Start date must be on or before the end date.' });
  }
  const notes = String(body?.notes || '').trim();
  if (notes.length > 500) {
    throw badRequest('The notes are too long.', { notes: 'Keep them under 500 characters.' });
  }

  const { row_count, snapshot } = await buildSnapshot(reportType, { dateFrom, dateTo });

  const { data, error } = await admin()
    .from('reports')
    .insert({
      report_type: reportType,
      format: 'Screen',
      parameters: {
        scope: { barangay: 'Tambacan', city: 'Iligan City', province: 'Lanao del Norte' },
        date_from: dateFrom,
        date_to: dateTo,
        prepared_by_role: user.role,
        submitted_to: 'CSWD Office, Iligan City',
        notes: notes || null,
        snapshot
      },
      row_count,
      generated_by: user.id
    })
    .select(REPORT_COLUMNS)
    .single();
  if (error) throw new HttpError(500, error.message);

  try {
    await admin().from('audit_logs').insert({
      actor_id: user.id,
      action: 'report.prepare',
      entity: 'reports',
      entity_id: data.id,
      detail: { report_type: reportType, row_count }
    });
  } catch (err) {
    console.warn('[ReliefGov] audit log write failed:', err.message);
  }

  // Staff coordination: the CSWD Office is alerted that a barangay report
  // has been filed for oversight (in-system only — no SMS or email).
  if (user.role === ROLES.BARANGAY_STAFF) {
    await notifyRole(ROLES.CSWD_STAFF, {
      title: 'Barangay report filed for oversight',
      body: `A "${reportType}" report (${row_count} row${row_count === 1 ? '' : 's'}) for Barangay Tambacan was prepared by the barangay office and is ready for CSWD review.`,
      level: 'info',
      category: 'staff',
      link_path: '/reports'
    });
  }

  return { report: data };
}

/* ------------------------------------------------------------------ */
/* Row-level export (CSV / printable layout)                           */
/* ------------------------------------------------------------------ */

/**
 * Builds the ROW-LEVEL data for a report type — what the on-screen
 * printable layout renders and what the CSV export writes. Unlike
 * buildSnapshot (aggregate tallies) this returns display columns and one
 * row per record, so exports carry the same authorization, the same
 * Tambacan scope and the same date filtering as the on-screen report.
 */
export async function buildExportRows(user, { reportType, dateFrom, dateTo }) {
  assertStaff(user);
  const db = admin();
  const inRange = (query) => {
    if (!dateFrom && !dateTo) return query;
    return query
      .not('submitted_at', 'is', null)
      .gte('submitted_at', dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : '1970-01-01')
      .lte('submitted_at', dateTo ? new Date(`${dateTo}T23:59:59.999`).toISOString() : new Date(Date.now() + 8.64e7).toISOString());
  };
  const name = (r) => [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(' ');
  const fmtDate = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

  if (reportType === 'Beneficiary registry' || reportType === 'Validation summary') {
    const { data, error } = await inRange(
      db.from('beneficiaries')
        .select('beneficiary_number, first_name, middle_name, last_name, purok, application_status, validation_status, vulnerability_class, submitted_at')
        .eq('barangay', 'Tambacan')
        .neq('application_status', 'Draft')
        .order('submitted_at', { ascending: false })
    );
    if (error) throw new HttpError(500, error.message);
    return {
      columns: ['Beneficiary No.', 'Name', 'Purok', 'Application Status', 'Validation Status', 'Priority Class', 'Submitted'],
      rows: (data || []).map((r) => [
        r.beneficiary_number, name(r), r.purok || '',
        r.application_status, r.validation_status, r.vulnerability_class || 'Not scored', fmtDate(r.submitted_at)
      ])
    };
  }

  if (reportType === 'Duplicate review') {
    const { data, error } = await db
      .from('validation_results')
      .select('id, status, confidence, similarity_score, decision, reviewed_at, created_at, beneficiary_id, candidate_id')
      .order('created_at', { ascending: false });
    if (error) throw new HttpError(500, error.message);
    const flags = data || [];
    const ids = [...new Set(flags.flatMap((f) => [f.beneficiary_id, f.candidate_id]).filter(Boolean))];
    const { data: records, error: recError } = ids.length
      ? await db.from('beneficiaries').select('id, beneficiary_number, first_name, middle_name, last_name').in('id', ids)
      : { data: [], error: null };
    if (recError) throw new HttpError(500, recError.message);
    const byId = new Map((records || []).map((r) => [r.id, r]));
    return {
      columns: ['Primary Record', 'Compared With', 'Status', 'Confidence', 'Similarity', 'Decision', 'Reviewed'],
      rows: flags.map((f) => [
        byId.get(f.beneficiary_id)?.beneficiary_number || '—',
        byId.get(f.candidate_id)?.beneficiary_number || '—',
        f.status, f.confidence || '—',
        f.similarity_score != null ? Number(f.similarity_score).toFixed(2) : '—',
        f.decision || '—', fmtDate(f.reviewed_at || f.created_at)
      ])
    };
  }

  if (reportType === 'Vulnerability summary') {
    const { data, error } = await db
      .from('vulnerability_scores')
      .select('class, score, status, dataset_type, model_version, source, created_at, beneficiary_id')
      .eq('status', 'current')
      .order('score', { ascending: false });
    if (error) throw new HttpError(500, error.message);
    const scores = data || [];
    const ids = [...new Set(scores.map((s) => s.beneficiary_id).filter(Boolean))];
    const { data: records, error: recError } = ids.length
      ? await db.from('beneficiaries').select('id, beneficiary_number, first_name, middle_name, last_name').in('id', ids)
      : { data: [], error: null };
    if (recError) throw new HttpError(500, recError.message);
    const byId = new Map((records || []).map((r) => [r.id, r]));
    return {
      columns: ['Beneficiary No.', 'Name', 'Priority Class', 'Priority Index (0-100)', 'Source', 'Model Version', 'Dataset', 'Assessed'],
      rows: scores.map((s) => [
        byId.get(s.beneficiary_id)?.beneficiary_number || '—',
        byId.get(s.beneficiary_id) ? name(byId.get(s.beneficiary_id)) : '—',
        s.class, Number(s.score).toFixed(1), s.source, s.model_version || '—', s.dataset_type, fmtDate(s.created_at)
      ])
    };
  }

  if (reportType === 'Aid distribution') {
    const { data, error } = await db
      .from('aid_distributions')
      .select('reference_no, assistance_type, quantity, amount, status, distributed_at, created_at, beneficiary_id')
      .eq('barangay', 'Tambacan')
      .order('created_at', { ascending: false });
    if (error) throw new HttpError(500, error.message);
    const aid = data || [];
    const ids = [...new Set(aid.map((a) => a.beneficiary_id).filter(Boolean))];
    const { data: records, error: recError } = ids.length
      ? await db.from('beneficiaries').select('id, beneficiary_number, first_name, middle_name, last_name').in('id', ids)
      : { data: [], error: null };
    if (recError) throw new HttpError(500, recError.message);
    const byId = new Map((records || []).map((r) => [r.id, r]));
    return {
      columns: ['Reference No.', 'Beneficiary No.', 'Name', 'Assistance Type', 'Quantity', 'Status', 'Date Released', 'Recorded'],
      rows: aid.map((a) => [
        a.reference_no, byId.get(a.beneficiary_id)?.beneficiary_number || '—',
        byId.get(a.beneficiary_id) ? name(byId.get(a.beneficiary_id)) : '—',
        a.assistance_type, Number(a.quantity), a.status, fmtDate(a.distributed_at), fmtDate(a.created_at)
      ])
    };
  }

  if (reportType === 'Activity log') {
    let query = db.from('audit_logs').select('action, entity, created_at').order('created_at', { ascending: false });
    if (dateFrom) query = query.gte('created_at', new Date(`${dateFrom}T00:00:00`).toISOString());
    if (dateTo) query = query.lte('created_at', new Date(`${dateTo}T23:59:59.999`).toISOString());
    const { data, error } = await query.limit(2000);
    if (error) throw new HttpError(500, error.message);
    return {
      columns: ['Action', 'Entity', 'Timestamp'],
      rows: (data || []).map((r) => [r.action, r.entity || '—', new Date(r.created_at).toISOString().replace('T', ' ').slice(0, 19)])
    };
  }

  // 'Period summary' — a rollup of the same live figures, one row per metric.
  const snapshot = (await buildSnapshot(reportType, { dateFrom, dateTo })).snapshot;
  const rows = [];
  const push = (metric, value) => rows.push([metric, String(value)]);
  push('Period from', snapshot.period_from);
  push('Period to', snapshot.period_to);
  push('Applications submitted', snapshot.applications_submitted);
  Object.entries(snapshot.by_application_status || {}).forEach(([k, v]) => push(`  · ${k}`, v));
  push('Duplicate flags filed', snapshot.duplicate_flags_filed);
  Object.entries(snapshot.by_flag_status || {}).forEach(([k, v]) => push(`  · ${k}`, v));
  push('Current vulnerability scores', snapshot.current_scores);
  Object.entries(snapshot.by_priority_class || {}).forEach(([k, v]) => push(`  · ${k}`, v));
  push('Distributions recorded', snapshot.distributions_recorded);
  Object.entries(snapshot.by_distribution_status || {}).forEach(([k, v]) => push(`  · ${k}`, v));
  return { columns: ['Metric', 'Value'], rows };
}

/**
 * RFC-4180 CSV encoder with formula-injection protection. A cell starting
 * with = + - @ (or tab/CR) is prefixed with a single quote so a spreadsheet
 * never executes report content as a formula.
 */
export function toCsv(columns, rows) {
  const safe = (value) => {
    let cell = value == null ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
    if (/[",\n\r]/.test(cell)) cell = `"${cell.replace(/"/g, '""')}"`;
    return cell;
  };
  const lines = [columns.map(safe).join(',')];
  for (const row of rows) lines.push(row.map(safe).join(','));
  // BOM so Excel opens UTF-8 accents correctly.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export default { REPORT_TYPES, listReports, createReport, buildExportRows, toCsv };
