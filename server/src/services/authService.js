import env from '../config/env.js';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin, supabaseAnon } from '../lib/supabase.js';
import { issueToken, verifyToken, readBearer } from '../lib/jwt.js';
import { unauthorized, badRequest, forbidden, notFound, HttpError } from '../lib/errors.js';

export const ROLES = Object.freeze({
  BENEFICIARY: 'beneficiary',
  BARANGAY_STAFF: 'barangay_staff',
  CSWD_STAFF: 'cswd_staff'
});

export const ROLE_LABELS = Object.freeze({
  beneficiary: 'Beneficiary',
  barangay_staff: 'Barangay Staff (Tambacan)',
  cswd_staff: 'CSWD Staff'
});

export const ROLE_HOME = Object.freeze({
  beneficiary: '/dashboard',
  barangay_staff: '/dashboard',
  cswd_staff: '/dashboard'
});

/**
 * Only Barangay Tambacan exists in this implementation.
 */
export const IMPLEMENTATION_BARANGAY = 'Tambacan';
export const IMPLEMENTATION_CITY = 'Iligan City';
export const IMPLEMENTATION_PROVINCE = 'Lanao del Norte';

/* ------------------------- development demo users ------------------------- */

/**
 * Used ONLY when Supabase Auth is not configured and
 * ENABLE_DEV_DEMO_LOGIN=true. Every account is a demonstration account for
 * the capstone; no real people are represented.
 */
export function devDemoAccounts() {
  if (!env.enableDevDemoLogin || env.supabaseConfigured) return [];
  return [
    {
      email: 'beneficiary@reliefgov.demo',
      full_name: 'Demo Beneficiary',
      role: ROLES.BENEFICIARY,
      barangay: IMPLEMENTATION_BARANGAY
    },
    {
      email: 'tambacan.staff@reliefgov.demo',
      full_name: 'Demo Barangay Staff',
      role: ROLES.BARANGAY_STAFF,
      barangay: IMPLEMENTATION_BARANGAY
    },
    {
      email: 'cswd.staff@reliefgov.demo',
      full_name: 'Demo CSWD Staff',
      role: ROLES.CSWD_STAFF,
      barangay: null
    }
  ];
}

/* ------------------------------ profile I/O ------------------------------ */

const profileCache = new Map();
const PROFILE_CACHE_TTL_MS = 60_000; // 60-second in-memory cache

async function fetchProfile(userId) {
  if (!supabaseAdmin || !userId) return null;

  const now = Date.now();
  const cached = profileCache.get(userId);
  if (cached && now - cached.timestamp < PROFILE_CACHE_TTL_MS) {
    return cached.data;
  }

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('id, email, full_name, role, barangay, is_active, approval_status, created_at')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        lastErr = error;
        if (attempt === 0 && (error.message?.includes('fetch failed') || error.message?.includes('network'))) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        if (cached?.data) {
          console.warn(`[ReliefGov] Supabase profile error (${error.message}); using cached profile for ${userId}.`);
          return cached.data;
        }
        throw new HttpError(500, `Failed to read user profile: ${error.message}`);
      }

      if (data) {
        profileCache.set(userId, { data, timestamp: now });
      }
      return data;
    } catch (err) {
      lastErr = err;
      if (attempt === 0 && (err.message?.includes('fetch failed') || err.message?.includes('network'))) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      if (cached?.data) {
        console.warn(`[ReliefGov] Network fetch error (${err.message}); using cached profile for ${userId}.`);
        return cached.data;
      }
      throw err instanceof HttpError ? err : new HttpError(500, `Failed to read user profile: ${err.message}`);
    }
  }

  if (cached?.data) return cached.data;
  throw lastErr instanceof HttpError ? lastErr : new HttpError(500, `Failed to read user profile: ${lastErr?.message || 'unknown error'}`);
}

/* --------------------------------- login --------------------------------- */

