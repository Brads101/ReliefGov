import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Batch 3 tests: Beneficiary Profiling Module.
 * Exercises registration → profile creation → document upload → submission →
 * status retrieval → workflow transitions → notifications, plus the security
 * properties of the module (ownership, Tambacan-only, read-only workflow
 * fields, no self-approval, cross-account privacy). Runs against the live
 * Express app with the Supabase project configured in server/.env so that
 * RLS and the DB guard triggers are exercised for real. All accounts and
 * records created here are removed afterwards.
 */

process.env.NODE_ENV = 'test';

const { default: app } = await import('../src/app.js');
const { default: env } = await import('../src/config/env.js');
const { supabaseAdmin } = await import('../src/lib/supabase.js');

const TEST_PASSWORD = 'Test!Pass123';
const createdUserIds = [];
const createdEmails = [];

let server;
let baseUrl;

// 1×1 PNG — accepted by the magic-byte sniffing in documentService.
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const validApplication = {
  first_name: 'Maria',
  middle_name: 'L',
  last_name: 'Clara',
  sex: 'Female',
  date_of_birth: '1990-05-12',
  civil_status: 'Married',
  mobile_number: '09171234567',
  purok: 'Purok 3',
  household_size: 5,
  income_level: 'Low',
  monthly_family_income: 8000,
  house_status: 'Owned',
  incident_type: 'Flood',
  incident_date: '2026-09-20',
  incident_description: 'The river overflowed and flood water reached waist level inside our home.',
  damage_extent: 'Major'
};

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
    body: { email, password: TEST_PASSWORD, full_name: `Batch3 ${prefix}` }
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
    user_metadata: { full_name: `Batch3 ${prefix}` }
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

async function uploadCertificate(token, beneficiaryId, purpose = 'Barangay certificate') {
  const res = await api('/api/documents', {
    method: 'POST',
    token,
    body: {
      file: { name: 'certificate.png', data: PNG_DATA_URL },
      beneficiary_id: beneficiaryId,
      purpose
    }
  });
  assert.equal(res.status, 201, `certificate upload failed: ${JSON.stringify(res.payload)}`);
  return res.payload.document;
}

let beneficiaryA;
let beneficiaryB;
let beneficiaryC;
let staff;
let barangayStaff;

before(async () => {
  if (!env.supabaseConfigured || !supabaseAdmin) {
    throw new Error('Batch 3 tests require Supabase configuration in server/.env');
  }
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  beneficiaryA = await registerBeneficiary('b3-a');
  beneficiaryB = await registerBeneficiary('b3-b');
  beneficiaryC = await registerBeneficiary('b3-c');
  // Batch 4 separation of duties: final decisions (Approved / Rejected) are
  // CSWD-only, while intake verification is Barangay Staff.
  staff = await createStaff('b3-staff', 'cswd_staff');
  barangayStaff = await createStaff('b3-brgy', 'barangay_staff');
});

