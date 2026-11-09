import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Python ML microservice integration (ReliefGov).
 *
 * Verifies the capstone requirement that the machine-learning component is
 * implemented in Python (scikit-learn) and that the Express API scores
 * records THROUGH that service:
 *
 *  - the service starts, loads the Colab-trained joblib artifact, and
 *    reports honest status (historical provenance, metrics measured on the
 *    notebook's held-out rows, with the 1,000-row figure labelled
 *    separately as training-set agreement);
 *  - GET /api/scoring/model reflects the Python backend;
 *  - POST /api/scoring/beneficiaries/:id/score stores a Python-produced
 *    score with dataset_type = 'historical', probabilities and explanation;
 *  - invalid indicators are rejected with HTTP 400 (never guessed);
 *  - when the service is unreachable, scoring answers HTTP 503 and NO score
 *    is fabricated.
 *
 * It uses the project virtual environment (ml-service/.venv, created by
 * ml-service/setup.bat) and starts its own service instance on a dedicated
 * port so it never interferes with a running development service.
 *
 * If Python or the venv is missing, every test FAILS with an actionable
 * message (run ml-service\setup.bat) — this suite must not silently pass
 * without the Python backend it exists to verify.
 */

process.env.NODE_ENV = 'test';
const ML_PORT = Number(process.env.PYTHON_ML_TEST_PORT || 8177);
process.env.ML_BACKEND = 'python';
process.env.ML_SERVICE_URL = `http://127.0.0.1:${ML_PORT}`;
process.env.ML_SERVICE_TIMEOUT_MS = '20000';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ML_DIR = path.resolve(__dirname, '..', '..', 'ml-service');
const PY = path.join(ML_DIR, '.venv', 'Scripts', 'python.exe');
const APP = path.join(ML_DIR, 'app.py');

const { default: app } = await import('../src/app.js');
const { supabaseAdmin } = await import('../src/lib/supabase.js');
const { MODEL_VERSION } = await import('../src/ml/config.js');

const TEST_PASSWORD = 'Test!Pass123';
const createdUserIds = [];
const createdBeneficiaryIds = [];
let testStart = null;
let service = null;
let server;
let baseUrl;

// 1×1 PNG — accepted by the magic-byte sniffing in documentService.
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/* ------------------------------------------------------------------ */
/* Service lifecycle                                                   */
/* ------------------------------------------------------------------ */

async function api(pathname, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let payload = null;
  try { payload = await res.json(); } catch { payload = null; }
  return { status: res.status, payload };
}

