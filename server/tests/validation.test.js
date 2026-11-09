import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Batch 4 tests: Data Validation, Duplicate Detection, and the authorized
 * review workflow. Exercises the full journey — submission → barangay
 * verification → CSWD review — plus duplicate flags with evidence,
 * reviewer decisions (confirm / dismiss / request info), rejected and
 * returned records, document review, report preparation, unauthorized
 * actions and the Tambacan-only restriction. Runs against the live Express
 * app with the Supabase project configured in server/.env so RLS, guard
 * triggers and constraints are exercised for real. All accounts, records
 * and reports created here are removed afterwards.
 */

process.env.NODE_ENV = 'test';

const { default: app } = await import('../src/app.js');
const { default: env } = await import('../src/config/env.js');
const { supabaseAdmin } = await import('../src/lib/supabase.js');
const { nameSimilarity, scorePair, normalizeMobile } = await import('../src/lib/duplicates.js');

const TEST_PASSWORD = 'Test!Pass123';
const createdUserIds = [];
const createdEmails = [];
let testStart = null;

let server;
let baseUrl;

// 1×1 PNG — accepted by the magic-byte sniffing in documentService.
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function appBody(overrides = {}) {
  return {
    first_name: 'Zyria',
    middle_name: '',
    last_name: 'Quindalven',
    sex: 'Female',
    date_of_birth: '1990-05-12',
    civil_status: 'Single',
    mobile_number: '09170000001',
    purok: 'Purok 3',
    household_size: 4,
    income_level: 'Low',
    monthly_family_income: 7500,
    house_status: 'Owned',
    incident_type: 'Flood',
    incident_date: '2026-09-20',
    incident_description: 'The river overflowed and flood water reached waist level inside our home.',
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
  let payload = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  return { status: res.status, payload };
}

async function login(email, password = TEST_PASSWORD) {
  const res = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(res.payload)}`);
  return res.payload;
}

/** Registers through the public endpoint (exercises the real signup path). */
async function registerBeneficiary(prefix) {
  const email = uniqueEmail(prefix);
  const res = await api('/api/auth/register', {
    method: 'POST',
    body: { email, password: TEST_PASSWORD, full_name: `Batch4 ${prefix}` }
  });
  assert.equal(res.status, 201, `register failed: ${JSON.stringify(res.payload)}`);
  createdUserIds.push(res.payload.id);
  createdEmails.push(email);
  const session = await login(email);
  return { id: res.payload.id, email, token: session.token, accessToken: session.accessToken };
}

/** Creates an approved staff user directly, like CSWD provisioning does. */
async function createStaff(prefix, role = 'barangay_staff') {
  const email = uniqueEmail(prefix);
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `Batch4 ${prefix}` }
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  createdEmails.push(email);
  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .update({ role, approval_status: 'approved', is_active: true })
    .eq('id', data.user.id);
  if (profileError) throw new Error(`profile setup failed: ${profileError.message}`);
  const session = await login(email);
  return { id: data.user.id, email, token: session.token, accessToken: session.accessToken };
}

async function postgrest(path, { method = 'GET', token, body } = {}) {
  const headers = {
    apikey: env.supabaseAnonKey,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };
  const res = await fetch(`${env.supabaseUrl}/rest/v1/${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return { status: res.status, ok: res.ok, payload };
}

const getMine = (token) => api('/api/applications/mine', { token });
const submit = (token) => api('/api/applications/mine/submit', { method: 'POST', token });

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
  return res.payload.document;
}

/** Create (if needed) + upload certificate + submit; returns the app row. */
async function submitApplication(user, overrides = {}) {
  const created = await api('/api/applications/mine', {
    method: 'POST',
    token: user.token,
    body: appBody(overrides)
  });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  const appRow = created.payload.application;
  await uploadCertificate(user.token, appRow.id);
  const result = await submit(user.token);
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  return result.payload.application;
}

const transition = (staff, id, body) =>
  api(`/api/applications/${id}/transition`, { method: 'POST', token: staff.token, body });

async function notificationsFor(token) {
  const res = await api('/api/notifications', { token });
  assert.equal(res.status, 200, JSON.stringify(res.payload));
  return res.payload.notifications;
}

// Test cast — distinct synthetic names so the live demo records are never
// matched by the duplicate scanner.
let applicantA; // main workflow record (Zyria Quindalven)
let applicantB; // same name + date of birth as A → high-confidence flag
let applicantC; // same name only → low-confidence flag
let applicantD; // approved by CSWD
let applicantE; // rejected by CSWD
let applicantF; // stays a Draft (never in the staff queue)
let barangayStaff;
let cswdStaff;

let appA;
let appB;
let appC;
let appD;
let appE;
let appF;
let docA;
let highFlag;
let lowFlag;
let secondCFlag;

/**
 * Interrupted runs (restart, crash, Ctrl+C) never reach after(), so their
 * fixture accounts and records stay in the live database. This file uses a
 * FIXED fixture identity (Zyria Quindalven, 1990-05-12), so a leftover row
 * makes the next run's fresh submission legitimately duplicate-flagged —
 * a real flag raised against data that should not exist. Sweep leftovers
 * before creating ours, keyed strictly on @reliefgov.test accounts so live
 * demo, legacy and protected records are never touched.
 */
