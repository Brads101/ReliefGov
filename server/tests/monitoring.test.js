import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Batch 6 tests: Monitoring & Reporting, Aid Distribution Monitoring,
 * and the in-system Notification feature.
 *
 * Covers, per the capstone requirements:
 *  - Dashboard metrics are DATABASE-DRIVEN: every counter is compared
 *    against a direct DB count; empty data reads as zero, never invented.
 *    Beneficiaries never receive aggregate counters (restricted payload).
 *  - Report filters: valid/invalid types, inverted and malformed dates,
 *    date-range narrowing, and the Tambacan scope label on every report.
 *  - Exports: CSV carries the same authorization, scope and filters as the
 *    on-screen preview; formula-injection is neutralised; beneficiaries
 *    are refused.
 *  - Distribution workflow: only Approved (eligible, reviewed) records can
 *    receive aid; duplicate open plans are refused (409); Planned ->
 *    Released/Cancelled transitions are enforced with audit + a
 *    beneficiary notification; terminal states cannot be re-transitioned.
 *  - Notification permissions: users read only their own; a foreign id
 *    answers 404; mark-all only affects the caller; categories filter.
 *  - Data isolation between roles across all three features.
 *
 * Runs against the live Express app with the Supabase project in
 * server/.env so RLS, guard triggers and constraints are exercised for
 * real. All accounts, records, distributions and notifications created
 * here are removed afterwards.
 */

process.env.NODE_ENV = 'test';

const { default: app } = await import('../src/app.js');
const { default: env } = await import('../src/config/env.js');
const { supabaseAdmin } = await import('../src/lib/supabase.js');

const TEST_PASSWORD = 'Test!Pass123';
const createdUserIds = [];
const createdBeneficiaryIds = [];
const createdDistributionIds = [];
const createdReportIds = [];
let testStart = null;

let server;
let baseUrl;

// 1×1 PNG — accepted by the magic-byte sniffing in documentService.
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function appBody(overrides = {}) {
  return {
    first_name: 'Maica',
    middle_name: '',
    last_name: 'Sarmiento',
    sex: 'Female',
    date_of_birth: '1990-03-11',
    civil_status: 'Married',
    mobile_number: '09170000050',
    purok: 'Purok 4',
    household_size: 6,
    income_level: 'Low',
    monthly_family_income: 7000,
    house_status: 'Owned',
    incident_type: 'Flood',
    incident_date: '2026-10-01',
    incident_description: 'Floodwater damaged the family living room and kitchen area.',
    damage_extent: 'Major',
    ...overrides
  };
}

function uniqueEmail(prefix) {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@reliefgov.test`;
}

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  return { status: res.status, headers: res.headers, payload };
}

async function login(email, password = TEST_PASSWORD) {
  const res = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(res.payload)}`);
  return res.payload;
}

async function registerBeneficiary(prefix) {
  const email = uniqueEmail(prefix);
  const res = await api('/api/auth/register', {
    method: 'POST',
    body: { email, password: TEST_PASSWORD, full_name: `Batch6 ${prefix}` }
  });
  assert.equal(res.status, 201, `register failed: ${JSON.stringify(res.payload)}`);
  createdUserIds.push(res.payload.id);
  const session = await login(email);
  return { id: res.payload.id, email, token: session.token };
}

async function createStaff(prefix, role = 'barangay_staff') {
  const email = uniqueEmail(prefix);
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `Batch6 ${prefix}` }
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .update({ role, approval_status: 'approved', is_active: true })
    .eq('id', data.user.id);
  if (profileError) throw new Error(`profile setup failed: ${profileError.message}`);
  const session = await login(email);
  return { id: data.user.id, email, token: session.token };
}

async function uploadCertificate(token, beneficiaryId) {
  const res = await api('/api/documents', {
    method: 'POST',
    token,
    body: {
      file: { name: 'certificate.png', data: PNG_DATA_URL },
      beneficiary_id: beneficiaryId,
      purpose: 'Barangay certificate'
    }
  });
  assert.equal(res.status, 201, `certificate upload failed: ${JSON.stringify(res.payload)}`);
}

