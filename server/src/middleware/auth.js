import { unauthorized, forbidden, notFound } from '../lib/errors.js';
import { resolveUser, canReadBarangayRecords, ROLES } from '../services/authService.js';

/**
 * Requires a valid ReliefGov session (Supabase-verified or dev demo token).
 */
export async function requireAuth(req, res, next) {
  try {
    const user = await resolveUser(req);
    if (!user) throw unauthorized();
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * requireRole(ROLES.CSWD_STAFF) or requireRole(ROLES.CSWD_STAFF, ROLES.BARANGAY_STAFF)
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(forbidden('Your account role is not allowed to access this resource.'));
    }
    next();
  };
}

/**
 * Barangay Staff may only act on Barangay Tambacan records.
 * CSWD Staff holds central oversight of all ReliefGov records in this study.
 */
export function requireBarangayRecordAccess(req, res, next) {
  if (!req.user) return next(unauthorized());
  if (!canReadBarangayRecords(req.user)) {
    return next(notFound('Beneficiary record not found.'));
  }
  next();
}

export const isCswd = (user) => user?.role === ROLES.CSWD_STAFF;

export default { requireAuth, requireRole, requireBarangayRecordAccess };
