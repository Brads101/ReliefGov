import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Batch 5 tests: Random Forest Vulnerability Scoring.
 *
 * Covers, per the capstone requirements:
 *  - ML contract: the documented priority-index conversion and the feature
 *    validation that rejects incomplete records with per-indicator details.
 *  - Scoring flow: only validated records can be scored, scores persist with
 *    model version / date / indicators / probabilities, history is kept when
 *    rescoring, staleness is detected when assessment data changes.
 *  - Duplicate profiles score independently (no cross-contamination).
 *  - Flagging and manual correction are CSWD-only with mandatory notes;
 *    beneficiaries are locked out of every scoring endpoint.
 *  - Filters and sorting by priority class / score / state.
 *
 * There is exactly ONE model: the Python microservice (ml-service/app.py)
 * serving the Colab-trained artifact. This suite starts its own instance of
 * that service on a dedicated port, so it neither depends on nor disturbs the
 * development instance on :8100. The service's own contract is covered
 * end-to-end by tests/python-ml.test.js.
 *
 * Runs against the live Express app with the Supabase project in
 * server/.env so RLS, guard triggers and constraints are exercised for real.
 * All accounts, records, scores and audit rows created here are removed
 * afterwards.
 */

process.env.NODE_ENV = 'test';
// The only backend is the Python microservice — point this suite at the
// instance it starts itself (see startService below).
process.env.ML_BACKEND = 'python';
const ML_PORT = Number(process.env.SCORING_ML_TEST_PORT || 8178);
process.env.ML_SERVICE_URL = `http://127.0.0.1:${ML_PORT}`;
process.env.ML_SERVICE_TIMEOUT_MS = '20000';

const { spawn } = await import('node:child_process');
const { default: app } = await import('../src/app.js');
const { default: env } = await import('../src/config/env.js');
const { supabaseAdmin } = await import('../src/lib/supabase.js');
const { priorityIndexFromProbabilities, CLASSES, SCORABLE_STATUSES, MODEL_VERSION } = await import('../src/ml/config.js');
const { encodeRecord, missingIndicators } = await import('../src/ml/features.js');
const { resetStatusCache } = await import('../src/ml/pythonClient.js');

const ML_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ml-service');
const PY = path.join(ML_DIR, '.venv', 'Scripts', 'python.exe');
const ML_APP = path.join(ML_DIR, 'app.py');
let mlService = null;