/** Creates + submits an application and moves it to the given status. */
async function createApplication(user, staff, toStatus, overrides = {}) {
  const created = await api('/api/applications/mine', {
    method: 'POST',
    token: user.token,
    body: appBody(overrides)
  });
  assert.equal(created.status, 201, `create failed: ${JSON.stringify(created.payload)}`);
  const id = created.payload.application.id;
  createdBeneficiaryIds.push(id);
  await uploadCertificate(user.token, id);
  const submitted = await api('/api/applications/mine/submit', { method: 'POST', token: user.token });
  assert.equal(submitted.status, 200, `submit failed: ${JSON.stringify(submitted.payload)}`);
  await api(`/api/applications/${id}/transition`, {
    method: 'POST',
    token: staff.token,
    body: { to_status: 'Under Verification' }
  });
  if (toStatus === 'Under Verification') return id;
  // Final decisions are CSWD-only.
  const res = await api(`/api/applications/${id}/transition`, {
    method: 'POST',
    token: (staffFinalToken || staff.token),
    body: { to_status: toStatus }
  });
  assert.equal(res.status, 200, `transition to ${toStatus} failed: ${JSON.stringify(res.payload)}`);
  return id;
}

/* ------------------------------------------------------------------ */
/* Setup / teardown                                                    */
/* ------------------------------------------------------------------ */

let barangayStaff;
let cswdStaff;
let staffFinalToken = null;
let applicantA;   // Approved → eligible for distribution
let applicantB;   // Under Verification → NOT eligible
let applicantC;   // Approved, second eligible record
let recordA;
let recordB;
let recordC;
let beneficiaryUser; // a second beneficiary for notification isolation

before(async () => {
  if (!env.supabaseConfigured || !supabaseAdmin) {
    throw new Error('Batch 6 tests require Supabase configuration in server/.env');
  }
  testStart = new Date().toISOString();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  barangayStaff = await createStaff('b6-brgy', 'barangay_staff');
  cswdStaff = await createStaff('b6-cswd', 'cswd_staff');
  staffFinalToken = cswdStaff.token;

  applicantA = await registerBeneficiary('b6-a');
  applicantB = await registerBeneficiary('b6-b');
  applicantC = await registerBeneficiary('b6-c');
  beneficiaryUser = await registerBeneficiary('b6-d');

  recordA = await createApplication(applicantA, barangayStaff, 'Approved');
  recordB = await createApplication(applicantB, barangayStaff, 'Under Verification');
  recordC = await createApplication(applicantC, barangayStaff, 'Approved');
});