after(async () => {
  try {
    // Storage objects first, then rows (documents reference the bucket).
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
    // Beneficiary rows survive auth-user deletion (user_id SET NULL);
    // deleting them cascades to application_status_history and documents.
    await supabaseAdmin.from('beneficiaries').delete().in('user_id', createdUserIds);
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
  if (server) await new Promise((resolve) => server.close(resolve));
});

/* ------------------------------------------------------------------ */
/* 1. Account + profile creation                                       */
/* ------------------------------------------------------------------ */

test('a beneficiary can register, log in, and start an application', async () => {
  const created = await api('/api/applications/mine', {
    method: 'POST',
    token: beneficiaryA.token,
    body: validApplication
  });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  const appRow = created.payload.application;
  assert.equal(appRow.application_status, 'Draft', 'a new application starts as a Draft');
  assert.equal(appRow.barangay, 'Tambacan', 'barangay is forced to Tambacan');
  assert.equal(appRow.city_municipality, 'Iligan City');
  assert.equal(appRow.data_origin, 'self-service');
  assert.ok(appRow.beneficiary_number, 'a reference number is assigned');

  const mine = await getMine(beneficiaryA.token);
  assert.equal(mine.status, 200);
  assert.equal(mine.payload.application.id, appRow.id);
  assert.equal(mine.payload.history.length, 0, 'no transitions before submission');
});

test('a beneficiary-supplied barangay is rejected, not silently trusted', async () => {
  const created = await api('/api/applications/mine', {
    method: 'POST',
    token: beneficiaryB.token,
    body: { ...validApplication, barangay: 'Poblacion', city_municipality: 'CDO City' }
  });
  assert.equal(created.status, 400, 'privileged fields must be refused loudly');
  assert.ok(created.payload.error.details.barangay, 'the barangay field is called out');

  const mine = await getMine(beneficiaryB.token);
  assert.equal(mine.payload.application, null, 'nothing may be stored from the rejected request');
});

test('only one open application per account (duplicate prevention)', async () => {
  // beneficiaryB's first attempt was rejected; create a real one now.
  const first = await api('/api/applications/mine', {
    method: 'POST',
    token: beneficiaryB.token,
    body: validApplication
  });
  assert.equal(first.status, 201, JSON.stringify(first.payload));

  const second = await api('/api/applications/mine', {
    method: 'POST',
    token: beneficiaryB.token,
    body: validApplication
  });
  assert.equal(second.status, 409, 'a second open application must be refused');
  assert.match(second.payload.error.message, /active/i);
});

test('invalid profile values are rejected with per-field messages and nothing is stored', async () => {
  const res = await api('/api/applications/mine', {
    method: 'PATCH',
    token: beneficiaryA.token,
    body: {
      household_size: 999,
      income_level: 'Wealthy',
      incident_date: '2099-01-01',
      first_name: 'Mar1a!'
    }
  });
  assert.equal(res.status, 400, JSON.stringify(res.payload));
  const details = res.payload.error.details;
  assert.ok(details.household_size, 'family size error reported');
  assert.ok(details.income_level, 'income level error reported');
  assert.ok(details.incident_date, 'future incident date rejected');
  assert.ok(details.first_name, 'invalid name rejected');

  const mine = await getMine(beneficiaryA.token);
  assert.equal(mine.payload.application.household_size, 5, 'stored value untouched');
  assert.equal(mine.payload.application.income_level, 'Low');
  assert.equal(mine.payload.application.incident_date, '2026-09-20');
});

test('workflow and validation fields cannot be written by the applicant through the API', async () => {
  const res = await api('/api/applications/mine', {
    method: 'PATCH',
    token: beneficiaryA.token,
    body: { application_status: 'Approved', validation_status: 'Verified', barangay: 'Poblacion' }
  });
  assert.equal(res.status, 400);
  assert.ok(res.payload.error.details.application_status);

  const mine = await getMine(beneficiaryA.token);
  assert.equal(mine.payload.application.application_status, 'Draft');
  assert.equal(mine.payload.application.validation_status, 'Pending');
  assert.equal(mine.payload.application.barangay, 'Tambacan');
});

/* ------------------------------------------------------------------ */
/* 2. Documents + submission                                           */
/* ------------------------------------------------------------------ */

test('submission is refused without a Barangay certificate', async () => {
  const res = await submit(beneficiaryA.token);
  assert.equal(res.status, 400, 'certificate is required before submission');
  assert.ok(res.payload.error.details.documents);

  const mine = await getMine(beneficiaryA.token);
  assert.equal(mine.payload.application.application_status, 'Draft', 'still a draft');
  assert.equal(mine.payload.hasBarangayCertificate, false);
});

test('document upload links to the right application and is visible to the owner', async () => {
  const mine0 = await getMine(beneficiaryA.token);
  const doc = await uploadCertificate(beneficiaryA.token, mine0.payload.application.id);
  assert.equal(doc.purpose, 'Barangay certificate');
  assert.equal(doc.beneficiary_id, mine0.payload.application.id);

  const mine = await getMine(beneficiaryA.token);
  assert.equal(mine.payload.documents.length, 1);
  assert.equal(mine.payload.hasBarangayCertificate, true);
  assert.equal(mine.payload.documents[0].status, 'Pending', 'documents start pending review');
});

test('an unknown document purpose is a clean 400 and stores nothing', async () => {
  const mine0 = await getMine(beneficiaryA.token);
  const res = await api('/api/documents', {
    method: 'POST',
    token: beneficiaryA.token,
    body: {
      file: { name: 'strange.png', data: PNG_DATA_URL },
      beneficiary_id: mine0.payload.application.id,
      purpose: 'Proof of residency abroad'
    }
  });
  assert.equal(res.status, 400, JSON.stringify(res.payload));
  assert.equal(res.payload.error.status, 400, 'an out-of-list purpose is client-fixable, never a 500');
  assert.match(res.payload.error.message, /purpose/i);
  assert.ok(res.payload.error.details.purpose, 'the allowed purposes are listed back to the caller');

  const mine = await getMine(beneficiaryA.token);
  assert.equal(mine.payload.documents.length, 1, 'a rejected purpose stores no document');
});

test('submission moves Draft → Pending, records history, and notifies the applicant', async () => {
  const res = await submit(beneficiaryA.token);
  assert.equal(res.status, 200, JSON.stringify(res.payload));
  assert.equal(res.payload.alreadySubmitted, false);
  const appRow = res.payload.application;
  assert.equal(appRow.application_status, 'Pending', 'submission never auto-approves');
  assert.ok(appRow.submitted_at, 'submitted_at is stamped');
  assert.equal(appRow.approved_at, undefined, 'no approval happens on submit');

  const mine = await getMine(beneficiaryA.token);
  assert.equal(mine.payload.history.length, 1);
  const entry = mine.payload.history[0];
  assert.equal(entry.from_status, 'Draft');
  assert.equal(entry.to_status, 'Pending');
  assert.equal(entry.actor_role, 'beneficiary');

  const notes = await api('/api/notifications', { token: beneficiaryA.token });
  assert.equal(notes.status, 200);
  assert.ok(notes.payload.unread >= 1, 'the applicant is notified');
  assert.match(JSON.stringify(notes.payload.notifications), /pending verification/i);
});

test('re-submitting is idempotent (double click / network retry)', async () => {
  const res = await submit(beneficiaryA.token);
  assert.equal(res.status, 200, 'retries answer 200 without failing');
  assert.equal(res.payload.alreadySubmitted, true);
  assert.equal(res.payload.application.application_status, 'Pending');

  const mine = await getMine(beneficiaryA.token);
  assert.equal(mine.payload.history.length, 1, 'no duplicate history entry');
});

test('an application under verification cannot be edited by the applicant', async () => {
  const res = await api('/api/applications/mine', {
    method: 'PATCH',
    token: beneficiaryA.token,
    body: { incident_description: 'Trying to edit while pending verification.' }
  });
  assert.equal(res.status, 409);
  assert.match(res.payload.error.message, /no longer be edited/i);
});

test('the applicant cannot approve or self-verify their own record (PostgREST probe)', async () => {
  const mine = await getMine(beneficiaryA.token);
  const id = mine.payload.application.id;

  await postgrest(`beneficiaries?id=eq.${id}`, {
    method: 'PATCH',
    token: beneficiaryA.accessToken,
    body: {
      application_status: 'Approved',
      validation_status: 'Verified',
      vulnerability_class: 'Low',
      vulnerability_score: 0
    }
  });

  const { data } = await supabaseAdmin
    .from('beneficiaries')
    .select('application_status, validation_status, vulnerability_class')
    .eq('id', id)
    .single();
  assert.equal(data.application_status, 'Pending', 'status changes only through the workflow');
  assert.notEqual(data.validation_status, 'Verified', 'applicants cannot self-verify');
  assert.equal(data.vulnerability_class, null, 'applicants cannot self-assign a class');
});

test('another beneficiary cannot read or edit this application', async () => {
  const mineA = await getMine(beneficiaryA.token);
  const id = mineA.payload.application.id;

  // Cross-account row update through PostgREST must change nothing.
  await postgrest(`beneficiaries?id=eq.${id}`, {
    method: 'PATCH',
    token: beneficiaryB.accessToken,
    body: { first_name: 'Hacked' }
  });
  const { data } = await supabaseAdmin
    .from('beneficiaries')
    .select('first_name')
    .eq('id', id)
    .single();
  assert.equal(data.first_name, 'Maria', 'row unchanged after cross-account attempt');

  // Another account's status history is not readable either.
  const probe = await postgrest(
    `application_status_history?beneficiary_id=eq.${id}`,
    { token: beneficiaryB.accessToken }
  );
  assert.equal(probe.payload.length, 0, 'history of another applicant stays private');

  // Staff-only endpoint is forbidden for beneficiaries.
  const transition = await api(`/api/applications/${id}/transition`, {
    method: 'POST',
    token: beneficiaryB.token,
    body: { to_status: 'Approved' }
  });
  assert.equal(transition.status, 403, 'applicants cannot transition statuses');
});

/* ------------------------------------------------------------------ */
/* 3. Staff verification workflow                                      */
/* ------------------------------------------------------------------ */

test('staff cannot skip verification straight to Approved', async () => {
  const mine = await getMine(beneficiaryA.token);
  const id = mine.payload.application.id;

  const direct = await api(`/api/applications/${id}/transition`, {
    method: 'POST',
    token: staff.token,
    body: { to_status: 'Approved' }
  });
  assert.equal(direct.status, 409, 'Pending → Approved is not an allowed transition');
  assert.ok(direct.payload.error.details.allowed.includes('Under Verification'));

  const started = await api(`/api/applications/${id}/transition`, {
    method: 'POST',
    token: barangayStaff.token,
    body: { to_status: 'Under Verification' }
  });
  assert.equal(started.status, 200, JSON.stringify(started.payload));
  assert.equal(started.payload.application.application_status, 'Under Verification');
});

test('Needs Correction requires a reason and notifies the applicant', async () => {
  const mine = await getMine(beneficiaryA.token);
  const id = mine.payload.application.id;

  const noReason = await api(`/api/applications/${id}/transition`, {
    method: 'POST',
    token: staff.token,
    body: { to_status: 'Needs Correction' }
  });
  assert.equal(noReason.status, 400, 'reason is mandatory for Needs Correction');
  assert.ok(noReason.payload.error.details.reason);

  const withReason = await api(`/api/applications/${id}/transition`, {
    method: 'POST',
    token: staff.token,
    body: { to_status: 'Needs Correction', reason: 'Please upload a clearer photo of the damage.' }
  });
  assert.equal(withReason.status, 200, JSON.stringify(withReason.payload));
  assert.equal(withReason.payload.application.status_reason, 'Please upload a clearer photo of the damage.');

  const mine2 = await getMine(beneficiaryA.token);
  assert.equal(mine2.payload.application.application_status, 'Needs Correction');
  assert.equal(mine2.payload.history.length, 3, 'Draft→Pending, Pending→Under Verification, →Needs Correction');

  const notes = await api('/api/notifications', { token: beneficiaryA.token });
  const correction = notes.payload.notifications.find((n) => n.title === 'Changes needed on your application');
  assert.ok(correction, 'correction request reaches the applicant');
  assert.equal(correction.level, 'warning');
  assert.match(correction.body, /clearer photo/);
});

test('after a correction request the applicant can edit and resubmit', async () => {
  const patch = await api('/api/applications/mine', {
    method: 'PATCH',
    token: beneficiaryA.token,
    body: { incident_description: 'Flood water damaged our furniture and stored rice supplies.' }
  });
  assert.equal(patch.status, 200, 'editing is allowed again after Needs Correction');
  assert.equal(patch.payload.application.incident_description.startsWith('Flood water damaged'), true);

  const res = await submit(beneficiaryA.token);
  assert.equal(res.status, 200);
  assert.equal(res.payload.application.application_status, 'Pending');
  assert.equal(res.payload.alreadySubmitted, false);

  const mine = await getMine(beneficiaryA.token);
  assert.equal(mine.payload.history.length, 4, 'resubmission is appended to the timeline');
});

test('an approved application shows the applicant their vulnerability result', async () => {
  const mine0 = await getMine(beneficiaryA.token);
  const id = mine0.payload.application.id;
  assert.equal(mine0.payload.application.vulnerability_class, null, 'not assessed yet');

  await api(`/api/applications/${id}/transition`, {
    method: 'POST',
    token: barangayStaff.token,
    body: { to_status: 'Under Verification' }
  });
  const approved = await api(`/api/applications/${id}/transition`, {
    method: 'POST',
    token: staff.token,
    body: { to_status: 'Approved', reason: 'Verified by the barangay validation team.' }
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.payload));
  assert.equal(approved.payload.application.application_status, 'Approved');

  // Simulate the scoring module's output (Batch 5 will compute this).
  await supabaseAdmin
    .from('beneficiaries')
    .update({ vulnerability_score: 72.5, vulnerability_class: 'High' })
    .eq('id', id);

  const mine = await getMine(beneficiaryA.token);
  assert.equal(mine.payload.application.application_status, 'Approved');
  assert.equal(mine.payload.application.vulnerability_class, 'High', 'own assessment is visible');
  assert.equal(Number(mine.payload.application.vulnerability_score), 72.5);

  // Approved is terminal: no further transitions.
  const again = await api(`/api/applications/${id}/transition`, {
    method: 'POST',
    token: staff.token,
    body: { to_status: 'Rejected', reason: 'Any reason.' }
  });
  assert.equal(again.status, 409, 'terminal statuses cannot be reopened');

  // And the applicant can start a NEW application afterwards.
  const fresh = await api('/api/applications/mine', {
    method: 'POST',
    token: beneficiaryA.token,
    body: { ...validApplication, incident_type: 'Typhoon', incident_description: 'Typhoon winds tore off part of our roof.' }
  });
  assert.equal(fresh.status, 201, 'a new application is allowed after a terminal decision');
  assert.equal(fresh.payload.application.application_status, 'Draft');
});

test('rejection requires a reason and the applicant can read it back', async () => {
  // beneficiaryB: create → certificate → submit → verify → reject
  const mine0 = await getMine(beneficiaryB.token);
  await uploadCertificate(beneficiaryB.token, mine0.payload.application.id);
  const submitted = await submit(beneficiaryB.token);
  assert.equal(submitted.status, 200);
  const id = submitted.payload.application.id;

  await api(`/api/applications/${id}/transition`, {
    method: 'POST', token: barangayStaff.token, body: { to_status: 'Under Verification' }
  });

  const noReason = await api(`/api/applications/${id}/transition`, {
    method: 'POST', token: staff.token, body: { to_status: 'Rejected' }
  });
  assert.equal(noReason.status, 400, 'rejection must state a reason');

  const rejected = await api(`/api/applications/${id}/transition`, {
    method: 'POST',
    token: staff.token,
    body: { to_status: 'Rejected', reason: 'The damage reported was not confirmed during the site validation.' }
  });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.payload));

  const mine = await getMine(beneficiaryB.token);
  assert.equal(mine.payload.application.application_status, 'Rejected');
  assert.match(mine.payload.application.status_reason, /not confirmed/);

  const notes = await api('/api/notifications', { token: beneficiaryB.token });
  const rejectionNote = notes.payload.notifications.find((n) => n.level === 'error');
  assert.ok(rejectionNote, 'rejection notice delivered');
  assert.match(rejectionNote.body, /not confirmed/);
});