async function sweepLeftovers() {
  const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  const stale = (users?.users || []).filter((u) => String(u.email || '').endsWith('@reliefgov.test'));
  if (!stale.length) return;

  const ids = new Set(stale.map((u) => u.id));
  const { data: orphans } = await supabaseAdmin
    .from('beneficiaries')
    .select('id')
    .in('user_id', [...ids]);
  for (const b of orphans || []) ids.add(b.id);

  const spec = await fetch(`${env.supabaseUrl}/rest/v1/`, {
    headers: { apikey: env.supabaseAnonKey, Authorization: `Bearer ${env.supabaseAnonKey}` }
  })
    .then((r) => r.json())
    .catch(() => null);

  const storagePaths = [];
  const tableNames = new Set([
    ...Object.keys(spec?.definitions || {}),
    ...Object.keys(spec?.components?.schemas || {}),
    'validation_results', 'documents', 'vulnerability_scores', 'verification_reviews',
    'application_status_history', 'notifications', 'beneficiaries'
  ]);
  for (const table of tableNames) {
    try {
      const { data: rows } = await supabaseAdmin.from(table).select('*').limit(1000);
      const hits = (rows || []).filter((r) =>
        Object.values(r).some((v) => typeof v === 'string' && ids.has(v))
      );
      if (!hits.length) continue;
      if (table === 'documents') {
        for (const h of hits) if (h.storage_path) storagePaths.push(h.storage_path);
      }
      const rowIds = hits.map((h) => h.id).filter(Boolean);
      if (rowIds.length) await supabaseAdmin.from(table).delete().in('id', rowIds);
    } catch (err) {
      console.warn(`sweep skipped ${table}:`, err.message);
    }
  }

  // Ensure any fixture identity from previous interrupted runs is completely removed
  try {
    await supabaseAdmin.from('beneficiaries').delete().eq('first_name', 'Zyria').eq('last_name', 'Quindalven');
    await supabaseAdmin.from('beneficiaries').delete().eq('first_name', 'Maria').eq('last_name', 'Clara');
  } catch {}

  if (storagePaths.length) {
    try {
      await supabaseAdmin.storage.from('beneficiary-documents').remove(storagePaths);
    } catch (err) {
      console.warn('sweep storage cleanup failed:', err.message);
    }
  }

  for (const id of stale.map((u) => u.id)) {
    try {
      await supabaseAdmin.auth.admin.deleteUser(id);
    } catch (err) {
      console.warn('sweep failed to delete user', id, err.message);
    }
  }
  console.warn(`swept ${stale.length} leftover test account(s) from an interrupted run`);
}

before(async () => {
  if (!env.supabaseConfigured || !supabaseAdmin) {
    throw new Error('Batch 4 tests require Supabase configuration in server/.env');
  }
  await sweepLeftovers();
  testStart = new Date().toISOString();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  applicantA = await registerBeneficiary('b4-a');
  applicantB = await registerBeneficiary('b4-b');
  applicantC = await registerBeneficiary('b4-c');
  applicantD = await registerBeneficiary('b4-d');
  applicantE = await registerBeneficiary('b4-e');
  applicantF = await registerBeneficiary('b4-f');
  barangayStaff = await createStaff('b4-brgy', 'barangay_staff');
  cswdStaff = await createStaff('b4-cswd', 'cswd_staff');
});