after(async () => {
  try {
    const { data: docs } = await supabaseAdmin
      .from('documents')
      .select('storage_path')
      .in('uploaded_by', createdUserIds);
    if (docs?.length) {
      await supabaseAdmin.storage.from('beneficiary-documents').remove(docs.map((d) => d.storage_path));
    }
  } catch (err) {
    console.warn('storage cleanup failed:', err.message);
  }
  try {
    if (createdDistributionIds.length) {
      await supabaseAdmin.from('aid_distributions').delete().in('id', createdDistributionIds);
    }
  } catch (err) {
    console.warn('distribution cleanup failed:', err.message);
  }
  try {
    if (createdBeneficiaryIds.length) {
      await supabaseAdmin.from('vulnerability_scores').delete().in('beneficiary_id', createdBeneficiaryIds);
      await supabaseAdmin.from('aid_distributions').delete().in('beneficiary_id', createdBeneficiaryIds);
      const { data: rows } = await supabaseAdmin.from('beneficiaries').select('id').in('id', createdBeneficiaryIds);
      const ids = (rows || []).map((r) => r.id);
      if (ids.length) {
        await supabaseAdmin.from('validation_results').delete().in('candidate_id', ids);
        await supabaseAdmin.from('beneficiaries').delete().in('id', ids);
      }
    }
  } catch (err) {
    console.warn('beneficiary cleanup failed:', err.message);
  }
  try {
    if (createdReportIds.length) {
      await supabaseAdmin.from('reports').delete().in('id', createdReportIds);
    }
  } catch (err) {
    console.warn('report cleanup failed:', err.message);
  }
  for (const id of createdUserIds) {
    try {
      await supabaseAdmin.auth.admin.deleteUser(id);
    } catch (err) {
      console.warn('cleanup failed for', id, err.message);
    }
  }
  try {
    // Scoped to THIS run's own accounts (a bare timestamp-window delete
    // would race other test files on the shared live database). The window
    // delete below is additionally bounded to the three demo accounts, which
    // receive coordination notices via notifyRole — tests never assert on
    // demo inboxes, so even a raced delete cannot break an assertion.
    if (createdUserIds.length) {
      await supabaseAdmin.from('notifications').delete().in('user_id', createdUserIds);
    }
  } catch (err) {
    console.warn('notification cleanup failed:', err.message);
  }
  try {
    const demoEmails = [
      'beneficiary@reliefgov.demo',
      'tambacan.staff@reliefgov.demo',
      'cswd.staff@reliefgov.demo'
    ];
    const { data: demoProfiles } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .in('email', demoEmails);
    if (demoProfiles?.length && testStart) {
      await supabaseAdmin
        .from('notifications')
        .delete()
        .in('user_id', demoProfiles.map((p) => p.id))
        .gte('created_at', testStart);
    }
  } catch (err) {
    console.warn('demo notification cleanup failed:', err.message);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
});

/* ------------------------------------------------------------------ */
/* 1. Dashboard metrics are database-driven                             */
/* ------------------------------------------------------------------ */

test('staff dashboard counters equal direct database counts (nothing invented)', async () => {
  const res = await api('/api/dashboard/staff-summary', { token: barangayStaff.token });
  assert.equal(res.status, 200, JSON.stringify(res.payload));

  // Direct DB ground truth for Tambacan.
  const { count: totalRecords } = await supabaseAdmin
    .from('beneficiaries').select('id', { count: 'exact', head: true }).eq('barangay', 'Tambacan');
  const { count: submittedRecords } = await supabaseAdmin
    .from('beneficiaries').select('id', { count: 'exact', head: true })
    .eq('barangay', 'Tambacan').neq('application_status', 'Draft');
  const { count: openFlags } = await supabaseAdmin
    .from('validation_results').select('id', { count: 'exact', head: true }).eq('status', 'Flagged');

  assert.equal(res.payload.queue.total, submittedRecords, 'submitted total matches the DB');
  assert.ok(totalRecords >= submittedRecords, 'sanity: total >= submitted');
  assert.equal(res.payload.openDuplicateFlags, openFlags, 'duplicate flags match the DB');

  // Queue breakdown sums to the submitted total (no phantom buckets).
  const q = res.payload.queue;
  const sum = q.pending + q.under_verification + q.needs_correction + q.approved + q.rejected;
  assert.equal(sum, q.total, 'status buckets sum to the submitted total');

  assert.equal(res.payload.scope.barangay, 'Tambacan');
  assert.ok(res.payload.generatedAt, 'a timestamp accompanies the metrics');

  // Batch 6 additions: recent activity and the caller's own notification count.
  assert.ok(Array.isArray(res.payload.recentActivity), 'recent activity feed is present');
  assert.ok(typeof res.payload.notifications.unread === 'number', 'notification counter is present');
});

test('a beneficiary never receives aggregate dashboard counters (restricted payload)', async () => {
  const res = await api('/api/dashboard/summary', { token: applicantA.token });
  assert.equal(res.status, 200);
  assert.equal(res.payload.restricted, true, 'beneficiaries are told the data is restricted');
  assert.equal(res.payload.counts, null, 'no community-wide counts are exposed');
  assert.equal(res.payload.scope.barangay, 'Tambacan');
});

test('staff-summary is refused for beneficiary accounts', async () => {
  const res = await api('/api/dashboard/staff-summary', { token: applicantA.token });
  assert.equal(res.status, 403);
});

test('the activity feed contains only real audited actions', async () => {
  const res = await api('/api/dashboard/staff-summary', { token: cswdStaff.token });
  assert.equal(res.status, 200);
  // Every feed entry must be a genuine audit_logs row.
  const { data: actions } = await supabaseAdmin.from('audit_logs').select('action');
  const known = new Set((actions || []).map((a) => a.action));
  for (const entry of res.payload.recentActivity) {
    assert.ok(known.has(entry.action), `feed action "${entry.action}" must exist in audit_logs`);
    assert.ok(entry.at, 'each entry carries its timestamp');
  }
});

/* ------------------------------------------------------------------ */
/* 2. Report filters                                                   */
/* ------------------------------------------------------------------ */

test('report preparation validates type and date range', async () => {
  const badType = await api('/api/reports', {
    method: 'POST', token: barangayStaff.token, body: { report_type: 'Nonexistent report' }
  });
  assert.equal(badType.status, 400);
  assert.ok(badType.payload.error.details.report_type);

  const inverted = await api('/api/reports', {
    method: 'POST',
    token: barangayStaff.token,
    body: { report_type: 'Beneficiary registry', date_from: '2026-10-10', date_to: '2026-10-01' }
  });
  assert.equal(inverted.status, 400);
  assert.ok(inverted.payload.error.details.date_from);

  const malformed = await api('/api/reports', {
    method: 'POST',
    token: barangayStaff.token,
    body: { report_type: 'Activity log', date_from: 'not-a-date' }
  });
  assert.equal(malformed.status, 400);

  const badPreview = await api(
    '/api/reports/preview?report_type=Bogus', { token: barangayStaff.token });
  assert.equal(badPreview.status, 400);
});

test('every report type prepares successfully and snapshots the Tambacan scope', async () => {
  const types = [
    'Beneficiary registry', 'Validation summary', 'Duplicate review',
    'Vulnerability summary', 'Aid distribution', 'Activity log', 'Period summary'
  ];
  for (const reportType of types) {
    const res = await api('/api/reports', {
      method: 'POST', token: barangayStaff.token, body: { report_type: reportType }
    });
    assert.equal(res.status, 201, `${reportType}: ${JSON.stringify(res.payload)}`);
    createdReportIds.push(res.payload.report.id);
    const params = res.payload.report.parameters;
    assert.equal(params.scope.barangay, 'Tambacan', `${reportType} must carry the Tambacan scope`);
    assert.equal(params.scope.province, 'Lanao del Norte');
    assert.ok(res.payload.report.row_count >= 0, 'row count is a real number');
    assert.ok(res.payload.report.created_at, 'preparation timestamp recorded');
    assert.ok(params.snapshot, 'figures are snapshotted for audit');
  }
});

test('a date range narrows the report rows (filters are real)', async () => {
  const full = await api('/api/reports/preview?report_type=Activity log', { token: barangayStaff.token });
  assert.equal(full.status, 200);

  // A window far in the past contains none of today's activity.
  const narrow = await api(
    '/api/reports/preview?report_type=Activity log&date_from=2020-01-01&date_to=2020-12-31',
    { token: barangayStaff.token }
  );
  assert.equal(narrow.status, 200);
  assert.ok(narrow.payload.row_count < full.payload.row_count,
    'a past-only window returns fewer rows than the unfiltered report');
  assert.equal(narrow.payload.scope.barangay, 'Tambacan');
  assert.equal(narrow.payload.date_from, '2020-01-01');
});

/* ------------------------------------------------------------------ */
/* 3. Exports                                                          */
/* ------------------------------------------------------------------ */

test('CSV export uses the same authorization and filters as the on-screen preview', async () => {
  const preview = await api(
    '/api/reports/preview?report_type=Beneficiary registry', { token: cswdStaff.token });
  assert.equal(preview.status, 200);

  const res = await fetch(`${baseUrl}/api/reports/export?report_type=Beneficiary registry&format=csv`, {
    headers: { Authorization: `Bearer ${cswdStaff.token}` }
  });
  assert.equal(res.status, 200);
  const csv = await res.text();
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="reliefgov_beneficiary-registry_tambacan_.*\.csv"/);

  // Header row must equal the preview columns.
  const firstLine = csv.replace(/^\uFEFF/, '').split('\r\n')[0];
  assert.equal(firstLine, preview.payload.columns.map(csvCell).join(','),
    'export header matches the on-screen columns');

  // Row count matches the preview exactly.
  const dataLines = csv.trim().split('\r\n').filter((l) => l.length > 0);
  assert.equal(dataLines.length - 1, preview.payload.row_count, 'CSV body matches the preview rows');
  assert.equal(preview.payload.row_count, preview.payload.rows.length);
});