/* ------------------------------------------------------------------ */
/* 4. Notifications privacy + timeline integrity                       */
/* ------------------------------------------------------------------ */

test('notifications are strictly per account', async () => {
  const notesA = await api('/api/notifications', { token: beneficiaryA.token });
  const notesB = await api('/api/notifications', { token: beneficiaryB.token });
  assert.equal(notesA.status, 200);
  assert.equal(notesB.status, 200);
  assert.ok(notesA.payload.notifications.length >= 3, 'A received status notifications');
  assert.ok(notesB.payload.notifications.length >= 2, 'B received status notifications');

  const idsA = new Set(notesA.payload.notifications.map((n) => n.id));
  const overlap = notesB.payload.notifications.filter((n) => idsA.has(n.id));
  assert.equal(overlap.length, 0, 'no cross-account notification leakage');

  // B cannot mark A's notification as read.
  const firstOfA = notesA.payload.notifications[0];
  const denied = await api(`/api/notifications/${firstOfA.id}/read`, { method: 'POST', token: beneficiaryB.token });
  assert.equal(denied.status, 404, 'foreign notification ids answer 404');

  // A can read their own, and the unread counter drops accordingly.
  const before = notesA.payload.unread;
  const read = await api(`/api/notifications/${firstOfA.id}/read`, { method: 'POST', token: beneficiaryA.token });
  assert.equal(read.status, 200);
  const after = await api('/api/notifications', { token: beneficiaryA.token });
  assert.ok(after.payload.unread < before, 'own notification can be marked read');
});

