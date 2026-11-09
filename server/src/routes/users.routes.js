import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLES } from '../services/authService.js';
import {
  listUsers,
  createStaffAccount,
  setApprovalStatus,
  setActive,
  changeRole
} from '../services/userAdminService.js';

/**
 * CSWD-authorized account management.
 * Every route requires an authenticated, active CSWD staff session; the
 * service-role Supabase client is used only inside userAdminService.
 */
const router = Router();

router.use(requireAuth, requireRole(ROLES.CSWD_STAFF));

router.get('/', async (req, res, next) => {
  try {
    const users = await listUsers();
    res.json({ users, total: users.length });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const profile = await createStaffAccount(req.user, req.body || {});
    res.status(201).json({ user: profile });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/approve', async (req, res, next) => {
  try {
    const user = await setApprovalStatus(req.user, req.params.id, 'approved');
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reject', async (req, res, next) => {
  try {
    const user = await setApprovalStatus(req.user, req.params.id, 'rejected');
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/activate', async (req, res, next) => {
  try {
    const user = await setActive(req.user, req.params.id, true);
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/deactivate', async (req, res, next) => {
  try {
    const user = await setActive(req.user, req.params.id, false);
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/role', async (req, res, next) => {
  try {
    const user = await changeRole(req.user, req.params.id, req.body?.role);
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

export default router;