test('a date-range CSV carries the same narrowed rows as the preview', async () => {
  const query = 'report_type=Activity log&date_from=2020-01-01&date_to=2020-12-31';
  const preview = await api(`/api/reports/preview?${query}`, { token: barangayStaff.token });
  const res = await fetch(`${baseUrl}/api/reports/export?${query}&format=csv`, {
    headers: { Authorization: `Bearer ${barangayStaff.token}` }
  });
  assert.equal(res.status, 200);
  const csv = await res.text();
  const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n').filter((l) => l.length > 0);
  assert.equal(lines.length - 1, preview.payload.row_count, 'filtered export matches filtered preview');
});

test('CSV export neutralises spreadsheet formula injection', async () => {
  const { toCsv } = await import('../src/services/reportService.js');
  const csv = toCsv(['Name', 'Note'], [['=SUM(A1:A9)', 'normal'], ['+1234', 'ok']]);
  // A leading = must be escaped so no spreadsheet executes it.
  assert.ok(csv.includes("'=SUM(A1:A9)"), 'formula prefix escaped');
  assert.ok(csv.includes("'+1234"), 'plus prefix escaped');
  assert.ok(csv.includes('normal'), 'ordinary cells untouched');
});

test('beneficiaries cannot preview or export reports', async () => {
  const preview = await api('/api/reports/preview?report_type=Beneficiary registry', {
    token: applicantA.token
  });
  assert.equal(preview.status, 403);

  const res = await fetch(`${baseUrl}/api/reports/export?report_type=Beneficiary registry`, {
    headers: { Authorization: `Bearer ${applicantA.token}` }
  });
  assert.equal(res.status, 403);

  const list = await api('/api/reports', { token: applicantA.token });
  assert.equal(list.status, 403);
});