test('an unauthenticated caller cannot reach the module endpoints', async () => {
  for (const path of ['/api/applications/mine', '/api/notifications']) {
    const res = await api(path);
    assert.equal(res.status, 401, `${path} requires authentication`);
  }
  const transition = await api('/api/applications/00000000-0000-4000-8000-000000000099/transition', {
    method: 'POST',
    body: { to_status: 'Approved' }
  });
  assert.equal(transition.status, 401);
});

test('staff can read the Tambacan registry including the new records', async () => {
  const res = await api('/api/beneficiaries?limit=50', { token: staff.token });
  assert.equal(res.status, 200);
  assert.ok(res.payload.total >= 2, 'submitted records appear for staff');
  for (const row of res.payload.rows || res.payload.items || res.payload.beneficiaries || []) {
    assert.equal(row.barangay, 'Tambacan');
  }
});

test('a third application can sit in Pending under the workflow rules (user C)', async () => {
  const created = await api('/api/applications/mine', {
    method: 'POST',
    token: beneficiaryC.token,
    body: { ...validApplication, first_name: 'Carlo', last_name: 'Dela Cruz' }
  });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  const mine0 = await getMine(beneficiaryC.token);
  assert.equal(mine0.payload.application.id, created.payload.application.id);

  await uploadCertificate(beneficiaryC.token, mine0.payload.application.id);
  const submitted = await submit(beneficiaryC.token);
  assert.equal(submitted.status, 200);
  assert.equal(submitted.payload.application.application_status, 'Pending');

  const mine = await getMine(beneficiaryC.token);
  assert.equal(mine.payload.history.length, 1);
  assert.equal(mine.payload.application.vulnerability_class, null);
});