export async function login({ email, password }) {
  if (!email || !password) throw badRequest('Email and password are required.');

  // 1) Supabase Auth
  if (env.supabaseConfigured && supabaseAnon) {
    const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });
    if (error) throw unauthorized('Invalid email or password.');
    const profile = await fetchProfile(data.user?.id);
    if (!profile) throw forbidden('Your account has no ReliefGov profile. Contact the CSWD office.');
    if (profile.approval_status === 'pending') {
      throw forbidden(
        'Your staff account is awaiting approval by the CSWD Office, Iligan City. Contact the CSWD office to activate it.'
      );
    }
    if (profile.approval_status === 'rejected') {
      throw forbidden('This account application was rejected by the CSWD office.');
    }
    if (profile.is_active === false) throw forbidden('This account has been deactivated.');
    const token = issueToken({
      sub: profile.id,
      email: profile.email,
      role: profile.role,
      name: profile.full_name,
      auth: 'supabase'
    });
    return {
      token,
      user: sanitizeUser(profile),
      authMode: 'supabase',
      accessToken: data.session?.access_token || null
    };
  }

  // 2) Development demo accounts (explicitly labelled, never production)
  const demo = devDemoAccounts().find(
    (a) => a.email.toLowerCase() === String(email).toLowerCase()
  );
  if (!demo || password !== env.devDemoPassword) {
    throw unauthorized('Invalid email or password.');
  }
  const token = issueToken({
    sub: `demo-${demo.role}`,
    email: demo.email,
    role: demo.role,
    name: demo.full_name,
    auth: 'development-demo'
  });
  return {
    token,
    user: {
      id: `demo-${demo.role}`,
      email: demo.email,
      full_name: demo.full_name,
      role: demo.role,
      barangay: demo.barangay,
      is_active: true
    },
    authMode: 'development-demo',
    accessToken: null
  };
}

/* ------------------------------ registration ----------------------------- */

/**
 * Self-registration is BENEFICIARY-ONLY by design.
 * A request that asks for a staff role is rejected loudly, never silently
 * upgraded or downgraded into a privileged account.
 */
export async function register({ email, password, full_name, role }) {
  if (!env.supabaseConfigured || !supabaseAdmin) {
    throw new HttpError(
      501,
      'Self-registration requires Supabase Auth. Configure SUPABASE_URL / SUPABASE_ANON_KEY in server/.env.'
    );
  }
  if (!email || !password || !full_name) {
    throw badRequest('Email, password and full name are required.');
  }
  if (role && role !== ROLES.BENEFICIARY) {
    throw forbidden(
      'Public registration is for beneficiaries only. Staff accounts are created and approved by the CSWD office.'
    );
  }
  if (String(password).length < 8) {
    throw badRequest('Password must be at least 8 characters long.');
  }
  const assignedRole = ROLES.BENEFICIARY;

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role: assignedRole }
  });
  if (error) throw badRequest(error.message);
  if (!data.user) throw new HttpError(500, 'User creation failed.');

  // The DB trigger already created an active, approved beneficiary profile.
  // The explicit upsert keeps the profile consistent if the trigger was
  // recreated; it can never elevate the role (beneficiary only).
  const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
    id: data.user.id,
    email,
    full_name,
    role: assignedRole,
    barangay: IMPLEMENTATION_BARANGAY,
    is_active: true,
    approval_status: 'approved'
  });
  if (profileError) throw new HttpError(500, `Profile creation failed: ${profileError.message}`);

  return { id: data.user.id, email, full_name, role: assignedRole };
}

/* --------------------------- password recovery ---------------------------- */

/**
 * Sends a Supabase password-recovery email. The response is intentionally
 * generic so the endpoint cannot be used to probe which emails exist.
 */
export async function requestPasswordReset(email) {
  if (!env.supabaseConfigured || !supabaseAnon || !supabaseAdmin) {
    throw new HttpError(
      501,
      'Password recovery requires Supabase Auth. Configure SUPABASE_URL / SUPABASE_ANON_KEY in server/.env.'
    );
  }
  if (!email) throw badRequest('Email is required.');
  const { error } = await supabaseAdmin.auth.resetPasswordForEmail(String(email).trim(), {
    redirectTo: `${env.clientOrigin.replace(/\/$/, '')}/reset-password`
  });
  if (error) throw badRequest(`Password recovery could not be started: ${error.message}`);
  return {
    ok: true,
    message:
      'If an account exists for that email, a password recovery link has been sent. Check your inbox.'
  };
}

/**
 * Completes a recovery using the one-time token embedded in the recovery
 * link, then sets the new password.
 */