/* ------------------------------------------------------------------ */
/* 4. Aid distribution workflow                                        */
/* ------------------------------------------------------------------ */

test('distribution records can only be created for eligible (Approved) records', async () => {
  // Not eligible: still Under Verification.
  const ineligible = await api('/api/distributions', {
    method: 'POST',
    token: barangayStaff.token,
    body: { beneficiary_id: recordB, assistance_type: 'Relief goods', quantity: 2 }
  });
  assert.equal(ineligible.status, 400, JSON.stringify(ineligible.payload));
  assert.ok(ineligible.payload.error.details.beneficiary_id);

  // Missing beneficiary id.
  const missing = await api('/api/distributions', {
    method: 'POST', token: barangayStaff.token, body: { assistance_type: 'Relief goods' }
  });
  assert.equal(missing.status, 400);

  // Invalid assistance type.
  const badType = await api('/api/distributions', {
    method: 'POST',
    token: barangayStaff.token,
    body: { beneficiary_id: recordA, assistance_type: 'Gold bars', quantity: 1 }
  });
  assert.equal(badType.status, 400);
  assert.ok(badType.payload.error.details.assistance_type);

  // Invalid quantity.
  const badQty = await api('/api/distributions', {
    method: 'POST',
    token: barangayStaff.token,
    body: { beneficiary_id: recordA, assistance_type: 'Relief goods', quantity: -5 }
  });
  assert.equal(badQty.status, 400);

  // Eligible: Approved record, valid input.
  const ok = await api('/api/distributions', {
    method: 'POST',
    token: barangayStaff.token,
    body: { beneficiary_id: recordA, assistance_type: 'Relief goods', quantity: 2, notes: 'Family of six.' }
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.payload));
  const dist = ok.payload.distribution;
  createdDistributionIds.push(dist.id);
  assert.equal(dist.status, 'Planned', 'new entries start as Planned');
  assert.equal(dist.barangay, 'Tambacan', 'scope is set server-side');
  assert.equal(dist.recorded_by, barangayStaff.id, 'creation is attributed');
  assert.ok(dist.reference_no, 'a reference number is generated');
  assert.equal(dist.beneficiary.beneficiary_number.length > 0, true, 'beneficiary is joined for display');
});

