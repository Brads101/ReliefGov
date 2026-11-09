import { Router } from 'express';
import { notImplemented } from '../lib/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLES } from '../services/authService.js';

/**
 * Placeholder router for a core module that is scheduled for a later batch.
 * It fails loudly with HTTP 501 instead of pretending to work.
 */
export function createModuleRouter(moduleName, allowedRoles = []) {
  const router = Router();
  const guard = allowedRoles.length
    ? [requireAuth, requireRole(...allowedRoles)]
    : [requireAuth];

  router.use((...args) => {
    const [req, res, next] = args;
    // Run guards first so unauthenticated callers still get 401.
    let index = 0;
    const run = (err) => {
      if (err) return next(err);
      const middleware = guard[index++];
      if (middleware) return middleware(req, res, run);
      return next(notImplemented(moduleName));
    };
    run();
  });

  return router;
}

export const MODULE_NAMES = {
  validation: 'Data Validation and Duplicate Detection',
  scoring: 'Random Forest Vulnerability Scoring',
  reports: 'Monitoring and Reporting',
  notifications: 'Notifications',
  users: 'User Management'
};

export const STAFF = [ROLES.BARANGAY_STAFF, ROLES.CSWD_STAFF];
export const CSWD_ONLY = [ROLES.CSWD_STAFF];

export default createModuleRouter;