export async function completePasswordReset({ access_token, refresh_token, password }) {
  if (!env.supabaseConfigured || !supabaseAnon) {
    throw new HttpError(501, 'Password recovery requires Supabase Auth.');
  }
  if (!access_token || !refresh_token) {
    throw badRequest('Recovery token is missing. Please open the link from your email again.');
  }
  if (!password || String(password).length < 8) {
    throw badRequest('New password must be at least 8 characters long.');
  }

  // A dedicated client per reset: the shared anon client must never carry a
  // recovery session, and concurrent resets must not clobber each other.
  const resetClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { error: sessionError } = await resetClient.auth.setSession({
    access_token,
    refresh_token
  });
  if (sessionError) {
    throw badRequest(
      'This recovery link is invalid or has expired. Request a new password reset email.'
    );
  }
  const { data, error } = await resetClient.auth.updateUser({ password: String(password) });
  if (error) throw badRequest(`Password could not be updated: ${error.message}`);
  if (!data?.user) throw new HttpError(500, 'Password update returned no user.');
  return { ok: true, message: 'Password updated. You can now sign in with your new password.' };
}

/* ------------------------- self-service profile ------------------------- */

/**
 * Lets a signed-in user update their own profile. Only the display name is
 * writable: email, role, barangay, and approval state are system- or
 * CSWD-managed and are ignored even if a client sends them.
 */
export async function updateOwnProfile(user, { full_name } = {}) {
  if (!env.supabaseConfigured || !supabaseAdmin) {
    throw new HttpError(
      501,
      'Profile updates require Supabase Auth. Development demo accounts cannot persist changes.'
    );
  }
  const trimmed = String(full_name ?? '').trim();
  if (trimmed.length < 2 || trimmed.length > 100) {
    throw badRequest('Full name must be between 2 and 100 characters.');
  }
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ full_name: trimmed })
    .eq('id', user.id)
    .select('id, email, full_name, role, barangay, is_active, approval_status, created_at')
    .single();
  if (error) throw new HttpError(500, `Profile update failed: ${error.message}`);
  if (!data) throw notFound('Profile not found.');
  profileCache.delete(user.id);
  return sanitizeUser(data);
}

/* ------------------------------ token parsing ---------------------------- */

export async function resolveUser(req) {
  const bearer = readBearer(req);
  if (!bearer) return null;

  const claims = verifyToken(bearer);
  if (claims && claims.auth === 'supabase' && supabaseAdmin) {
    let profile = null;
    try {
      profile = await fetchProfile(claims.sub);
    } catch (err) {
      console.warn(`[ReliefGov] resolveUser network warning (${err.message}); falling back to verified JWT claims.`);
      return {
        id: claims.sub,
        email: claims.email,
        full_name: claims.name || claims.full_name || 'Staff User',
        role: claims.role,
        barangay: 'Tambacan',
        is_active: true
      };
    }
    // Every request re-checks activation AND approval: a token issued before
    // an account was suspended or returned to pending must stop working
    // immediately, not just at the next login.
    if (!profile || profile.is_active === false) return null;
    if (profile.approval_status === 'pending' || profile.approval_status === 'rejected') {
      return null;
    }
    return sanitizeUser(profile);
  }
  if (claims && claims.auth === 'development-demo') {
    const demo = devDemoAccounts().find((a) => a.email === claims.email);
    if (!demo) return null;
    return {
      id: `demo-${demo.role}`,
      email: demo.email,
      full_name: demo.full_name,
      role: demo.role,
      barangay: demo.barangay,
      is_active: true
    };
  }
  return null;
}

function sanitizeUser(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    email: profile.email,
    full_name: profile.full_name,
    role: profile.role,
    barangay: profile.barangay ?? null,
    is_active: profile.is_active !== false
  };
}

export function canReadBarangayRecords(user) {
  if (!user) return false;
  if (user.role === ROLES.CSWD_STAFF) return true;
  if (user.role === ROLES.BARANGAY_STAFF) {
    return (user.barangay || IMPLEMENTATION_BARANGAY) === IMPLEMENTATION_BARANGAY;
  }
  return false;
}

export default {
  ROLES,
  ROLE_LABELS,
  login,
  register,
  resolveUser,
  canReadBarangayRecords
};
