import { supabaseAdmin } from '../lib/supabase.js';
import { badRequest, forbidden, notFound, HttpError } from '../lib/errors.js';
import { ROLES, IMPLEMENTATION_BARANGAY } from './authService.js';

/**
 * CSWD-authorized account management (server-side, service role only).
 *
 * Staff accounts are NEVER self-registered. They are created here by an
 * authenticated CSWD staff member, land as `pending`, and must be approved
 * before they can sign in. Every mutation is written to audit_logs.
 */

const STAFF_ROLES = [ROLES.BARANGAY_STAFF, ROLES.CSWD_STAFF];

const PROFILE_COLUMNS =
  'id, email, full_name, role, barangay, is_active, approval_status, created_by, approved_by, approved_at, created_at';

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function writeAudit(actorId, action, entity, entityId, detail) {
  try {
    await supabaseAdmin.from('audit_logs').insert({
      actor_id: actorId,
      action,
      entity,
      entity_id: entityId,
      detail
    });
  } catch (err) {
    // Audit failures must never break the user-facing operation, but they
    // should be visible to the operator.
    console.warn('[ReliefGov] audit log write failed:', err.message);
  }
}

export async function listUsers() {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw new HttpError(500, `Failed to list accounts: ${error.message}`);
  return data || [];
}

/**
 * Creates a staff account (pending approval). The auth user is created with
 * a temporary password that the CSWD operator hands over out-of-band; the
 * account cannot sign in until it is approved.
 */
export async function createStaffAccount(actor, { email, password, full_name, role }) {
  if (!STAFF_ROLES.includes(role)) {
    throw badRequest('Staff accounts must have the role "barangay_staff" or "cswd_staff".');
  }
  if (!email || !password || !full_name) {
    throw badRequest('Email, password and full name are required.');
  }
  if (String(password).length < 8) {
    throw badRequest('Temporary password must be at least 8 characters long.');
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name }
  });
  if (error) throw badRequest(error.message);
  if (!data.user) throw new HttpError(500, 'User creation failed.');

  // The DB trigger created an approved beneficiary profile; promote it to the
  // requested staff role, pending approval, through the service role.
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .update({
      role,
      barangay: IMPLEMENTATION_BARANGAY,
      is_active: true,
      approval_status: 'pending',
      created_by: actor.id
    })
    .eq('id', data.user.id)
    .select(PROFILE_COLUMNS)
    .single();
  if (profileError) {
    throw new HttpError(500, `Staff profile setup failed: ${profileError.message}`);
  }

  await writeAudit(actor.id, 'user.create_staff', 'profiles', data.user.id, {
    email,
    role,
    approval_status: 'pending'
  });
  return profile;
}

export async function setApprovalStatus(actor, userId, status) {
  if (!isUuid(userId)) throw badRequest('Invalid account id.');
  if (!['approved', 'rejected'].includes(status)) throw badRequest('Invalid approval status.');

  const { data: target, error: readError } = await supabaseAdmin
    .from('profiles')
    .select('id, role, approval_status')
    .eq('id', userId)
    .maybeSingle();
  if (readError) throw new HttpError(500, readError.message);
  if (!target) throw notFound('Account not found.');

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({
      approval_status: status,
      is_active: status === 'approved',
      approved_by: actor.id,
      approved_at: new Date().toISOString()
    })
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw new HttpError(500, error.message);

  await writeAudit(actor.id, `user.${status}`, 'profiles', userId, { role: target.role });
  return data;
}

export async function setActive(actor, userId, isActive) {
  if (!isUuid(userId)) throw badRequest('Invalid account id.');
  if (userId === actor.id) {
    throw forbidden('You cannot deactivate your own account.');
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ is_active: Boolean(isActive) })
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw new HttpError(500, error.message);

  await writeAudit(actor.id, isActive ? 'user.activate' : 'user.deactivate', 'profiles', userId);
  return data;
}

/**
 * Role change. Guard rails:
 *  - a CSWD account cannot change its own role (no self-escalation/demotion),
 *  - the last active CSWD account cannot be demoted (no lockout).
 */
export async function changeRole(actor, userId, role) {
  if (!isUuid(userId)) throw badRequest('Invalid account id.');
  if (![...STAFF_ROLES, ROLES.BENEFICIARY].includes(role)) {
    throw badRequest('Unknown role.');
  }
  if (userId === actor.id) {
    throw forbidden('You cannot change your own role.');
  }

  const { data: target, error: readError } = await supabaseAdmin
    .from('profiles')
    .select('id, role')
    .eq('id', userId)
    .maybeSingle();
  if (readError) throw new HttpError(500, readError.message);
  if (!target) throw notFound('Account not found.');

  if (target.role === ROLES.CSWD_STAFF && role !== ROLES.CSWD_STAFF) {
    const { count } = await supabaseAdmin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', ROLES.CSWD_STAFF)
      .eq('is_active', true)
      .eq('approval_status', 'approved');
    if ((count ?? 0) <= 1) {
      throw forbidden('The last active CSWD account cannot be demoted. Promote another CSWD account first.');
    }
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ role })
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw new HttpError(500, error.message);

  await writeAudit(actor.id, 'user.change_role', 'profiles', userId, {
    from: target.role,
    to: role
  });
  return data;
}

export default {
  listUsers,
  createStaffAccount,
  setApprovalStatus,
  setActive,
  changeRole
};