test('duplicate open plans are refused; a new plan is allowed after release', async () => {
  // The same beneficiary + assistance type already has an open (Planned) entry.
  const dup = await api('/api/distributions', {
    method: 'POST',
    token: cswdStaff.token,
    body: { beneficiary_id: recordA, assistance_type: 'Relief goods', quantity: 1 }
  });
  assert.equal(dup.status, 409, JSON.stringify(dup.payload));
  assert.ok(dup.payload.error.details.reference_no, 'the conflicting reference is disclosed');

  // This deployment creates RELIEF GOODS only. Every other assistance type
  // (cash, food packs, medical, shelter repair, other) is refused server-side
  // with the allowed vocabulary named in the error — not merely hidden by the
  // client dropdown. Refused before the duplicate gate, so this holds even for
  // a beneficiary who already has an open plan.
  for (const assistanceType of [
    'Financial assistance',
    'Food pack',
    'Medical assistance',
    'Shelter repair',
    'Other'
  ]) {
    const refused = await api('/api/distributions', {
      method: 'POST',
      token: barangayStaff.token,
      body: { beneficiary_id: recordA, assistance_type: assistanceType, quantity: 1 }
    });
    assert.equal(refused.status, 400, `${assistanceType}: ${JSON.stringify(refused.payload)}`);
    assert.ok(
      refused.payload.error.details.assistance_type,
      `${assistanceType} is named in the refusal`
    );
    assert.match(refused.payload.error.details.assistance_type, /Relief goods/);
  }
});

test('Planned entries transition to Released with attribution and timestamp', async () => {
  const list = await api(`/api/distributions?status=Planned`, { token: barangayStaff.token });
  assert.equal(list.status, 200);
  const target = list.payload.distributions.find((d) => d.beneficiary?.id === recordA && d.assistance_type === 'Relief goods');
  assert.ok(target, 'the Planned relief-goods entry is listed');

  // Invalid target state.
  const bad = await api(`/api/distributions/${target.id}/status`, {
    method: 'POST', token: barangayStaff.token, body: { to_status: 'Pending' }
  });
  assert.equal(bad.status, 400);

  const res = await api(`/api/distributions/${target.id}/status`, {
    method: 'POST', token: cswdStaff.token, body: { to_status: 'Released' }
  });
  assert.equal(res.status, 200, JSON.stringify(res.payload));
  const released = res.payload.distribution;
  assert.equal(released.status, 'Released');
  assert.ok(released.distributed_at, 'release timestamp recorded');
  assert.equal(released.distributed_by, cswdStaff.id, 'release is attributed to the responsible staff');

  // Terminal: a released entry cannot be transitioned again.
  const again = await api(`/api/distributions/${target.id}/status`, {
    method: 'POST', token: cswdStaff.token, body: { to_status: 'Cancelled' }
  });
  assert.equal(again.status, 409, 'terminal states are enforced');

  // The beneficiary was notified, in-system only, with the right category.
  const { data: notes } = await supabaseAdmin
    .from('notifications')
    .select('title, category, level')
    .eq('user_id', applicantA.id)
    .eq('category', 'distribution');
  assert.ok(notes.length >= 1, 'the record owner is notified of the release');
  assert.ok(notes.some((n) => /released/i.test(n.title)), 'the release message is present');

  // Now a repeat relief-goods plan is allowed — the earlier entry is no longer open.
  const repeat = await api('/api/distributions', {
    method: 'POST',
    token: barangayStaff.token,
    body: { beneficiary_id: recordA, assistance_type: 'Relief goods', quantity: 1 }
  });
  assert.equal(repeat.status, 201, JSON.stringify(repeat.payload));
  createdDistributionIds.push(repeat.payload.distribution.id);
});