after(async () => {
  try {
    const { data: docs } = await supabaseAdmin
      .from('documents')
      .select('storage_path')
      .in('uploaded_by', createdUserIds);
    if (docs?.length) {
      await supabaseAdmin.storage
        .from('beneficiary-documents')
        .remove(docs.map((d) => d.storage_path));
    }
  } catch (err) {
    console.warn('storage cleanup failed:', err.message);
  }
  try {
    // Reports have no FK — remove the ones prepared by test accounts so the
    // live demo report list stays clean.
    await supabaseAdmin.from('reports').delete().in('generated_by', createdUserIds);
  } catch (err) {
    console.warn('report cleanup failed:', err.message);
  }
  try {
    // Flags whose CANDIDATE is a test record but whose flagged side is not
    // (defensive — normally they cascade with the beneficiary row).
    if (createdUserIds.length) {
      const { data: rows } = await supabaseAdmin
        .from('beneficiaries')
        .select('id')
        .in('user_id', createdUserIds);
      const ids = (rows || []).map((r) => r.id);
      if (ids.length) {
        await supabaseAdmin.from('validation_results').delete().in('candidate_id', ids);
        await supabaseAdmin.from('beneficiaries').delete().in('id', ids);
      }
    }
  } catch (err) {
    console.warn('beneficiary cleanup failed:', err.message);
  }
  for (const id of createdUserIds) {
    try {
      await supabaseAdmin.auth.admin.deleteUser(id); // cascades notifications
    } catch (err) {
      console.warn('cleanup failed for', id, err.message);
    }
  }
  try {
    // Staff-role notifications (new submissions, returns, endorsements) go to
    // every active staff profile — drop the ones this run created for the
    // standing demo accounts.
    if (testStart) {
      let query = supabaseAdmin
        .from('notifications')
        .delete()
        .gte('created_at', testStart);
      if (createdUserIds.length) {
        query = query.not('user_id', 'in', `(${createdUserIds.join(',')})`);
      }
      await query;
    }
  } catch (err) {
    console.warn('notification cleanup failed:', err.message);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
});

/* ------------------------------------------------------------------ */
/* 1. Authorization: only staff may validate                          */
/* ------------------------------------------------------------------ */

test('unauthenticated callers get 401 on validation endpoints', async () => {
  const queue = await api('/api/validation/queue');
  assert.equal(queue.status, 401);
  const flags = await api('/api/validation/duplicates');
  assert.equal(flags.status, 401);
  const reports = await api('/api/reports');
  assert.equal(reports.status, 401);
});

test('beneficiaries cannot use the validation, report, or document-review endpoints', async () => {
  const queue = await api('/api/validation/queue', { token: applicantA.token });
  assert.equal(queue.status, 403, 'queue must be staff-only');
  const detail = await api('/api/validation/some-id', { token: applicantA.token });
  assert.equal(detail.status, 403);
  const duplicates = await api('/api/validation/duplicates', { token: applicantA.token });
  assert.equal(duplicates.status, 403);
  const decision = await api('/api/validation/flags/some-id', {
    method: 'POST',
    token: applicantA.token,
    body: { action: 'dismiss', notes: 'applicant must not decide flags' }
  });
  assert.equal(decision.status, 403);
  const reportCreate = await api('/api/reports', {
    method: 'POST',
    token: applicantA.token,
    body: { report_type: 'Validation summary' }
  });
  assert.equal(reportCreate.status, 403, 'beneficiaries cannot prepare reports');
  const docReview = await api('/api/documents/some-id/status', {
    method: 'PATCH',
    token: applicantA.token,
    body: { status: 'Accepted' }
  });
  assert.equal(docReview.status, 403, 'beneficiaries cannot review documents');
});

/* ------------------------------------------------------------------ */
/* 2. Submission enters the validation queue                          */
/* ------------------------------------------------------------------ */

test('a submitted application appears in the Tambacan-only staff queue', async () => {
  appA = await submitApplication(applicantA);
  assert.equal(appA.application_status, 'Pending');

  const res = await api('/api/validation/queue', { token: barangayStaff.token });
  assert.equal(res.status, 200, JSON.stringify(res.payload));
  const row = res.payload.rows.find((r) => r.id === appA.id);
  assert.ok(row, 'the submitted record is in the queue');
  assert.equal(row.barangay, 'Tambacan');
  assert.equal(row.application_status, 'Pending');
  assert.equal(row.duplicate_flagged, false);
  assert.equal(res.payload.scope.barangay, 'Tambacan');
  for (const r of res.payload.rows) {
    assert.equal(r.barangay, 'Tambacan', 'the queue never serves other barangays');
  }
});

test('unsubmitted drafts never appear in the staff queue or detail view', async () => {
  const created = await api('/api/applications/mine', {
    method: 'POST',
    token: applicantF.token,
    body: appBody({ first_name: 'Drafty', last_name: 'Onlyperson' })
  });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  appF = created.payload.application;
  assert.equal(appF.application_status, 'Draft');

  const queue = await api('/api/validation/queue?limit=100', { token: cswdStaff.token });
  assert.equal(queue.status, 200);
  assert.equal(
    queue.payload.rows.some((r) => r.id === appF.id),
    false,
    'drafts are the applicant’s private workspace'
  );

  const detail = await api(`/api/validation/${appF.id}`, { token: cswdStaff.token });
  assert.equal(detail.status, 404, 'staff cannot open an unsubmitted draft');
});

test('the queue supports search and status, purok, and date filters — with validation', async () => {
  const bySearch = await api(`/api/validation/queue?search=${appA.beneficiary_number}`, {
    token: barangayStaff.token
  });
  assert.equal(bySearch.status, 200);
  assert.ok(bySearch.payload.rows.some((r) => r.id === appA.id), 'reference-number search works');

  const byName = await api('/api/validation/queue?search=Zyria', { token: barangayStaff.token });
  assert.ok(byName.payload.rows.some((r) => r.id === appA.id), 'name search works');

  const byStatus = await api('/api/validation/queue?status=Pending', { token: barangayStaff.token });
  assert.equal(byStatus.status, 200);
  assert.ok(byStatus.payload.rows.every((r) => r.application_status === 'Pending'));

  const byPurok = await api('/api/validation/queue?purok=Purok 3', { token: barangayStaff.token });
  assert.equal(byPurok.status, 200);
  assert.ok(byPurok.payload.rows.some((r) => r.id === appA.id));

  const today = new Date().toISOString().slice(0, 10);
  const byDate = await api(`/api/validation/queue?from=${today}`, { token: barangayStaff.token });
  assert.equal(byDate.status, 200);
  assert.ok(byDate.payload.rows.some((r) => r.id === appA.id), 'submitted today → included');

  const future = await api('/api/validation/queue?from=2100-01-01', { token: barangayStaff.token });
  assert.equal(future.payload.total, 0, 'a future date range returns nothing');

  const badStatus = await api('/api/validation/queue?status=Whateven', { token: barangayStaff.token });
  assert.equal(badStatus.status, 400, 'unknown filters are rejected server-side');

  const badDate = await api('/api/validation/queue?from=not-a-date', { token: barangayStaff.token });
  assert.equal(badDate.status, 400);

  const inverted = await api('/api/validation/queue?from=2026-10-01&to=2026-09-01', {
    token: barangayStaff.token
  });
  assert.equal(inverted.status, 400, 'an inverted date range is rejected');
});

test('staff can open the full review bundle for a record; applicants cannot', async () => {
  const ownerView = await api(`/api/validation/${appA.id}`, { token: applicantA.token });
  assert.equal(ownerView.status, 403, 'applicants never see the staff review view');

  const res = await api(`/api/validation/${appA.id}`, { token: barangayStaff.token });
  assert.equal(res.status, 200, JSON.stringify(res.payload));
  assert.equal(res.payload.application.id, appA.id);
  assert.ok(Array.isArray(res.payload.documents), 'documents included');
  assert.ok(Array.isArray(res.payload.history), 'status history included');
  assert.ok(Array.isArray(res.payload.reviews), 'verification reviews included');
  assert.ok(Array.isArray(res.payload.flags), 'duplicate flags included');
  assert.equal(res.payload.applicant.role, 'beneficiary');
  assert.equal(res.payload.capabilities.canStartVerification, true, 'Pending → can start verification');
  assert.equal(res.payload.capabilities.canApprove, false, 'barangay staff may not approve');

  const missing = await api('/api/validation/00000000-0000-4000-8000-000000000000', {
    token: barangayStaff.token
  });
  assert.equal(missing.status, 404, 'unknown ids are a clean 404');
});

/* ------------------------------------------------------------------ */
/* 3. Verification workflow: separation of duties                     */
/* ------------------------------------------------------------------ */

test('barangay staff start verification with remarks, recorded for audit', async () => {
  const res = await transition(barangayStaff, appA.id, {
    to_status: 'Under Verification',
    remarks: 'Residence and barangay certificate checked at the barangay hall.'
  });
  assert.equal(res.status, 200, JSON.stringify(res.payload));
  assert.equal(res.payload.application.application_status, 'Under Verification');

  const detail = await api(`/api/validation/${appA.id}`, { token: barangayStaff.token });
  const review = detail.payload.reviews.find((r) => r.outcome === 'Under Verification');
  assert.ok(review, 'the verification outcome was recorded');
  assert.equal(review.stage, 'barangay_verification');
  assert.equal(review.reviewer_role, 'barangay_staff');
  assert.equal(review.reviewer_id, barangayStaff.id);
  assert.match(review.remarks, /certificate checked/);

  const historyEntry = detail.payload.history.find((h) => h.to_status === 'Under Verification');
  assert.ok(historyEntry, 'the status change is in the timeline');
  assert.equal(historyEntry.actor_role, 'barangay_staff');
});

test('CSWD receives an endorsement notification when barangay verifies', async () => {
  const notes = await notificationsFor(cswdStaff.token);
  const endorsed = notes.find((n) => n.title === 'Endorsed for CSWD review');
  assert.ok(endorsed, 'CSWD staff are told a record is ready for final review');
  assert.match(endorsed.body, new RegExp(appA.beneficiary_number));
});

test('barangay staff cannot approve or reject — CSWD holds the final decision', async () => {
  const approve = await transition(barangayStaff, appA.id, { to_status: 'Approved' });
  assert.equal(approve.status, 403, 'approval is CSWD-only');
  const reject = await transition(barangayStaff, appA.id, {
    to_status: 'Rejected',
    reason: 'Attempting a final decision as barangay staff.'
  });
  assert.equal(reject.status, 403, 'rejection is CSWD-only');

  const detail = await api(`/api/validation/${appA.id}`, { token: barangayStaff.token });
  assert.equal(detail.payload.application.application_status, 'Under Verification', 'status unchanged');
});

test('a record can be returned for correction with a required reason', async () => {
  const noReason = await transition(barangayStaff, appA.id, { to_status: 'Needs Correction' });
  assert.equal(noReason.status, 400, 'a reason is required');

  const res = await transition(barangayStaff, appA.id, {
    to_status: 'Needs Correction',
    reason: 'Please upload a clearer photo of the damage on the roof.'
  });
  assert.equal(res.status, 200, JSON.stringify(res.payload));
  assert.equal(res.payload.application.application_status, 'Needs Correction');
  assert.match(res.payload.application.status_reason, /clearer photo/);

  // The applicant may edit again after a return.
  const edit = await api('/api/applications/mine', {
    method: 'PATCH',
    token: applicantA.token,
    body: { incident_description: 'Flood water reached waist level; roof sheets were torn off during the typhoon.' }
  });
  assert.equal(edit.status, 200, 'the applicant can correct and resubmit');

  // Applicant + barangay staff are both notified.
  const applicantNotes = await notificationsFor(applicantA.token);
  assert.ok(applicantNotes.some((n) => n.title === 'Changes needed on your application'));
  const staffNotes = await notificationsFor(barangayStaff.token);
  assert.ok(staffNotes.some((n) => n.title === 'Returned record'), 'barangay staff see returned records');
});

test('resubmission returns the record to the queue and alerts barangay staff', async () => {
  const res = await submit(applicantA.token);
  assert.equal(res.status, 200, JSON.stringify(res.payload));
  assert.equal(res.payload.application.application_status, 'Pending');
  appA = res.payload.application;

  const staffNotes = await notificationsFor(barangayStaff.token);
  const fresh = staffNotes.filter((n) => n.title === 'New application submitted');
  assert.ok(fresh.length >= 1, 'every submission notifies the barangay office');
});

/* ------------------------------------------------------------------ */
/* 4. Duplicate detection                                              */
/* ------------------------------------------------------------------ */

test('a matching name + date of birth raises a high-confidence flag with evidence', async () => {
  appB = await submitApplication(applicantB, {
    mobile_number: '09170000002' // same name and DOB as A, different number
  });
  assert.equal(appB.application_status, 'Pending', 'submission is never auto-rejected');

  const { payload } = await api('/api/validation/duplicates', { token: cswdStaff.token });
  assert.equal(payload.status, 'Flagged');
  highFlag = payload.flags.find(
    (f) => f.beneficiary_id === appB.id && f.candidate_id === appA.id
  );
  assert.ok(highFlag, 'the pair B↔A is flagged for human review');
  assert.equal(highFlag.confidence, 'high', 'name + date of birth is strong evidence');
  assert.ok(highFlag.similarity_score > 0.5);
  assert.ok(
    highFlag.match_details.evidence.some((e) => /date of birth/i.test(e)),
    'the flag explains itself: date of birth matches'
  );
  assert.ok(
    highFlag.match_details.evidence.some((e) => /name/i.test(e)),
    'the flag explains itself: name evidence present'
  );
  assert.equal(highFlag.flagged_record.id, appB.id, 'both records are hydrated for reviewers');
  assert.equal(highFlag.candidate_record.id, appA.id);

  const detail = await api(`/api/validation/${appB.id}`, { token: barangayStaff.token });
  assert.equal(detail.payload.application.validation_status, 'Flagged', 'flagged in the registry');
  assert.equal(detail.payload.application.application_status, 'Pending', 'workflow status untouched');
  const aDetail = await api(`/api/validation/${appA.id}`, { token: barangayStaff.token });
  assert.equal(aDetail.payload.flags.some((f) => f.id === highFlag.id), true, 'the original record shows the flag too');
});

test('a name-only similarity raises only a low-confidence flag', async () => {
  appC = await submitApplication(applicantC, {
    date_of_birth: '1995-02-02', // same name as A and B, different life facts
    mobile_number: '09170000003',
    purok: 'Purok 7', // …and a different purok/family size, so the ONLY
    household_size: 3 // overlap left is the name itself
  });

  const { payload } = await api('/api/validation/duplicates', { token: cswdStaff.token });
  const flagsForC = payload.flags.filter((f) => f.beneficiary_id === appC.id);
  assert.ok(flagsForC.length >= 1, 'a name match is still worth a human look');
  lowFlag = flagsForC.find((f) => f.candidate_id === appA.id) || flagsForC[0];
  assert.equal(lowFlag.confidence, 'low', 'a matching name alone is NEVER stronger than low');
  secondCFlag = flagsForC.find((f) => f.id !== lowFlag.id) || null;

  const detail = await api(`/api/validation/${appC.id}`, { token: barangayStaff.token });
  assert.equal(detail.payload.application.application_status, 'Pending', 'no automatic rejection');
  assert.equal(detail.payload.capabilities.canStartVerification, true, 'a flagged record can still be processed');
});

test('the queue can filter to flagged records, and flags carry reviewer fields', async () => {
  const res = await api('/api/validation/queue?duplicate=flagged&limit=100', { token: barangayStaff.token });
  assert.equal(res.status, 200);
  for (const id of [appA.id, appB.id, appC.id]) {
    assert.ok(res.payload.rows.some((r) => r.id === id), 'all three flagged records are listed');
    const row = res.payload.rows.find((r) => r.id === id);
    assert.equal(row.duplicate_flagged, true);
  }
  const bad = await api('/api/validation/queue?duplicate=everything', { token: barangayStaff.token });
  assert.equal(bad.status, 400);

  const flags = await api('/api/validation/duplicates', { token: barangayStaff.token });
  assert.ok(flags.payload.total >= 3, 'open flags listed with evidence for review');
  assert.ok(flags.payload.flags.every((f) => f.status === 'Flagged'));
});

test('reviewers confirm a duplicate — records are linked, never deleted', async () => {
  const noNotes = await api(`/api/validation/flags/${highFlag.id}`, {
    method: 'POST',
    token: cswdStaff.token,
    body: { action: 'confirm' }
  });
  assert.equal(noNotes.status, 400, 'every decision needs a note');

  const res = await api(`/api/validation/flags/${highFlag.id}`, {
    method: 'POST',
    token: cswdStaff.token,
    body: {
      action: 'confirm',
      notes: 'Same person re-applied after a typhoon; birth date and name agree.'
    }
  });
  assert.equal(res.status, 200, JSON.stringify(res.payload));
  assert.equal(res.payload.flag.status, 'Confirmed');
  assert.equal(res.payload.flag.decision, 'confirm');
  assert.equal(res.payload.flag.reviewed_by, cswdStaff.id, 'reviewer recorded');
  assert.ok(res.payload.flag.reviewed_at, 'timestamp recorded');
  assert.match(res.payload.flag.notes, /Same person re-applied/);

  const detail = await api(`/api/validation/${appB.id}`, { token: cswdStaff.token });
  assert.equal(detail.payload.application.validation_status, 'Duplicate');
  assert.equal(detail.payload.application.duplicate_of, appA.id, 'linked to the original record');
  assert.equal(
    detail.payload.application.application_status,
    'Pending',
    'confirming a duplicate does NOT reject or delete anything automatically'
  );

  const again = await api(`/api/validation/flags/${highFlag.id}`, {
    method: 'POST',
    token: cswdStaff.token,
    body: { action: 'dismiss', notes: 'Trying to reverse a final decision.' }
  });
  assert.equal(again.status, 409, 'decisions are final and kept for audit');

  const { payload: auditRows } = await postgrest(
    `audit_logs?actor_id=eq.${cswdStaff.id}&action=eq.validation.confirm&select=id,detail`,
    { token: cswdStaff.accessToken } // Supabase JWT for RLS, not the app token
  );
  assert.ok(
    (auditRows || []).some((row) => row.detail?.flag_id === highFlag.id),
    'the decision is in the audit trail'
  );
});

test('only CSWD Staff can dismiss a flag; Barangay Staff can still request information', async () => {
  // Barangay Staff may view flags but cannot clear (unflag) one — not through
  // the API either. The refused call must leave the flag untouched.
  const brgyDismiss = await api(`/api/validation/flags/${lowFlag.id}`, {
    method: 'POST',
    token: barangayStaff.token,
    body: { action: 'dismiss', notes: 'Different birth dates — not the same person.' }
  });
  assert.equal(brgyDismiss.status, 403, 'barangay staff cannot unflag a record');
  assert.match(brgyDismiss.payload.error.message, /CSWD/);

  const stillOpen = await api('/api/validation/duplicates', { token: barangayStaff.token });
  const untouched = stillOpen.payload.flags.find((f) => f.id === lowFlag.id);
  assert.ok(untouched && untouched.status === 'Flagged', 'the flag survives the refused dismissal');

  // The central office clears it.
  const dismiss = await api(`/api/validation/flags/${lowFlag.id}`, {
    method: 'POST',
    token: cswdStaff.token,
    body: { action: 'dismiss', notes: 'Different birth dates — not the same person.' }
  });
  assert.equal(dismiss.status, 200, JSON.stringify(dismiss.payload));
  assert.equal(dismiss.payload.flag.status, 'Cleared');
  assert.equal(dismiss.payload.flag.decision, 'dismiss');
  assert.equal(dismiss.payload.flag.reviewer.role, 'cswd_staff', 'reviewer hydrated for display');

  if (secondCFlag) {
    const requestInfo = await api(`/api/validation/flags/${secondCFlag.id}`, {
      method: 'POST',
      token: barangayStaff.token,
      body: { action: 'request_info', notes: 'Please confirm the birth certificate on file.' }
    });
    assert.equal(requestInfo.status, 200, JSON.stringify(requestInfo.payload));
    assert.equal(requestInfo.payload.flag.status, 'Flagged', 'the flag stays open while info is pending');
    assert.equal(requestInfo.payload.flag.decision, 'request_info');

    const applicantNotes = await notificationsFor(applicantC.token);
    assert.ok(
      applicantNotes.some((n) => n.title === 'Additional information needed'),
      'the applicant is asked for more information'
    );
  }

  // A dismissed low flag no longer counts as open on its own pair.
  const detail = await api(`/api/validation/${appA.id}`, { token: barangayStaff.token });
  const dismissed = detail.payload.flags.find((f) => f.id === lowFlag.id);
  assert.equal(dismissed.status, 'Cleared', 'cleared flags stay visible in the record’s history');
});

test('flag decisions validate input and reject unknown ids', async () => {
  const badAction = await api(`/api/validation/flags/${lowFlag.id}`, {
    method: 'POST',
    token: cswdStaff.token,
    body: { action: 'obliterate', notes: 'no such action exists' }
  });
  assert.equal(badAction.status, 400);

  const shortNotes = await api(`/api/validation/flags/${lowFlag.id}`, {
    method: 'POST',
    token: cswdStaff.token,
    body: { action: 'dismiss', notes: 'no' }
  });
  assert.equal(shortNotes.status, 400);

  const missing = await api('/api/validation/flags/00000000-0000-4000-8000-000000000000', {
    method: 'POST',
    token: cswdStaff.token,
    body: { action: 'dismiss', notes: 'flag does not exist' }
  });
  assert.equal(missing.status, 404);
});

test('a staff re-scan is safe to run and never scans drafts', async () => {
  const res = await api(`/api/validation/${appC.id}/rescan`, { method: 'POST', token: cswdStaff.token });
  assert.equal(res.status, 200, JSON.stringify(res.payload));
  assert.equal(typeof res.payload.created, 'number');
  assert.ok(res.payload.compared >= 0);
  // All pairs were already compared — the scan files nothing new.
  assert.equal(res.payload.created, 0, 'reviewed pairs are never re-flagged automatically');

  const draft = await api(`/api/validation/${appF.id}/rescan`, { method: 'POST', token: cswdStaff.token });
  assert.equal(draft.status, 404, 'drafts are outside the staff review scope');

  const beneficiary = await api(`/api/validation/${appA.id}/rescan`, {
    method: 'POST',
    token: applicantA.token
  });
  assert.equal(beneficiary.status, 403, 'applicants cannot trigger scans');
});

/* ------------------------------------------------------------------ */
/* 5. CSWD final decisions                                             */
/* ------------------------------------------------------------------ */

test('CSWD approves an application with recorded remarks', async () => {
  appD = await submitApplication(applicantD, {
    first_name: 'Domingo',
    middle_name: '',
    last_name: 'Neutralcrow',
    sex: 'Male',
    date_of_birth: '1988-11-03',
    mobile_number: '09170000004',
    purok: 'Purok 2'
  });
  // Barangay Staff verifies and endorses to CSWD:
  const open = await transition(barangayStaff, appD.id, {
    to_status: 'Under Verification',
    remarks: 'Household visited; documents complete.'
  });
  assert.equal(open.status, 200, JSON.stringify(open.payload));

  const approve = await transition(cswdStaff, appD.id, {
    to_status: 'Approved',
    remarks: 'Eligible for the assistance roster.'
  });
  assert.equal(approve.status, 200, JSON.stringify(approve.payload));
  assert.equal(approve.payload.application.application_status, 'Approved');
  assert.equal(approve.payload.application.validation_status, 'Verified');

  const detail = await api(`/api/validation/${appD.id}`, { token: cswdStaff.token });
  const cswdReview = detail.payload.reviews.find((r) => r.outcome === 'Approved');
  assert.ok(cswdReview, 'the final decision is recorded with remarks');
  assert.equal(cswdReview.stage, 'cswd_review');
  assert.match(cswdReview.remarks, /Eligible/);

  const applicantNotes = await notificationsFor(applicantD.token);
  assert.ok(applicantNotes.some((n) => n.title === 'Application approved'));

  const queue = await api('/api/validation/queue?status=Approved', { token: cswdStaff.token });
  assert.ok(queue.payload.rows.some((r) => r.id === appD.id));
});

test('CSWD rejects with a required reason; the outcome is recorded', async () => {
  appE = await submitApplication(applicantE, {
    first_name: 'Anita',
    middle_name: '',
    last_name: 'Refusalvega',
    sex: 'Female',
    date_of_birth: '1992-07-08',
    mobile_number: '09170000005',
    purok: 'Purok 5'
  });
  await transition(barangayStaff, appE.id, { to_status: 'Under Verification' });

  const noReason = await transition(cswdStaff, appE.id, { to_status: 'Rejected' });
  assert.equal(noReason.status, 400, 'rejection requires a written reason');

  const res = await transition(cswdStaff, appE.id, {
    to_status: 'Rejected',
    reason: 'The household income declared does not meet the assistance criteria.'
  });
  assert.equal(res.status, 200, JSON.stringify(res.payload));
  assert.equal(res.payload.application.application_status, 'Rejected');
  assert.equal(res.payload.application.validation_status, 'Rejected');

  const detail = await api(`/api/validation/${appE.id}`, { token: barangayStaff.token });
  assert.ok(
    detail.payload.history.some((h) => h.to_status === 'Rejected'),
    'meaningful status changes are all recorded'
  );

  const applicantNotes = await notificationsFor(applicantE.token);
  const rejected = applicantNotes.find((n) => n.title === 'Application not approved');
  assert.ok(rejected, 'the applicant is told the outcome');
  assert.match(rejected.body, /household income/);
});

test('transition validation still applies (illegal moves, bad statuses)', async () => {
  const badStatus = await transition(cswdStaff, appD.id, { to_status: 'Almost Approved' });
  assert.equal(badStatus.status, 400);

  const illegal = await transition(cswdStaff, appD.id, {
    to_status: 'Pending',
    reason: 'Trying to rewind a terminal status.'
  });
  assert.equal(illegal.status, 409, 'Approved is terminal');

  const unknownRecord = await transition(cswdStaff, '00000000-0000-4000-8000-000000000000', {
    to_status: 'Under Verification'
  });
  assert.equal(unknownRecord.status, 404);
});

/* ------------------------------------------------------------------ */
/* 6. Supporting document review                                       */
/* ------------------------------------------------------------------ */

test('staff accept documents and must give a reason to reject one', async () => {
  const detail = await api(`/api/validation/${appA.id}`, { token: barangayStaff.token });
  docA = detail.payload.documents.find((d) => d.purpose === 'Barangay certificate');
  assert.ok(docA, 'the submitted certificate is visible for review');

  const badStatus = await api(`/api/documents/${docA.id}/status`, {
    method: 'PATCH',
    token: barangayStaff.token,
    body: { status: 'Maybe' }
  });
  assert.equal(badStatus.status, 400);

  const noReason = await api(`/api/documents/${docA.id}/status`, {
    method: 'PATCH',
    token: barangayStaff.token,
    body: { status: 'Rejected' }
  });
  assert.equal(noReason.status, 400, 'rejection needs a reason');

  const accept = await api(`/api/documents/${docA.id}/status`, {
    method: 'PATCH',
    token: barangayStaff.token,
    body: { status: 'Accepted' }
  });
  assert.equal(accept.status, 200, JSON.stringify(accept.payload));
  assert.equal(accept.payload.document.status, 'Accepted');

  const applicantNotes = await notificationsFor(applicantA.token);
  assert.ok(applicantNotes.some((n) => n.title === 'Document accepted'), 'the uploader is notified');
});

/* ------------------------------------------------------------------ */
/* 7. Barangay report preparation and CSWD oversight                    */
/* ------------------------------------------------------------------ */

test('barangay staff prepare a report from live counts; CSWD oversees it', async () => {
  const created = await api('/api/reports', {
    method: 'POST',
    token: barangayStaff.token,
    body: {
      report_type: 'Validation summary',
      date_from: '2026-01-01',
      date_to: '2026-12-31',
      notes: 'Year-end validation snapshot for the barangay filing.'
    }
  });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  const report = created.payload.report;
  assert.equal(report.report_type, 'Validation summary');
  assert.equal(report.format, 'Screen');
  assert.ok(Number.isInteger(report.row_count) && report.row_count >= 0);
  assert.equal(report.parameters.scope.barangay, 'Tambacan');
  assert.equal(report.parameters.submitted_to, 'CSWD Office, Iligan City');
  assert.ok(report.parameters.snapshot, 'counts are snapshotted with the report');

  const list = await api('/api/reports', { token: cswdStaff.token });
  assert.equal(list.status, 200);
  const found = list.payload.reports.find((r) => r.id === report.id);
  assert.ok(found, 'the prepared report is visible to CSWD for oversight');
  assert.equal(found.prepared_by?.role, 'barangay_staff', 'the preparer is recorded');
  assert.ok(found.parameters.snapshot.submitted_total >= 1, 'live data made it into the snapshot');

  const badType = await api('/api/reports', {
    method: 'POST',
    token: barangayStaff.token,
    body: { report_type: 'Horoscopes' }
  });
  assert.equal(badType.status, 400);

  const inverted = await api('/api/reports', {
    method: 'POST',
    token: barangayStaff.token,
    body: { report_type: 'Beneficiary registry', date_from: '2026-12-31', date_to: '2026-01-01' }
  });
  assert.equal(inverted.status, 400, 'an inverted report period is rejected');
});

test('the staff dashboard summary reports live queue, flag, and monitoring figures', async () => {
  const res = await api('/api/dashboard/staff-summary', { token: barangayStaff.token });
  assert.equal(res.status, 200, JSON.stringify(res.payload));
  assert.ok(res.payload.queue.pending >= 1, 'pending queue counted');
  assert.ok(res.payload.queue.approved >= 1, 'approvals counted');
  assert.ok(res.payload.openDuplicateFlags >= 1, 'open duplicate flags counted');
  assert.ok(res.payload.recentSubmissions.length >= 1);
  assert.ok(res.payload.purokBreakdown.length >= 1, 'purok breakdown present');
  assert.equal(res.payload.scope.barangay, 'Tambacan');
  assert.ok(res.payload.reports.prepared >= 1, 'prepared reports counted');
  assert.ok(Object.hasOwn(res.payload.distribution, 'released'), 'distribution monitoring present');

  const beneficiaryView = await api('/api/dashboard/staff-summary', { token: applicantA.token });
  assert.equal(beneficiaryView.status, 403, 'beneficiaries never get staff operations data');
});

/* ------------------------------------------------------------------ */
/* 8. Duplicate-scoring library guarantees                             */
/* ------------------------------------------------------------------ */

test('duplicate scoring treats a name match alone as the weakest evidence', () => {
  const base = {
    first_name: 'Juan', middle_name: '', last_name: 'Dela Cruz',
    date_of_birth: '1980-01-01', mobile_number: '09171112222',
    purok: 'Purok 1', household_size: 5
  };
  const identical = scorePair(base, { ...base });
  assert.equal(identical.confidence, 'high');
  assert.ok(identical.evidence.length > 0, 'evidence is always explained');

  const nameOnly = scorePair(base, {
    ...base, date_of_birth: '1999-12-12', mobile_number: '09189998888',
    purok: 'Purok 7', household_size: 2
  });
  assert.equal(nameOnly.flagged, true, 'a name match still gets a human look');
  assert.equal(nameOnly.confidence, 'low', 'but only at low confidence');
  assert.equal(nameOnly.matches.dob, false, 'differing facts are shown');
  assert.equal(nameOnly.matches.mobile, false);

  const different = scorePair(base, {
    ...base, first_name: 'Maria', last_name: 'Santos',
    date_of_birth: '1990-05-12', mobile_number: '09170000099'
  });
  assert.equal(different.flagged, false, 'genuinely different people are not flagged');

  assert.equal(nameSimilarity('Maria Clara Santos', 'Santos Maria Clara'), 1, 'order-insensitive names');
  assert.equal(normalizeMobile('+639171234567'), '09171234567', 'mobile formats normalize');
});