async function startService() {
  if (!fs.existsSync(PY)) {
    throw new Error(
      `Python virtual environment not found at ${PY}. Run ml-service\\setup.bat first.`
    );
  }
  service = spawn(PY, [APP], {
    env: { ...process.env, ML_PORT: String(ML_PORT), ML_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${ML_PORT}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch { /* not up yet */ }
    if (service.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('The Python ML service did not become healthy in time.');
}

function stopService() {
  if (service && service.exitCode === null) {
    service.kill();
    service = null;
  }
}

/* ------------------------------------------------------------------ */
/* Fixtures (staff + a scorable Tambacan record)                       */
/* ------------------------------------------------------------------ */

async function createStaff(email, role) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Python ML Test Staff' }
  });
  if (error) throw new Error(`auth create failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const { error: profErr } = await supabaseAdmin.from('profiles').upsert({
    id: data.user.id,
    email,
    full_name: 'Python ML Test Staff',
    role,
    barangay: 'Tambacan',
    approval_status: 'approved',
    is_active: true
  });
  if (profErr) throw new Error(`profile create failed: ${profErr.message}`);
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password: TEST_PASSWORD } });
  if (login.status !== 200) throw new Error(`login failed: ${JSON.stringify(login.payload)}`);
  return { id: data.user.id, token: login.payload.token, role };
}

async function createBeneficiaryUser(email) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Python ML Test Applicant' }
  });
  if (error) throw new Error(`auth create failed: ${error.message}`);
  createdUserIds.push(data.user.id);
  const login = await api('/api/auth/login', { method: 'POST', body: { email, password: TEST_PASSWORD } });
  if (login.status !== 200) throw new Error(`login failed: ${JSON.stringify(login.payload)}`);
  return { id: data.user.id, token: login.payload.token, role: 'beneficiary' };
}

function appBody(overrides = {}) {
  return {
    first_name: 'Pyml',
    middle_name: '',
    last_name: `Record${Math.random().toString(36).slice(2, 8).replace(/[0-9]/g, 'x').toUpperCase()}`,
    sex: 'Female',
    date_of_birth: '1995-04-12',
    civil_status: 'Single',
    mobile_number: '09171234567',
    purok: 'Purok 5',
    household_size: 6,
    income_level: 'Low',
    monthly_family_income: 4000,
    house_status: 'Owned',
    incident_type: 'Flood',
    incident_date: '2026-09-25',
    incident_description: 'Floodwater entered the house and damaged furniture and appliances.',
    damage_extent: 'Major',
    ...overrides
  };
}

/**
 * Creates a scorable record through the real API flow (create → certificate
 * → submit → staff transition), exactly like the Batch 5 suite does, so the
 * workflow gates are exercised for real.
 */
async function createScorableRecord(user, staffToken, overrides = {}) {
  const created = await api('/api/applications/mine', {
    method: 'POST', token: user.token, body: appBody(overrides)
  });
  assert.equal(created.status, 201, `create failed: ${JSON.stringify(created.payload)}`);
  const id = created.payload.application.id;
  createdBeneficiaryIds.push(id);

  const upload = await api('/api/documents', {
    method: 'POST', token: user.token,
    body: { file: { name: 'certificate.png', data: PNG_DATA_URL }, beneficiary_id: id, purpose: 'Barangay certificate' }
  });
  assert.equal(upload.status, 201, `certificate upload failed: ${JSON.stringify(upload.payload)}`);

  const submitted = await api('/api/applications/mine/submit', { method: 'POST', token: user.token });
  assert.equal(submitted.status, 200, `submit failed: ${JSON.stringify(submitted.payload)}`);

  const endorsed = await api(`/api/applications/${id}/transition`, {
    method: 'POST', token: staffToken, body: { to_status: 'Under Verification' }
  });
  assert.equal(endorsed.status, 200, `endorse failed: ${JSON.stringify(endorsed.payload)}`);
  return id;
}

/* ------------------------------------------------------------------ */
/* Suite                                                               */
/* ------------------------------------------------------------------ */

let staff;
let barangayStaff;
let beneficiary;
let record;
let originalScoreId = null;

before(async () => {
  testStart = new Date();
  await startService();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  staff = await createStaff(`pyml.staff.${Date.now()}@reliefgov.test`, 'cswd_staff');
  barangayStaff = await createStaff(`pyml.brgy.${Date.now()}@reliefgov.test`, 'barangay_staff');
  beneficiary = await createBeneficiaryUser(`pyml.applicant.${Date.now()}@reliefgov.test`);
  record = await createScorableRecord(beneficiary, barangayStaff.token);
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  stopService();
  if (testStart) {
    if (createdBeneficiaryIds.length) {
      await supabaseAdmin.from('vulnerability_scores').delete().in('beneficiary_id', createdBeneficiaryIds);
      await supabaseAdmin.from('application_status_history').delete().in('beneficiary_id', createdBeneficiaryIds);
      await supabaseAdmin.from('beneficiaries').delete().in('id', createdBeneficiaryIds);
    }
    if (createdUserIds.length) {
      await supabaseAdmin.from('audit_logs').delete().in('actor_id', createdUserIds).gte('created_at', testStart.toISOString());
      await supabaseAdmin.from('notifications').delete().in('user_id', createdUserIds).gte('created_at', testStart.toISOString());
      await supabaseAdmin.from('profiles').delete().in('id', createdUserIds);
      for (const id of createdUserIds) await supabaseAdmin.auth.admin.deleteUser(id);
    }
  }
});

test('the Python ML service loads the Colab artifact and reports honest status', async () => {
  const res = await fetch(`http://127.0.0.1:${ML_PORT}/health`);
  assert.equal(res.status, 200);
  const health = await res.json();
  assert.equal(health.available, true);
  assert.equal(health.modelVersion, MODEL_VERSION);
  assert.match(health.implementation, /scikit-learn/i, 'the implementation is Python scikit-learn');
  assert.equal(health.dataset.type, 'historical', 'provenance discloses the collected dataset');
  assert.ok(health.dataset.size > 0);
  assert.match(health.dataset.disclaimer, /held-out/i,
    'the disclaimer discloses the held-out split rather than claiming training-set agreement');
  assert.ok(health.evaluation.accuracy > 0 && health.evaluation.accuracy <= 1);
  assert.match(health.evaluation.evaluatedOn, /held-out/i,
    'metrics are labelled as measured on held-out rows');
  assert.match(health.evaluation.evaluatedOn, /not an external|not a real-world/i,
    'metrics refuse to claim external or real-world accuracy');
  assert.ok(health.evaluation.nTest > 0);
  assert.ok(Array.isArray(health.features.modelColumns) && health.features.modelColumns.length === 9);
  assert.equal(health.target.kind, 'priority category');
  assert.deepEqual(health.target.classes, ['Low', 'Moderate', 'High']);
});

test('GET /api/scoring/model reports the Python backend to staff', async () => {
  const { status, payload } = await api('/api/scoring/model', { token: staff.token });
  assert.equal(status, 200);
  assert.equal(payload.available, true);
  assert.match(payload.algorithm, /scikit-learn/i);
  assert.equal(payload.dataset.type, 'historical');
});

test('the API stores a Python-produced score with probabilities, explanation and dataset label', async () => {
  const { status, payload } = await api(`/api/scoring/beneficiaries/${record}/score`, {
    method: 'POST', token: staff.token, body: { force: true }
  });
  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.unchanged, false);
  const s = payload.score;
  assert.equal(s.source, 'model');
  assert.equal(s.dataset_type, 'historical', 'Python scores are labelled with their real provenance');
  assert.equal(s.model_version, MODEL_VERSION);
  assert.ok(['Low', 'Moderate', 'High'].includes(s.class));
  assert.ok(Array.isArray(s.probabilities) && s.probabilities.length === 3);
  const sum = s.probabilities.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.02, `probabilities sum to ~1 (got ${sum})`);
  assert.ok(s.score >= 0 && s.score <= 100, 'priority index stays within 0–100');
  assert.ok(Array.isArray(s.top_factors) && s.top_factors.length > 0, 'an explanation is stored');

  const { data: row } = await supabaseAdmin.from('vulnerability_scores')
    .select('dataset_type, source, probabilities, indicator_snapshot').eq('id', s.id).single();
  assert.equal(row.dataset_type, 'historical');
  assert.equal(row.source, 'model');
  assert.equal(row.indicator_snapshot.household_size, 6, 'the indicator snapshot is persisted');
  assert.equal(row.indicator_snapshot.damage_photo, 0,
    'the snapshot stores the damage-photo evidence flag (certificate only, no photo)');
  originalScoreId = s.id;
});