test('cancelling requires a documented reason', async () => {
  const list = await api('/api/distributions?status=Planned', { token: barangayStaff.token });
  const target = list.payload.distributions.find((d) => d.beneficiary?.id === recordA && d.assistance_type === 'Relief goods');
  assert.ok(target, 'the planned relief-goods entry is listed');

  const noReason = await api(`/api/distributions/${target.id}/status`, {
    method: 'POST', token: cswdStaff.token, body: { to_status: 'Cancelled' }
  });
  assert.equal(noReason.status, 400);
  assert.ok(noReason.payload.error.details.reason);

  const shortReason = await api(`/api/distributions/${target.id}/status`, {
    method: 'POST', token: cswdStaff.token, body: { to_status: 'Cancelled', reason: 'no' }
  });
  assert.equal(shortReason.status, 400);

  const ok = await api(`/api/distributions/${target.id}/status`, {
    method: 'POST',
    token: cswdStaff.token,
    body: { to_status: 'Cancelled', reason: 'Assistance released directly by another office.' }
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.payload));
  assert.equal(ok.payload.distribution.status, 'Cancelled');
  assert.match(ok.payload.distribution.status_reason, /another office/);

  // The cancelled entry is audited.
  const { data: audits } = await supabaseAdmin
    .from('audit_logs').select('action, detail').eq('entity_id', target.id);
  assert.ok(audits.some((a) => a.action === 'distribution.cancel'), 'cancellation is audited');
});

test('distribution monitoring refuses beneficiaries entirely', async () => {
  for (const [method, path] of [['GET', '/api/distributions'], ['GET', '/api/distributions/summary']]) {
    const res = await api(path, { method, token: applicantA.token });
    assert.equal(res.status, 403, `${method} ${path} must be staff-only`);
  }
  const post = await api('/api/distributions', {
    method: 'POST', token: applicantA.token, body: { beneficiary_id: recordA, assistance_type: 'Relief goods' }
  });
  assert.equal(post.status, 403);
});

test('distribution summary counts match the database', async () => {
  const res = await api('/api/distributions/summary', { token: barangayStaff.token });
  assert.equal(res.status, 200);
  const { count: dbTotal } = await supabaseAdmin
    .from('aid_distributions').select('id', { count: 'exact', head: true }).eq('barangay', 'Tambacan');
  assert.equal(res.payload.total, dbTotal, 'summary total matches the DB');
  const statusSum = Object.values(res.payload.by_status).reduce((a, b) => a + b, 0);
  assert.equal(statusSum, res.payload.total, 'status buckets sum to the total');
  assert.equal(res.payload.scope.barangay, 'Tambacan');
});

/* ------------------------------------------------------------------ */
/* 5. Notification permissions and isolation                           */
/* ------------------------------------------------------------------ */

test('users read only their own notifications; a foreign id answers 404', async () => {
  // Staff user A creates a notification for themselves via a real action:
  // the barangay staff "new submission" alert already fired for recordA.
  const mine = await api('/api/notifications', { token: barangayStaff.token });
  assert.equal(mine.status, 200);
  assert.ok(Array.isArray(mine.payload.notifications));

  const theirs = await api('/api/notifications', { token: applicantA.token });
  assert.equal(theirs.status, 200);

  // The two inboxes must not share entries.
  const mineIds = new Set(mine.payload.notifications.map((n) => n.id));
  for (const n of theirs.payload.notifications) {
    assert.ok(!mineIds.has(n.id), 'inboxes are isolated between accounts');
  }

  // Marking someone else's notification as read answers 404 — it is never
  // confirmed to exist and never altered.
  const foreign = theirs.payload.notifications[0];
  if (foreign) {
    const attempt = await api(`/api/notifications/${foreign.id}/read`, {
      method: 'POST', token: cswdStaff.token
    });
    assert.equal(attempt.status, 404, 'a foreign notification id is indistinguishable from a missing one');
  }
});

