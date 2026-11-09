import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Batch 2 security tests: unauthorized access, role escalation, and
 * Barangay-Tambacan-only enforcement. Runs against the live Express app
 * (started on an ephemeral port) with the Supabase project configured in
 * server/.env — RLS and the profile triggers can only be exercised against
 * the real database. Every account created here is deleted afterwards.
 */

process.env.NODE_ENV = 'test';

const { default: app } = await import('../src/app.js');
const { default: env } = await import('../src/config/env.js');
const { supabaseAdmin } = await import('../src/lib/supabase.js');

const TEST_PASSWORD = 'Test!Pass123';
const createdUserIds = [];

let server;
let baseUrl;

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

async function login(email, password) {
  const res = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(res.payload)}`);
  return res.payload;
}

/** Creates a Supabase auth user directly, like the CSWD admin path does. */
async function createAuthUser(email, { role = 'beneficiary', approval = 'approved', active = true } = {}) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `Test ${role}` }
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  createdUserIds.push(data.user.id);

  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .update({ role, approval_status: approval, is_active: active })
    .eq('id', data.user.id);
  if (profileError) throw new Error(`profile setup failed: ${profileError.message}`);
  return data.user;
}

before(async () => {
  if (!env.supabaseConfigured || !supabaseAdmin) {
    throw new Error('Batch 2 security tests require Supabase configuration in server/.env');
  }
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  for (const id of createdUserIds) {
    try {
      await supabaseAdmin.auth.admin.deleteUser(id);
    } catch (err) {
      console.warn('cleanup failed for', id, err.message);
    }
  }
  // Beneficiary rows created by tests survive auth-user deletion
  // (user_id is ON DELETE SET NULL), so remove them explicitly.
  try {
    await supabaseAdmin
      .from('beneficiaries')
      .delete()
      .like('beneficiary_number', 'TEST-%');
  } catch (err) {
    console.warn('beneficiary cleanup failed:', err.message);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
});

/* ------------------------------------------------------------------ */
/* 1. Unauthorized access                                              */
/* ------------------------------------------------------------------ */

test('unauthenticated requests are rejected with 401', async () => {
  for (const path of ['/api/beneficiaries', '/api/users', '/api/documents', '/api/auth/me']) {
    const res = await api(path);
    assert.equal(res.status, 401, `${path} should require authentication`);
  }
});

test('garbage tokens are rejected with 401', async () => {
  const res = await api('/api/beneficiaries', { token: 'not.a.jwt' });
  assert.equal(res.status, 401);
});

test('beneficiary cannot read the beneficiary registry or user list', async () => {
  const email = uniqueEmail('benef');
  await createAuthUser(email, { role: 'beneficiary' });
  const { token } = await login(email, TEST_PASSWORD);

  const registry = await api('/api/beneficiaries', { token });
  assert.equal(registry.status, 403, 'beneficiaries must not list all profiles');

  const users = await api('/api/users', { token });
  assert.equal(users.status, 403, 'beneficiaries must not manage accounts');
});

test('barangay staff cannot manage accounts', async () => {
  const email = uniqueEmail('staff');
  await createAuthUser(email, { role: 'barangay_staff' });
  const { token } = await login(email, TEST_PASSWORD);

  const res = await api('/api/users', { token });
  assert.equal(res.status, 403, 'only CSWD may manage accounts');
});

/* ------------------------------------------------------------------ */
/* 2. Role escalation protection                                       */
/* ------------------------------------------------------------------ */

test('public registration cannot grant a staff role', async () => {
  for (const role of ['barangay_staff', 'cswd_staff']) {
    const res = await api('/api/auth/register', {
      method: 'POST',
      body: { email: uniqueEmail(`escalate-${role}`), password: TEST_PASSWORD, full_name: 'Escalation Probe', role }
    });
    assert.equal(res.status, 403, `registering as ${role} must be refused`);
  }
});

test('public registration creates an approved beneficiary only', async () => {
  const email = uniqueEmail('selfreg');
  const res = await api('/api/auth/register', {
    method: 'POST',
    body: { email, password: TEST_PASSWORD, full_name: 'Self Registered' }
  });
  assert.equal(res.status, 201);
  createdUserIds.push(res.payload.id);

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, approval_status, is_active')
    .eq('id', res.payload.id)
    .single();
  assert.equal(profile.role, 'beneficiary', 'self-registration must land as beneficiary');
  assert.equal(profile.approval_status, 'approved');
  assert.equal(profile.is_active, true);
});

test('a pending staff account cannot sign in until approved', async () => {
  const email = uniqueEmail('pending');
  await createAuthUser(email, { role: 'barangay_staff', approval: 'pending' });

  const denied = await api('/api/auth/login', { method: 'POST', body: { email, password: TEST_PASSWORD } });
  assert.equal(denied.status, 403, 'pending staff must not sign in');
  assert.match(denied.payload.error.message, /approval/i);

  await supabaseAdmin
    .from('profiles')
    .update({ approval_status: 'approved', is_active: true, approved_at: new Date().toISOString() })
    .eq('email', email);

  const allowed = await api('/api/auth/login', { method: 'POST', body: { email, password: TEST_PASSWORD } });
  assert.equal(allowed.status, 200, 'approved staff must be able to sign in');
});

test('a deactivated account cannot sign in', async () => {
  const email = uniqueEmail('deact');
  await createAuthUser(email, { role: 'barangay_staff', approval: 'approved', active: false });
  const res = await api('/api/auth/login', { method: 'POST', body: { email, password: TEST_PASSWORD } });
  assert.equal(res.status, 403);
  assert.match(res.payload.error.message, /deactivated/i);
});

test('an authenticated user cannot escalate their own role via PostgREST', async () => {
  const email = uniqueEmail('rls-escalate');
  const user = await createAuthUser(email, { role: 'beneficiary' });
  const { accessToken } = await login(email, TEST_PASSWORD);
  assert.ok(accessToken, 'test expects a Supabase access token in the login response');

  // Direct table update through the anon REST endpoint with the user's JWT.
  const res = await fetch(`${env.supabaseUrl}/rest/v1/profiles?id=eq.${user.id}`, {
    method: 'PATCH',
    headers: {
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({ role: 'cswd_staff', approval_status: 'approved' })
  });

  if (res.ok) {
    const rows = await res.json();
    const roleAfter = rows?.[0]?.role;
    assert.notEqual(roleAfter, 'cswd_staff', 'role escalation via PostgREST must not take effect');
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  assert.equal(profile.role, 'beneficiary', 'role must remain beneficiary after the attempt');
});

test('an authenticated user cannot insert a profile directly', async () => {
  const email = uniqueEmail('rls-insert-profile');
  await createAuthUser(email, { role: 'beneficiary' });
  const { accessToken } = await login(email, TEST_PASSWORD);

  const res = await fetch(`${env.supabaseUrl}/rest/v1/profiles`, {
    method: 'POST',
    headers: {
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      id: '00000000-0000-4000-8000-000000000001',
      email: 'injected@reliefgov.test',
      full_name: 'Injected',
      role: 'cswd_staff'
    })
  });
  assert.ok(res.status >= 400, `direct profile insert must be refused, got ${res.status}`);
});

/* ------------------------------------------------------------------ */
/* 3. Barangay Tambacan-only enforcement                               */
/* ------------------------------------------------------------------ */

test('staff cannot encode a record for another barangay', async () => {
  const email = uniqueEmail('tambacan');
  await createAuthUser(email, { role: 'barangay_staff' });
  const { accessToken } = await login(email, TEST_PASSWORD);

  const res = await fetch(`${env.supabaseUrl}/rest/v1/beneficiaries`, {
    method: 'POST',
    headers: {
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      beneficiary_number: `TEST-${Date.now()}`,
      first_name: 'Out',
      last_name: 'ofScope',
      barangay: 'Poblacion',
      city_municipality: 'Iligan City',
      province: 'Lanao del Norte'
    })
  });
  assert.ok(res.status >= 400, `non-Tambacan insert must be refused, got ${res.status}`);

  const { data: rows } = await supabaseAdmin
    .from('beneficiaries')
    .select('id')
    .eq('first_name', 'Out')
    .eq('last_name', 'ofScope');
  assert.equal((rows || []).length, 0, 'no out-of-scope record may exist');
});

test('a beneficiary cannot move their record to another barangay', async () => {
  const ownerEmail = uniqueEmail('own-profile');
  const owner = await createAuthUser(ownerEmail, { role: 'beneficiary' });
  const { accessToken } = await login(ownerEmail, TEST_PASSWORD);

  const bn = `TEST-OWN-${Date.now()}`;
  const { data: beneficiary } = await supabaseAdmin
    .from('beneficiaries')
    .insert({
      beneficiary_number: bn,
      user_id: owner.id,
      first_name: 'Own',
      last_name: 'Record',
      barangay: 'Tambacan',
      city_municipality: 'Iligan City',
      province: 'Lanao del Norte',
      application_status: 'Pending',
      submitted_at: new Date().toISOString()
    })
    .select('id')
    .single();
  assert.ok(beneficiary, 'setup: beneficiary record should exist');

  const res = await fetch(`${env.supabaseUrl}/rest/v1/beneficiaries?id=eq.${beneficiary.id}`, {
    method: 'PATCH',
    headers: {
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ barangay: 'Poblacion' })
  });

  const { data: after } = await supabaseAdmin
    .from('beneficiaries')
    .select('barangay')
    .eq('id', beneficiary.id)
    .single();
  assert.equal(after.barangay, 'Tambacan', 'barangay must remain Tambacan after the attempt');
  if (res.ok) {
    // Even if the request "succeeded" at transport level, the row must be unchanged.
    assert.equal(after.barangay !== 'Poblacion', true);
  }
});

test('a beneficiary cannot mark their own record as verified', async () => {
  const ownerEmail = uniqueEmail('self-verify');
  const owner = await createAuthUser(ownerEmail, { role: 'beneficiary' });
  const { accessToken } = await login(ownerEmail, TEST_PASSWORD);

  const bn = `TEST-VER-${Date.now()}`;
  const { data: beneficiary } = await supabaseAdmin
    .from('beneficiaries')
    .insert({
      beneficiary_number: bn,
      user_id: owner.id,
      first_name: 'Self',
      last_name: 'Verify',
      barangay: 'Tambacan',
      city_municipality: 'Iligan City',
      province: 'Lanao del Norte'
    })
    .select('id')
    .single();

  await fetch(`${env.supabaseUrl}/rest/v1/beneficiaries?id=eq.${beneficiary.id}`, {
    method: 'PATCH',
    headers: {
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ validation_status: 'Verified', vulnerability_class: 'Low', vulnerability_score: 0 })
  });

  const { data: after } = await supabaseAdmin
    .from('beneficiaries')
    .select('validation_status, vulnerability_class')
    .eq('id', beneficiary.id)
    .single();
  assert.notEqual(after.validation_status, 'Verified', 'applicants must not self-verify');
  assert.notEqual(after.vulnerability_class, 'Low', 'applicants must not self-assign a class');
});

/* ------------------------------------------------------------------ */
/* 4. Document storage safety                                          */
/* ------------------------------------------------------------------ */

test('documents endpoint rejects unsupported file types and oversized files', async () => {
  const email = uniqueEmail('docs');
  await createAuthUser(email, { role: 'beneficiary' });
  const { token } = await login(email, TEST_PASSWORD);

  // A tiny text file disguised as a PDF data URL — content sniffing must catch it.
  const fakePdf = `data:application/pdf;base64,${Buffer.from('not a pdf').toString('base64')}`;
  const badType = await api('/api/documents', {
    method: 'POST',
    token,
    body: { file: { name: 'fake.pdf', data: fakePdf }, purpose: 'Other' }
  });
  assert.ok(badType.status >= 400, 'mismatched content must be rejected');

  // Oversized payload (5 MB + 1).
  const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0x41);
  const bigDataUrl = `data:image/png;base64,${big.toString('base64')}`;
  const tooBig = await api('/api/documents', {
    method: 'POST',
    token,
    body: { file: { name: 'big.png', data: bigDataUrl }, purpose: 'Other' }
  });
  assert.ok(tooBig.status >= 400, 'oversized files must be rejected');

  // A real (1×1) PNG must be accepted, and only the uploader may download it.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  const okUpload = await api('/api/documents', {
    method: 'POST',
    token,
    body: { file: { name: 'pixel.png', data: `data:image/png;base64,${png.toString('base64')}` }, purpose: 'Other' }
  });
  assert.equal(okUpload.status, 201, `valid upload should succeed: ${JSON.stringify(okUpload.payload)}`);
  const docId = okUpload.payload.document.id;

  const otherEmail = uniqueEmail('docs-other');
  await createAuthUser(otherEmail, { role: 'beneficiary' });
  const other = await login(otherEmail, TEST_PASSWORD);
  const denied = await api(`/api/documents/${docId}/download`, { token: other.token });
  assert.equal(denied.status, 403, 'another beneficiary must not download this document');

  const owner = await login(email, TEST_PASSWORD);
  const allowed = await api(`/api/documents/${docId}/download`, { token: owner.token });
  assert.equal(allowed.status, 200, 'the uploader must be able to download their document');
  assert.ok(allowed.payload.url, 'a signed URL should be returned');

  const removed = await api(`/api/documents/${docId}`, { method: 'DELETE', token: owner.token });
  assert.equal(removed.status, 200);
});

/* ------------------------------------------------------------------ */
/* 5. Password recovery plumbing                                       */
/* ------------------------------------------------------------------ */

test('password recovery refuses invalid tokens with a clear message', async () => {
  const res = await api('/api/auth/reset-password', {
    method: 'POST',
    body: { access_token: 'invalid', refresh_token: 'invalid', password: 'NewPass123!' }
  });
  assert.ok(res.status >= 400, 'invalid recovery tokens must be refused');
  assert.match(res.payload.error.message, /link|expired|invalid/i);
});

test('forgot-password answers generically (no account enumeration)', async () => {
  const res = await api('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: uniqueEmail('nobody') }
  });
  if (res.status === 200) {
    assert.match(res.payload.message, /if an account exists/i);
  } else {
    // SMTP delivery problems are tolerated, but the error must never reveal
    // whether an account exists for the address.
    assert.doesNotMatch(JSON.stringify(res.payload), /no account|not found|unknown email|does not exist/i);
  }
});

/* ------------------------------------------------------------------ */
/* 6. Self-service profile management                                  */
/* ------------------------------------------------------------------ */

test('a user can update their own display name — and nothing else', async () => {
  const email = uniqueEmail('profile');
  await createAuthUser(email, { role: 'beneficiary' });
  const { token } = await login(email, TEST_PASSWORD);

  // Extra fields (role, barangay) ride along and must be ignored.
  const res = await api('/api/auth/me', {
    method: 'PATCH',
    token,
    body: { full_name: 'Updated Test Name', role: 'cswd_staff', barangay: 'Poblacion' }
  });
  assert.equal(res.status, 200, `profile update should succeed: ${JSON.stringify(res.payload)}`);
  assert.equal(res.payload.user.full_name, 'Updated Test Name');
  assert.equal(res.payload.user.role, 'beneficiary', 'role must never be writable through profile update');
  assert.equal(res.payload.user.barangay, 'Tambacan', 'barangay must never be writable through profile update');

  const me = await api('/api/auth/me', { token });
  assert.equal(me.payload.user.full_name, 'Updated Test Name', 'the change must persist on the next request');
});

test('profile update rejects blank and oversized names', async () => {
  const email = uniqueEmail('profile-bad');
  await createAuthUser(email, { role: 'beneficiary' });
  const { token } = await login(email, TEST_PASSWORD);

  for (const full_name of ['', '   ', 'x', 'A'.repeat(101)]) {
    const res = await api('/api/auth/me', { method: 'PATCH', token, body: { full_name } });
    assert.ok(res.status >= 400, `invalid name ${JSON.stringify(full_name)} must be refused`);
  }
});

test('profile update requires authentication', async () => {
  const res = await api('/api/auth/me', { method: 'PATCH', body: { full_name: 'No Token Allowed' } });
  assert.equal(res.status, 401);
});