test('invalid indicators are rejected with HTTP 400 by the Python path — never guessed', async () => {
  // Null out an indicator directly (models a data-quality problem), the same
  // way the Batch 5 suite does.
  const { error: updErr } = await supabaseAdmin
    .from('beneficiaries')
    .update({ damage_extent: null })
    .eq('id', record);
  assert.equal(updErr, null, updErr?.message);

  try {
    const { status, payload } = await api(`/api/scoring/beneficiaries/${record}/score`, {
      method: 'POST', token: staff.token, body: { force: true }
    });
    assert.equal(status, 400);
    assert.equal(payload.error.status, 400);
    assert.ok(Array.isArray(payload.error.details.indicators) && payload.error.details.indicators.length >= 1);

    const { data: rows } = await supabaseAdmin.from('vulnerability_scores')
      .select('id').eq('beneficiary_id', record).gt('created_at', testStart.toISOString());
    assert.equal((rows || []).filter((r) => r.id !== originalScoreId).length, 0,
      'no new score row is fabricated for an invalid record');
  } finally {
    // Restore the indicator so the rest of the suite stays healthy.
    await supabaseAdmin.from('beneficiaries')
      .update({ damage_extent: 'Major' }).eq('id', record);
  }
});

test('when the Python service is unreachable the API answers 503 and fabricates nothing', async () => {
  stopService(); // simulate the ML service being down
  try {
    const { status, payload } = await api(`/api/scoring/beneficiaries/${record}/score`, {
      method: 'POST', token: staff.token, body: { force: true }
    });
    assert.equal(status, 503, JSON.stringify(payload));
    assert.match(payload.error.message, /unavailable|503|service/i);

    const { data: rows } = await supabaseAdmin.from('vulnerability_scores')
      .select('id, created_at').eq('beneficiary_id', record).eq('status', 'current');
    // The earlier Python score is still the current one — the outage did not
    // overwrite or invent anything.
    assert.equal(rows.length, 1, 'the existing score survives an ML outage untouched');
  } finally {
    await startService(); // bring it back for the suite teardown
  }
});