test('mark-all-as-read only affects the caller', async () => {
  const beforeOther = await api('/api/notifications/counts', { token: applicantB.token });
  assert.equal(beforeOther.status, 200);

  const res = await api('/api/notifications/read-all', { method: 'POST', token: applicantA.token });
  assert.equal(res.status, 200);

  const afterMine = await api('/api/notifications/counts', { token: applicantA.token });
  assert.equal(afterMine.payload.unread, 0, 'caller inbox fully read');

  const afterOther = await api('/api/notifications/counts', { token: applicantB.token });
  assert.equal(afterOther.payload.unread, beforeOther.payload.unread,
    'another account unread count is untouched');
});

test('notification categories filter correctly and reject unknown values', async () => {
  const res = await api('/api/notifications?category=distribution', { token: applicantA.token });
  assert.equal(res.status, 200);
  for (const n of res.payload.notifications) {
    assert.equal(n.category, 'distribution', 'category filter applies to every row');
  }

  const bad = await api('/api/notifications?category=quantum', { token: applicantA.token });
  assert.equal(bad.status, 400);
  assert.ok(bad.payload.error.details.category);

  const unread = await api('/api/notifications?unread=true', { token: barangayStaff.token });
  assert.equal(unread.status, 200);
  for (const n of unread.payload.notifications) {
    assert.equal(n.read_at, null, 'unread filter returns only unread rows');
  }
});

test('the notification schema enforces the category vocabulary and in-app links only', async () => {
  // Database-level check: an unknown category is rejected outright.
  const { error } = await supabaseAdmin.from('notifications').insert({
    user_id: applicantA.id,
    title: 'probe',
    body: 'probe',
    category: 'not-a-category'
  });
  assert.ok(error, 'the database rejects unknown categories');

  // A stored link path is in-app only (sanitised by the service).
  const { data: sample } = await supabaseAdmin
    .from('notifications').select('link_path').not('link_path', 'is', null).limit(1);
  for (const row of sample || []) {
    assert.match(row.link_path, /^\/[A-Za-z0-9\-_/]+$/, 'links are in-app paths, never remote URLs');
  }
});

/* ------------------------------------------------------------------ */
/* 6. Cross-feature data isolation                                     */
/* ------------------------------------------------------------------ */

test('role isolation holds across every Batch 6 staff endpoint', async () => {
  const staffOnly = [
    '/api/distributions',
    '/api/distributions/summary',
    '/api/reports',
    '/api/reports/preview?report_type=Activity log',
    '/api/dashboard/staff-summary'
  ];
  for (const path of staffOnly) {
    const res = await api(path, { token: beneficiaryUser.token });
    assert.equal(res.status, 403, `${path} must refuse beneficiary accounts`);
  }
});

test('the prepared reports list is shared by both staff roles and scoped to Tambacan', async () => {
  const brgy = await api('/api/reports', { token: barangayStaff.token });
  const cswd = await api('/api/reports', { token: cswdStaff.token });
  assert.equal(brgy.status, 200);
  assert.equal(cswd.status, 200);

  const brgyIds = new Set(brgy.payload.reports.map((r) => r.id));
  for (const r of cswd.payload.reports) {
    assert.ok(brgyIds.has(r.id), 'both staff roles see the same report list');
  }
  for (const r of brgy.payload.reports) {
    if (createdReportIds.includes(r.id)) {
      assert.equal(r.parameters.scope.barangay, 'Tambacan');
    }
  }
});

/** Minimal CSV cell encoder mirroring the server's, for header comparison. */
function csvCell(value) {
  let cell = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  if (/[",\n\r]/.test(cell)) cell = `"${cell.replace(/"/g, '""')}"`;
  return cell;
}