/** Starts a private instance of the Python ML service for this suite. */
async function startMlService() {
  if (!fs.existsSync(PY)) {
    throw new Error(`Python virtual environment not found at ${PY}. Run ml-service\\setup.bat first.`);
  }
  mlService = spawn(PY, [ML_APP], {
    env: { ...process.env, ML_PORT: String(ML_PORT), ML_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${ML_PORT}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch { /* not up yet */ }
    if (mlService.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('The Python ML service did not become healthy in time.');
}

function stopMlService() {
  if (mlService && mlService.exitCode === null) {
    mlService.kill();
    mlService = null;
  }
}

const TEST_PASSWORD = 'Test!Pass123';
const createdUserIds = [];
const createdEmails = [];
const createdBeneficiaryIds = [];
const createdScoreIds = [];
let testStart = null;

let server;
let baseUrl;

// 1×1 PNG — accepted by the magic-byte sniffing in documentService.
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function appBody(overrides = {}) {
  return {
    first_name: 'Sylvia',
    middle_name: '',
    last_name: 'Marasigan',
    sex: 'Female',
    date_of_birth: '1992-07-04',
    civil_status: 'Single',
    mobile_number: '09170000009',
    purok: 'Purok 2',
    household_size: 5,
    income_level: 'Low',
    monthly_family_income: 6500,
    house_status: 'Informal settler',
    incident_type: 'Flood',
    incident_date: '2026-09-25',
    incident_description: 'Floodwater entered the house and damaged our furniture and appliances.',
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

async function registerBeneficiary(prefix) {
  const email = uniqueEmail(prefix);
  const res = await api('/api/auth/register', {
    method: 'POST',
    body: { email, password: TEST_PASSWORD, full_name: `Batch5 ${prefix}` }
  });
  assert.equal(res.status, 201, `register failed: ${JSON.stringify(res.payload)}`);
  createdUserIds.push(res.payload.id);
  createdEmails.push(email);
  const session = await login(email);
  return { id: res.payload.id, email, token: session.token, accessToken: session.accessToken };
}

async function createStaff(prefix, role = 'barangay_staff') {
  const email = uniqueEmail(prefix);
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `Batch5 ${prefix}` }
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

/** Creates + submits an application and moves it to Under Verification. */
async function createScorableApplication(user, staff, overrides = {}) {
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
  const endorsed = await api(`/api/applications/${id}/transition`, {
    method: 'POST',
    token: staff.token,
    body: { to_status: 'Under Verification' }
  });
  assert.equal(endorsed.status, 200, `endorse failed: ${JSON.stringify(endorsed.payload)}`);
  return id;
}

/* ------------------------------------------------------------------ */
/* Setup / teardown                                                    */
/* ------------------------------------------------------------------ */

let barangayStaff;
let cswdStaff;
let applicantX;   // main scorable record
let applicantY;   // duplicate-style record (same name as X)
let applicantZ;   // left Pending (not scorable)
let recordX;
let recordY;
let recordZ;

before(async () => {
  if (!env.supabaseConfigured || !supabaseAdmin) {
    throw new Error('Batch 5 tests require Supabase configuration in server/.env');
  }
  testStart = new Date().toISOString();
  await startMlService();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  barangayStaff = await createStaff('b5-brgy', 'barangay_staff');
  cswdStaff = await createStaff('b5-cswd', 'cswd_staff');
  applicantX = await registerBeneficiary('b5-x');
  applicantY = await registerBeneficiary('b5-y');
  applicantZ = await registerBeneficiary('b5-z');

  recordX = await createScorableApplication(applicantX, barangayStaff);
  recordY = await createScorableApplication(applicantY, barangayStaff, {
    first_name: 'Sylvia',
    last_name: 'Marasigan',
    mobile_number: '09170000010',
    household_size: 7,
    income_level: 'No income',
    damage_extent: 'Total'
  });
  // Z is submitted but never endorsed — must NOT be scorable.
  const zCreate = await api('/api/applications/mine', {
    method: 'POST',
    token: applicantZ.token,
    body: appBody({ first_name: 'Zoraida', last_name: 'Padillada' })
  });
  assert.equal(zCreate.status, 201, JSON.stringify(zCreate.payload));
  recordZ = zCreate.payload.application.id;
  createdBeneficiaryIds.push(recordZ);
  await uploadCertificate(applicantZ.token, recordZ);
  await api('/api/applications/mine/submit', { method: 'POST', token: applicantZ.token });
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
    if (createdBeneficiaryIds.length) {
      await supabaseAdmin.from('vulnerability_scores').delete().in('beneficiary_id', createdBeneficiaryIds);
      const { data: rows } = await supabaseAdmin
        .from('beneficiaries')
        .select('id')
        .in('id', createdBeneficiaryIds);
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
    await supabaseAdmin.from('audit_logs').delete().in('entity_id', createdScoreIds);
  } catch (err) {
    console.warn('audit cleanup failed:', err.message);
  }
  for (const id of createdUserIds) {
    try {
      await supabaseAdmin.auth.admin.deleteUser(id);
    } catch (err) {
      console.warn('cleanup failed for', id, err.message);
    }
  }
  try {
    if (testStart) {
      let query = supabaseAdmin.from('notifications').delete().gte('created_at', testStart);
      if (createdUserIds.length) {
        query = query.not('user_id', 'in', `(${createdUserIds.join(',')})`);
      }
      await query;
    }
  } catch (err) {
    console.warn('notification cleanup failed:', err.message);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  stopMlService();
});

/* ------------------------------------------------------------------ */
/* 1. ML contract: priority index and feature encoding                 */
/* ------------------------------------------------------------------ */

test('priority index conversion follows the documented formula', () => {
  assert.equal(priorityIndexFromProbabilities([1, 0, 0]), 0, 'all-Low votes → 0');
  assert.equal(priorityIndexFromProbabilities([0, 0, 1]), 100, 'all-High votes → 100');
  assert.equal(priorityIndexFromProbabilities([0, 1, 0]), 50, 'Moderate rank = 1/(K-1)');
  assert.equal(priorityIndexFromProbabilities([0.5, 0, 0.5]), 50, 'even split → 50');
  // Monotonicity: shifting mass toward more vulnerable classes never lowers the index.
  const a = priorityIndexFromProbabilities([0.25, 0.5, 0.25]);
  const b = priorityIndexFromProbabilities([0, 0.25, 0.75]);
  assert.ok(b > a, 'index must increase as votes shift toward High');
});

test('feature encoding: missing and invalid indicators are rejected with details', () => {
  const missing = missingIndicators({ household_size: null, income_level: 'Low', damage_extent: 'Minor', house_status: 'Owned' });
  assert.equal(missing.length, 1);
  assert.match(missing[0], /family size/);

  assert.throws(
    () => encodeRecord({ household_size: 4, income_level: 'Wealthy', damage_extent: 'Minor', house_status: 'Owned' }),
    (err) => err.status === 400 && /complete/.test(err.message)
  );
  assert.throws(
    () => encodeRecord({ household_size: 4, income_level: 'Low', damage_extent: 'Minor', house_status: 'Mansion' }),
    (err) => err.status === 400
  );
  // Valid record encodes to the documented 8-column vector.
  const vec = encodeRecord({ household_size: 4, income_level: 'Low', damage_extent: 'Minor', house_status: 'Owned' });
  assert.equal(vec.length, 8, 'household_size + income + damage + 4 one-hot + damage_photo');
  assert.deepEqual(vec.slice(3, 7), [0, 0, 0, 0], 'Owned = all-zero one-hot');
  assert.equal(vec[7], 0, 'no damage photo on file = evidence flag 0');
  const vec2 = encodeRecord({
    household_size: 4, income_level: 'Low', damage_extent: 'Minor',
    house_status: 'Informal settler', damage_photo: 1
  });
  assert.deepEqual(vec2.slice(3, 7), [1, 0, 0, 0]);
  assert.equal(vec2[7], 1, 'a non-rejected damage photo on file = evidence flag 1');
});

/* ------------------------------------------------------------------ */
/* 2. Model status endpoint: staff-only, honest                        */
/* ------------------------------------------------------------------ */

test('GET /api/scoring/model is staff-only and reports honest model state', async () => {
  // No token at all → 401
  const anon = await api('/api/scoring/model');
  assert.equal(anon.status, 401);

  // Beneficiary → 403
  const bene = await api('/api/scoring/model', { token: applicantX.token });
  assert.equal(bene.status, 403);

  // Barangay staff → 200 with provenance disclosure + measured evaluation
  const ok = await api('/api/scoring/model', { token: barangayStaff.token });
  assert.equal(ok.status, 200);
  assert.equal(ok.payload.available, true);
  assert.equal(ok.payload.modelVersion, MODEL_VERSION, 'the Colab model is the model of record');
  assert.equal(ok.payload.dataset.type, 'historical', 'the collected dataset is disclosed');
  assert.match(ok.payload.dataset.disclaimer, /held-out/i,
    'the disclaimer discloses the held-out split rather than claiming training-set agreement');
  assert.ok(typeof ok.payload.evaluation.accuracy === 'number');
  assert.ok(ok.payload.evaluation.nTest > 0);
  assert.match(ok.payload.evaluation.evaluatedOn, /held-out/i,
    'the headline metrics state they come from held-out rows');
  assert.match(ok.payload.evaluation.evaluatedOn, /not an external|not a real-world/i,
    'the metrics refuse to claim external or real-world validity');
  assert.ok(ok.payload.evaluation.fullDataAgreement,
    'the 1,000-row figure is kept separately');
  assert.match(ok.payload.evaluation.fullDataAgreement.evaluatedOn, /training-set agreement/i,
    'the secondary 1,000-row figure is labelled as training-set agreement');
  // 9 multi-dimensional model inputs
  assert.ok(Array.isArray(ok.payload.features.names) && ok.payload.features.names.length === 9);
  assert.ok(ok.payload.features.excluded.length > 0, 'documented exclusions are visible');
});

test('GET /api/scoring/summary aggregates the live scoring state', async () => {
  const res = await api('/api/scoring/summary', { token: barangayStaff.token });
  assert.equal(res.status, 200);
  const p = res.payload;
  assert.equal(p.total, p.scored + p.missing, 'scored + missing = total');
  assert.ok(p.missing >= 3, 'the three test records start unscored');
  assert.equal(p.flagged, 0);
  assert.equal(p.model.available, true);
  const classSum = Object.values(p.by_class).reduce((a, b) => a + b, 0);
  assert.equal(classSum, p.scored, 'class breakdown must add up to the scored count');
});

/* ------------------------------------------------------------------ */
/* 3. Role access: beneficiaries are locked out entirely               */
/* ------------------------------------------------------------------ */

test('beneficiaries cannot reach any scoring endpoint', async () => {
  const t = applicantX.token;
  const endpoints = [
    ['/api/scoring/model', 'GET'],
    ['/api/scoring/summary', 'GET'],
    ['/api/scoring/beneficiaries', 'GET'],
    [`/api/scoring/beneficiaries/${recordX}`, 'GET'],
    [`/api/scoring/beneficiaries/${recordX}/score`, 'POST'],
    ['/api/scoring/scores/any-id/flag', 'POST'],
    ['/api/scoring/scores/any-id/correct', 'POST']
  ];
  for (const [url, method] of endpoints) {
    const res = await api(url, { method, token: t, body: method === 'POST' ? {} : undefined });
    assert.equal(res.status, 403, `${method} ${url} must be 403 for a beneficiary (got ${res.status})`);
  }
});

test('barangay staff can view scores but cannot generate or regenerate them', async () => {
  // Direct API call — the hidden UI control cannot be bypassed.
  const run = await api(`/api/scoring/beneficiaries/${recordX}/score`, {
    method: 'POST', token: barangayStaff.token, body: {}
  });
  assert.equal(run.status, 403, 'barangay staff cannot invoke scoring (got ' + run.status + ')');
  assert.match(run.payload.error.message, /CSWD/);

  // Even before the record is scorable, the permission check answers first.
  const runPending = await api(`/api/scoring/beneficiaries/${recordZ}/score`, {
    method: 'POST', token: barangayStaff.token, body: {}
  });
  assert.equal(runPending.status, 403, 'permission is checked before anything else');

  // Viewing stays fully allowed for barangay staff.
  const list = await api('/api/scoring/beneficiaries', { token: barangayStaff.token });
  assert.equal(list.status, 200);
  const detail = await api(`/api/scoring/beneficiaries/${recordX}`, { token: barangayStaff.token });
  assert.equal(detail.status, 200);
  assert.equal(detail.payload.capabilities.canScore, false, 'the UI is told not to show the run control');
  assert.equal(detail.payload.capabilities.canFlag, false);

  const cswdDetail = await api(`/api/scoring/beneficiaries/${recordX}`, { token: cswdStaff.token });
  assert.equal(cswdDetail.status, 200);
  assert.equal(cswdDetail.payload.capabilities.canScore, true, 'CSWD keeps the run control');

  // The refused call created nothing.
  const { data: rows } = await supabaseAdmin
    .from('vulnerability_scores')
    .select('id')
    .eq('beneficiary_id', recordX);
  assert.equal((rows || []).length, 0, 'no score row is fabricated by a refused run');
});

/* ------------------------------------------------------------------ */
/* 4. Scoring gate: only validated records can be scored               */
/* ------------------------------------------------------------------ */

test('scoring a not-yet-validated (Pending) record is refused with 409', async () => {
  const res = await api(`/api/scoring/beneficiaries/${recordZ}/score`, {
    method: 'POST',
    token: cswdStaff.token,
    body: {}
  });
  assert.equal(res.status, 409, JSON.stringify(res.payload));
  assert.match(res.payload.error.message, /Under Verification/);
  assert.deepEqual(res.payload.error.details.scorable_statuses, SCORABLE_STATUSES);
});

test('scoring a Draft or unknown record is a 404, not a crash', async () => {
  const unknown = await api('/api/scoring/beneficiaries/00000000-0000-0000-0000-000000000000/score', {
    method: 'POST', token: cswdStaff.token, body: {}
  });
  assert.equal(unknown.status, 404);
});

test('scoring endpoints reject invalid query filters with field errors', async () => {
  const badClass = await api('/api/scoring/beneficiaries?class=Catastrophic', { token: barangayStaff.token });
  assert.equal(badClass.status, 400);
  assert.ok(badClass.payload.error.details.class);

  const badState = await api('/api/scoring/beneficiaries?state=exploded', { token: barangayStaff.token });
  assert.equal(badState.status, 400);

  const badSort = await api('/api/scoring/beneficiaries?sort=luck', { token: barangayStaff.token });
  assert.equal(badSort.status, 400);

  const badOrder = await api('/api/scoring/beneficiaries?order=sideways', { token: barangayStaff.token });
  assert.equal(badOrder.status, 400);
});

/* ------------------------------------------------------------------ */
/* 5. Run the score: persistence, history, mirror columns              */
/* ------------------------------------------------------------------ */

test('scoring a validated record persists model version, date, indicators and result', async () => {
  const res = await api(`/api/scoring/beneficiaries/${recordX}/score`, {
    method: 'POST', token: cswdStaff.token, body: {}
  });
  assert.equal(res.status, 200, JSON.stringify(res.payload));
  assert.equal(res.payload.unchanged, false);
  const score = res.payload.score;
  createdScoreIds.push(score.id);

  assert.equal(score.status, 'current');
  assert.equal(score.source, 'model');
  assert.equal(score.dataset_type, 'historical', 'dataset provenance stored with every row');
  assert.equal(score.model_version, MODEL_VERSION);
  assert.ok(score.scored_at, 'scoring date recorded');
  assert.ok(CLASSES.includes(score.class));
  assert.ok(score.score >= 0 && score.score <= 100);
  assert.equal(score.probabilities.length, 3);
  assert.ok(score.confidence > 0 && score.confidence <= 1);
  assert.equal(score.scored_by, cswdStaff.id, 'run attributed to the CSWD staff member');
  assert.deepEqual(score.indicators, {
    household_size: 5, income_level: 'Low', damage_extent: 'Major',
    house_status: 'Informal settler', damage_photo: 0
  }, 'input record reference stored as the indicator snapshot');
  assert.ok(Array.isArray(score.top_factors) && score.top_factors.length > 0, 'explanation stored');

  // Mirror columns on the beneficiary row stay in step (dashboards/reports/applicant view).
  const { data: mirror } = await supabaseAdmin
    .from('beneficiaries')
    .select('vulnerability_score, vulnerability_class')
    .eq('id', recordX)
    .single();
  assert.equal(mirror.vulnerability_class, score.class);
  assert.equal(Number(mirror.vulnerability_score), score.score);

  // The score is visible in the list as 'scored'.
  const list = await api('/api/scoring/beneficiaries', { token: barangayStaff.token });
  assert.equal(list.status, 200);
  const row = list.payload.rows.find((r) => r.id === recordX);
  assert.ok(row, 'record appears in the scoring list');
  assert.equal(row.state, 'scored');
  assert.equal(row.vulnerability_class, score.class);
  assert.equal(row.dataset_type, 'historical');
  assert.ok(row.scorable);
});

test('re-scoring unchanged inputs is idempotent (no duplicate rows)', async () => {
  const res = await api(`/api/scoring/beneficiaries/${recordX}/score`, {
    method: 'POST', token: cswdStaff.token, body: {}
  });
  assert.equal(res.status, 200);
  assert.equal(res.payload.unchanged, true, 'fresh score returned instead of a new row');

  const { data: rows } = await supabaseAdmin
    .from('vulnerability_scores')
    .select('id, status')
    .eq('beneficiary_id', recordX);
  assert.equal(rows.length, 1, 'exactly one row for one scoring of unchanged inputs');
});

test('a forced re-run reproduces the identical result (reproducibility)', async () => {
  const first = await api(`/api/scoring/beneficiaries/${recordX}`, { token: barangayStaff.token });
  const before = first.payload.current;

  const res = await api(`/api/scoring/beneficiaries/${recordX}/score`, {
    method: 'POST', token: cswdStaff.token, body: { force: true }
  });
  assert.equal(res.status, 200);
  assert.equal(res.payload.unchanged, false);
  const after = res.payload.score;
  createdScoreIds.push(after.id);

  assert.equal(after.class, before.class, 'class must be reproducible');
  assert.equal(after.score, before.score, 'priority index must be reproducible');
  assert.equal(after.confidence, before.confidence, 'confidence must be reproducible');
  assert.deepEqual(after.probabilities, before.probabilities, 'vote distribution must be reproducible');

  // History kept: the old row is superseded, not deleted.
  const { data: rows } = await supabaseAdmin
    .from('vulnerability_scores')
    .select('id, status')
    .eq('beneficiary_id', recordX)
    .order('created_at', { ascending: true });
  assert.equal(rows.length, 2, 'prior score kept for audit');
  assert.equal(rows[0].status, 'superseded');
  assert.equal(rows[1].status, 'current');

  const detail = await api(`/api/scoring/beneficiaries/${recordX}`, { token: barangayStaff.token });
  assert.equal(detail.payload.history.length, 2, 'detail exposes the full history');
  assert.equal(detail.payload.state, 'scored');
  assert.equal(detail.payload.current.stale, false);
});

/* ------------------------------------------------------------------ */
/* 6. Duplicate profiles score independently                           */
/* ------------------------------------------------------------------ */

test('duplicate profiles each get their own independent score rows', async () => {
  // recordY shares recordX's name — scores must never cross-link.
  const resY = await api(`/api/scoring/beneficiaries/${recordY}/score`, {
    method: 'POST', token: cswdStaff.token, body: {}
  });
  assert.equal(resY.status, 200, JSON.stringify(resY.payload));
  assert.equal(resY.payload.unchanged, false);
  createdScoreIds.push(resY.payload.score.id);

  const { data: yRows } = await supabaseAdmin
    .from('vulnerability_scores')
    .select('id, beneficiary_id, indicator_snapshot')
    .eq('beneficiary_id', recordY);
  assert.equal(yRows.length, 1);
  assert.equal(yRows[0].beneficiary_id, recordY, 'score keyed to its own record');

  // Different inputs → different snapshots stored per record.
  assert.equal(yRows[0].indicator_snapshot.household_size, 7);
  const xRows = await supabaseAdmin
    .from('vulnerability_scores')
    .select('indicator_snapshot')
    .eq('beneficiary_id', recordX)
    .eq('status', 'current')
    .single();
  assert.equal(xRows.data.indicator_snapshot.household_size, 5, 'X score untouched by scoring Y');

  // The duplicate-shaped record gets its own (worse) result.
  assert.ok(resY.payload.score.score >= 0);
  assert.ok(CLASSES.includes(resY.payload.score.class));
});

/* ------------------------------------------------------------------ */
/* 7. Staleness: updated assessments require reassessment              */
/* ------------------------------------------------------------------ */

test('changing assessment data marks the score stale; re-running clears it', async () => {
  // Simulate an authorized change to validated assessment information.
  const { error: updErr } = await supabaseAdmin
    .from('beneficiaries')
    .update({ income_level: 'No income', household_size: 8 })
    .eq('id', recordX);
  assert.equal(updErr, null, updErr?.message);

  const detail = await api(`/api/scoring/beneficiaries/${recordX}`, { token: barangayStaff.token });
  assert.equal(detail.payload.current.stale, true, 'stale when indicators changed after scoring');
  assert.equal(detail.payload.state, 'stale');

  const list = await api('/api/scoring/beneficiaries?state=stale', { token: barangayStaff.token });
  assert.equal(list.status, 200);
  const inList = list.payload.rows.find((r) => r.id === recordX);
  assert.ok(inList && inList.state === 'stale', 'stale records are filterable');

  // Re-run: allowed without force because inputs changed.
  const res = await api(`/api/scoring/beneficiaries/${recordX}/score`, {
    method: 'POST', token: cswdStaff.token, body: {}
  });
  assert.equal(res.status, 200);
  assert.equal(res.payload.unchanged, false, 'stale inputs always trigger a fresh run');
  createdScoreIds.push(res.payload.score.id);
  assert.deepEqual(res.payload.score.indicators, {
    household_size: 8, income_level: 'No income', damage_extent: 'Major',
    house_status: 'Informal settler', damage_photo: 0
  }, 'new snapshot reflects the updated assessment');

  const after = await api(`/api/scoring/beneficiaries/${recordX}`, { token: barangayStaff.token });
  assert.equal(after.payload.current.stale, false, 'fresh run clears staleness');
  assert.equal(after.payload.history.length, 3, 'every prior run kept in history');
});

/* ------------------------------------------------------------------ */
/* 8. Missing / invalid scoring inputs through the API                 */
/* ------------------------------------------------------------------ */

test('scoring a record with a missing indicator returns 400 with per-field details', async () => {
  // Null out an indicator directly (models a data-quality problem).
  const { error: updErr } = await supabaseAdmin
    .from('beneficiaries')
    .update({ damage_extent: null })
    .eq('id', recordX);
  assert.equal(updErr, null, updErr?.message);

  try {
    const res = await api(`/api/scoring/beneficiaries/${recordX}/score`, {
      method: 'POST', token: cswdStaff.token, body: { force: true }
    });
    assert.equal(res.status, 400, JSON.stringify(res.payload));
    assert.ok(res.payload.error.details.indicators.some((m) => /damage extent/.test(m)),
      'the offending indicator is named');
    // No score row was created by the failed run.
    const { data: rows } = await supabaseAdmin
      .from('vulnerability_scores')
      .select('id')
      .eq('beneficiary_id', recordX)
      .eq('status', 'current');
    assert.equal(rows.length, 1, 'the previous current score survives the failed run');
  } finally {
    // Always restore the indicator so later tests see a complete record.
    const { error: restoreErr } = await supabaseAdmin
      .from('beneficiaries')
      .update({ damage_extent: 'Major' })
      .eq('id', recordX);
    assert.equal(restoreErr, null, restoreErr?.message);
  }
});

/* ------------------------------------------------------------------ */
/* 9. Model unavailable → honest 503 (never a guess)                   */
/* ------------------------------------------------------------------ */

test('when the ML service is unavailable the API answers 503 with guidance', async () => {
  stopMlService();
  resetStatusCache();
  try {
    const res = await api(`/api/scoring/beneficiaries/${recordX}/score`, {
      method: 'POST', token: cswdStaff.token, body: { force: true }
    });
    assert.equal(res.status, 503, JSON.stringify(res.payload));
    assert.match(res.payload.error.message, /vulnerability model service is unavailable/i);

    const status = await api('/api/scoring/model', { token: barangayStaff.token });
    assert.equal(status.status, 200);
    assert.equal(status.payload.available, false, 'model status reports unavailability honestly');
    assert.match(status.payload.reason, /vulnerability model service/i);

    // The outage did not overwrite or invent anything.
    const { data: rows } = await supabaseAdmin
      .from('vulnerability_scores')
      .select('id, status, source')
      .eq('beneficiary_id', recordX)
      .eq('status', 'current');
    assert.equal(rows.length, 1, 'the existing current score survives an ML outage untouched');
    assert.equal(rows[0].source, 'model');
  } finally {
    await startMlService();
    resetStatusCache();
  }
});

/* ------------------------------------------------------------------ */
/* 10. Flagging: CSWD-only, documented                                 */
/* ------------------------------------------------------------------ */

test('flagging a score requires a note and is restricted to CSWD', async () => {
  const { data: scoreRow } = await supabaseAdmin
    .from('vulnerability_scores')
    .select('id')
    .eq('beneficiary_id', recordX)
    .eq('status', 'current')
    .single();
  const scoreId = scoreRow.id;

  // Barangay staff can view scores; flagging is central-office review.
  const brgy = await api(`/api/scoring/scores/${scoreId}/flag`, {
    method: 'POST', token: barangayStaff.token, body: { note: 'Looks wrong to me somehow' }
  });
  assert.equal(brgy.status, 403, 'flagging is CSWD-only');

  // Note too short → 400.
  const shortNote = await api(`/api/scoring/scores/${scoreId}/flag`, {
    method: 'POST', token: cswdStaff.token, body: { note: 'no' }
  });
  assert.equal(shortNote.status, 400);
  assert.ok(shortNote.payload.error.details.note);

  // Valid flag → recorded with reason, reviewer, timestamp.
  const ok = await api(`/api/scoring/scores/${scoreId}/flag`, {
    method: 'POST',
    token: cswdStaff.token,
    body: { note: 'Household size changed between visits; verify before prioritizing.' }
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.payload));
  assert.ok(ok.payload.score.flagged_at, 'flag timestamp recorded');
  assert.equal(ok.payload.score.flagged_by, cswdStaff.id, 'flag attributed to the reviewer');
  assert.match(ok.payload.score.flag_note, /verify before prioritizing/);

  // Double-flagging is refused.
  const again = await api(`/api/scoring/scores/${scoreId}/flag`, {
    method: 'POST', token: cswdStaff.token, body: { note: 'Trying to flag a second time.' }
  });
  assert.equal(again.status, 409);

  // The list now reports the record as flagged.
  const list = await api('/api/scoring/beneficiaries?state=flagged', { token: cswdStaff.token });
  const flagged = list.payload.rows.find((r) => r.id === recordX);
  assert.ok(flagged && flagged.state === 'flagged', 'flagged scores are filterable');
});

/* ------------------------------------------------------------------ */
/* 11. Manual correction: CSWD-only, reason required, history kept     */
/* ------------------------------------------------------------------ */

test('manual correction requires a valid class and a documented reason', async () => {
  const { data: scoreRow } = await supabaseAdmin
    .from('vulnerability_scores')
    .select('id, class, score')
    .eq('beneficiary_id', recordX)
    .eq('status', 'current')
    .single();
  const scoreId = scoreRow.id;

  // Barangay staff cannot correct.
  const brgy = await api(`/api/scoring/scores/${scoreId}/correct`, {
    method: 'POST', token: barangayStaff.token, body: { class: 'High', reason: 'Because I say so.' }
  });
  assert.equal(brgy.status, 403);

  // Invalid class → 400.
  const badClass = await api(`/api/scoring/scores/${scoreId}/correct`, {
    method: 'POST', token: cswdStaff.token, body: { class: 'Catastrophic', reason: 'Valid reason here.' }
  });
  assert.equal(badClass.status, 400);
  assert.ok(badClass.payload.error.details.class);

  // Missing reason → 400.
  const noReason = await api(`/api/scoring/scores/${scoreId}/correct`, {
    method: 'POST', token: cswdStaff.token, body: { class: 'High' }
  });
  assert.equal(noReason.status, 400);
  assert.ok(noReason.payload.error.details.reason);

  // Valid correction → new current row, model row superseded, history kept.
  const ok = await api(`/api/scoring/scores/${scoreId}/correct`, {
    method: 'POST',
    token: cswdStaff.token,
    body: { class: 'High', reason: 'House visit confirmed total loss of livelihood; outranks model output.' }
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.payload));
  createdScoreIds.push(ok.payload.score.id);
  const corrected = ok.payload.score;
  assert.equal(corrected.source, 'manual');
  assert.equal(corrected.class, 'High');
  assert.equal(corrected.corrected_by, cswdStaff.id, 'correction attributed');
  assert.match(corrected.correction_reason, /total loss of livelihood/);
  assert.equal(corrected.probabilities, null, 'manual rows carry no model probabilities');
  assert.equal(corrected.confidence, null, 'manual rows carry no model confidence');

  const { data: rows } = await supabaseAdmin
    .from('vulnerability_scores')
    .select('id, status, source, class')
    .eq('beneficiary_id', recordX)
    .order('created_at', { ascending: true });
  assert.equal(rows.length, 4, 'full history: 3 model runs + 1 correction');
  const states = rows.map((r) => `${r.status}:${r.source}`);
  assert.deepEqual(states, ['superseded:model', 'superseded:model', 'superseded:model', 'current:manual']);

  // The correction replaced the model row as "current" and updated the mirror.
  const { data: mirror } = await supabaseAdmin
    .from('vulnerability_scores')
    .select('class')
    .eq('beneficiary_id', recordX)
    .eq('status', 'current')
    .single();
  assert.equal(mirror.class, 'High');

  // Correcting an already-superseded row is refused (history is immutable).
  const staleCorrect = await api(`/api/scoring/scores/${scoreId}/correct`, {
    method: 'POST', token: cswdStaff.token, body: { class: 'Low', reason: 'Trying to edit history here.' }
  });
  assert.equal(staleCorrect.status, 409, 'superseded rows cannot be re-decided');
});

test('the corrected record can be re-scored by the model afterwards', async () => {
  const res = await api(`/api/scoring/beneficiaries/${recordX}/score`, {
    method: 'POST', token: cswdStaff.token, body: { force: true }
  });
  assert.equal(res.status, 200);
  assert.equal(res.payload.unchanged, false);
  createdScoreIds.push(res.payload.score.id);
  assert.equal(res.payload.score.source, 'model', 'model run replaces the correction as current');

  const { data: rows } = await supabaseAdmin
    .from('vulnerability_scores')
    .select('status')
    .eq('beneficiary_id', recordX)
    .eq('status', 'current');
  assert.equal(rows.length, 1, 'single current row invariant holds');
});

/* ------------------------------------------------------------------ */
/* 12. Filters, sorting, and honest states in the list                 */
/* ------------------------------------------------------------------ */

test('list filters by priority class, state, and search; sorts by score', async () => {
  const all = await api('/api/scoring/beneficiaries', { token: barangayStaff.token });
  assert.equal(all.status, 200);
  assert.ok(all.payload.rows.length >= 3);
  assert.ok(all.payload.counts.missing >= 1, 'the Pending record shows as missing');
  assert.ok(all.payload.model.available === true);
  assert.equal(all.payload.model.datasetType, 'historical', 'list embeds honest model provenance');
  assert.equal(all.payload.scope.barangay, 'Tambacan');

  // Class filter: only rows of that class come back.
  const xDetail = await api(`/api/scoring/beneficiaries/${recordX}`, { token: barangayStaff.token });
  const xClass = xDetail.payload.current.class;
  const byClass = await api(`/api/scoring/beneficiaries?class=${encodeURIComponent(xClass)}`, {
    token: barangayStaff.token
  });
  assert.equal(byClass.status, 200);
  assert.ok(byClass.payload.rows.length >= 1);
  for (const row of byClass.payload.rows) {
    assert.equal(row.vulnerability_class, xClass, 'class filter applies to every row');
  }

  // State filter: missing contains the Pending record only (of ours).
  const missing = await api('/api/scoring/beneficiaries?state=missing', { token: barangayStaff.token });
  assert.equal(missing.status, 200);
  assert.ok(missing.payload.rows.some((r) => r.id === recordZ));
  for (const row of missing.payload.rows) {
    assert.equal(row.state, 'missing');
    assert.equal(row.score, null);
  }

  // Search narrows to one beneficiary number.
  const search = await api(`/api/scoring/beneficiaries?search=${xDetail.payload.record.beneficiary_number}`, {
    token: barangayStaff.token
  });
  assert.equal(search.status, 200);
  assert.equal(search.payload.rows.length, 1);
  assert.equal(search.payload.rows[0].id, recordX);

  // Sort by score, descending: scored rows come first, unscored last.
  const desc = await api('/api/scoring/beneficiaries?sort=score&order=desc&limit=50', { token: barangayStaff.token });
  const scoredInOrder = desc.payload.rows.filter((r) => r.score !== null);
  for (let i = 1; i < scoredInOrder.length; i += 1) {
    assert.ok(scoredInOrder[i - 1].score >= scoredInOrder[i].score, 'descending by score');
  }
  const firstUnscored = desc.payload.rows.findIndex((r) => r.score === null);
  if (firstUnscored !== -1) {
    for (let i = firstUnscored; i < desc.payload.rows.length; i += 1) {
      assert.equal(desc.payload.rows[i].score, null, 'unscored rows always sort last');
    }
  }

  const asc = await api('/api/scoring/beneficiaries?sort=score&order=asc&limit=50', { token: barangayStaff.token });
  const ascScored = asc.payload.rows.filter((r) => r.score !== null);
  for (let i = 1; i < ascScored.length; i += 1) {
    assert.ok(ascScored[i - 1].score <= ascScored[i].score, 'ascending by score');
  }

  // Sort by class respects the vulnerability ordering.
  const byClassSort = await api('/api/scoring/beneficiaries?sort=class&order=desc&limit=50', { token: barangayStaff.token });
  const rank = Object.fromEntries(CLASSES.map((c, i) => [c, i]));
  // Legacy audit rows may carry a retired category — they rank above the
  // current top class, mirroring the server-side ordering.
  const rankOf = (c) => rank[c] ?? CLASSES.length;
  const classed = byClassSort.payload.rows.filter((r) => r.vulnerability_class);
  for (let i = 1; i < classed.length; i += 1) {
    assert.ok(rankOf(classed[i - 1].vulnerability_class) >= rankOf(classed[i].vulnerability_class),
      'descending by class rank');
  }
});

test('every score row in the list discloses its dataset type', async () => {
  const res = await api('/api/scoring/beneficiaries?limit=50', { token: cswdStaff.token });
  assert.equal(res.status, 200);
  for (const row of res.payload.rows) {
    if (row.score !== null) {
      // Rows produced by the current model are 'historical'; scores stored
      // before the model swap keep their original 'synthetic' label — both
      // must always be disclosed, never left blank.
      assert.ok(['historical', 'synthetic'].includes(row.dataset_type),
        `row ${row.id} must disclose its dataset provenance (got ${row.dataset_type})`);
      // Source may be 'model' or 'manual' — authorized CSWD corrections are
      // legitimate current rows and must disclose provenance too.
      assert.ok(['model', 'manual'].includes(row.source), `row ${row.id} has an unexpected source`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* 13. Fairness: scoring never touches eligibility                      */
/* ------------------------------------------------------------------ */

test('scoring never changes application or validation status (no auto-decision)', async () => {
  const before = await api(`/api/scoring/beneficiaries/${recordY}`, { token: barangayStaff.token });
  const statusBefore = before.payload.record.application_status;
  assert.equal(statusBefore, 'Under Verification');

  const res = await api(`/api/scoring/beneficiaries/${recordY}/score`, {
    method: 'POST', token: cswdStaff.token, body: { force: true }
  });
  assert.equal(res.status, 200);
  createdScoreIds.push(res.payload.score.id);

  const after = await api(`/api/scoring/beneficiaries/${recordY}`, { token: barangayStaff.token });
  assert.equal(after.payload.record.application_status, statusBefore,
    'application status untouched by scoring');
  assert.equal(after.payload.record.validation_status, before.payload.record.validation_status,
    'validation status untouched by scoring');
});

test('Tambacan scope holds: the scoring list only contains Tambacan records', async () => {
  // The DB check constraint guarantees this — verify it rejects others.
  const { error } = await supabaseAdmin.from('beneficiaries').insert({
    user_id: createdUserIds[0],
    beneficiary_number: `OUT-OF-SCOPE-${Date.now()}`,
    first_name: 'Out',
    last_name: 'OfScope',
    barangay: 'Other Barangay',
    city_municipality: 'Other City',
    province: 'Other Province',
    application_status: 'Pending'
  });
  assert.ok(error, 'non-Tambacan inserts are rejected by the database constraint');
  assert.match(error.message, /Tambacan|check/);
});

/* ------------------------------------------------------------------ */
/* 14. Shipped artifact matches what the model endpoint reports        */
/* ------------------------------------------------------------------ */

test('the shipped Colab artifact and its metrics are what the API actually serves', async () => {
  const artifactPath = path.join(ML_DIR, 'artifacts', 'priority_model.joblib');
  const metricsPath = path.join(ML_DIR, 'artifacts', 'priority_metrics.json');
  assert.ok(fs.existsSync(artifactPath), 'the trained joblib artifact ships with the service');
  assert.ok(fs.statSync(artifactPath).size > 100000, 'artifact contains the serialized pipeline');

  const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
  assert.ok(metrics.accuracy > 0 && metrics.accuracy <= 1, 'accuracy must be a measured value');
  assert.ok(metrics.nTest > 0);
  assert.match(metrics.evaluatedOn, /held-out/i, 'metrics state their honest scope');
  assert.ok(metrics.split?.testRows > 0 && metrics.split?.trainRows > 0,
    'the train/test split that produced the metrics is disclosed');
  assert.match(metrics.fullDataAgreement?.evaluatedOn || '', /training-set agreement/i,
    'the 1,000-row secondary figure stays labelled as training-set agreement');
  for (const row of metrics.perClass) {
    assert.ok(CLASSES.includes(row.class));
    for (const key of ['precision', 'recall', 'f1']) {
      assert.ok(row[key] >= 0 && row[key] <= 1, `${row.class}.${key} in [0,1]`);
    }
  }

  const res = await fetch(`http://127.0.0.1:${ML_PORT}/health`);
  assert.equal(res.status, 200);
  const health = await res.json();
  assert.equal(health.modelVersion, MODEL_VERSION);
  assert.equal(metrics.nTest, metrics.split.testRows, 'nTest is exactly the held-out split');
  assert.equal(health.dataset.size, metrics.split.trainRows + metrics.split.testRows,
    'the dataset size is the full collected dataset the split was taken from');
  assert.deepEqual(health.evaluation, metrics, 'the service serves the shipped metrics unchanged');
  assert.ok(health.hyperparameters.seed !== undefined, 'training seed recorded for reproducibility');
});

/* ------------------------------------------------------------------ */
/* 15. Damage-photo evidence (rf-1.2.0): uploads change the snapshot   */
/* ------------------------------------------------------------------ */

test('a damage-photo document marks the score stale and enters the snapshot', async () => {
  // 1. Current state: recordX has only its Barangay certificate.
  const before = await api(`/api/scoring/beneficiaries/${recordX}`, { token: barangayStaff.token });
  assert.equal(before.status, 200);
  assert.equal(before.payload.current.stale, false, 'score is fresh before the evidence changes');
  assert.equal(before.payload.current.indicators.damage_photo, 0, 'no damage photo on file yet');

  // 2. The applicant attaches a house-damage photo (own record, allowed).
  const upload = await api('/api/documents', {
    method: 'POST',
    token: applicantX.token,
    body: {
      file: { name: 'damaged-house.png', data: PNG_DATA_URL },
      beneficiary_id: recordX,
      purpose: 'Damage photos'
    }
  });
  assert.equal(upload.status, 201, JSON.stringify(upload.payload));
  const photoDoc = upload.payload.document;

  // 3. The photo on file is new evidence → the stored snapshot is stale.
  const changed = await api(`/api/scoring/beneficiaries/${recordX}`, { token: barangayStaff.token });
  assert.equal(changed.payload.current.stale, true,
    'new documentary evidence marks the score stale without force');
  assert.equal(changed.payload.state, 'stale');

  // 4. Re-run without force: fresh run, evidence flag captured as 1.
  const res = await api(`/api/scoring/beneficiaries/${recordX}/score`, {
    method: 'POST', token: cswdStaff.token, body: {}
  });
  assert.equal(res.status, 200, JSON.stringify(res.payload));
  assert.equal(res.payload.unchanged, false, 'stale evidence always triggers a fresh run');
  createdScoreIds.push(res.payload.score.id);
  assert.equal(res.payload.score.model_version, MODEL_VERSION);
  assert.equal(res.payload.score.indicators.damage_photo, 1,
    'the new snapshot records the damage-photo evidence');

  const { data: snapshotRow } = await supabaseAdmin
    .from('vulnerability_scores')
    .select('indicator_snapshot')
    .eq('id', res.payload.score.id)
    .single();
  assert.equal(snapshotRow.indicator_snapshot.damage_photo, 1,
    'the persisted snapshot stores the evidence flag');

  // 5. Fresh run clears staleness.
  const after = await api(`/api/scoring/beneficiaries/${recordX}`, { token: barangayStaff.token });
  assert.equal(after.payload.current.stale, false, 'fresh run clears staleness');

  // 6. Removing the photo is detected as an evidence change too.
  const viaApi = await api(`/api/documents/${photoDoc.id}`, { method: 'DELETE', token: applicantX.token });
  assert.equal(viaApi.status, 200, JSON.stringify(viaApi.payload));
  const undone = await api(`/api/scoring/beneficiaries/${recordX}`, { token: barangayStaff.token });
  assert.equal(undone.payload.current.stale, true,
    'removing the evidence photo marks the score stale again');
});
