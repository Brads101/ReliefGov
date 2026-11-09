import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLES } from '../services/authService.js';
import {
  getMineBundle,
  createOwnApplication,
  updateOwnApplication,
  submitOwnApplication,
  transitionApplication
} from '../services/applicationService.js';

/**
 * Beneficiary application endpoints.
 *  - `/mine` routes are for the signed-in applicant only (ownership is
 *    resolved from the verified token, never from the request body).
 *  - `/:id/transition` is staff-only and enforces the documented workflow;
 *    submission alone can never move an application to Approved.
 */
const router = Router();
const STAFF = [ROLES.BARANGAY_STAFF, ROLES.CSWD_STAFF];

router.use(requireAuth);

router.get('/mine', async (req, res, next) => {
  try {
    res.json(await getMineBundle(req.user));
  } catch (err) {
    next(err);
  }
});

router.post('/mine', requireRole(ROLES.BENEFICIARY), async (req, res, next) => {
  try {
    const application = await createOwnApplication(req.user, req.body);
    res.status(201).json({ application });
  } catch (err) {
    next(err);
  }
});

router.patch('/mine', requireRole(ROLES.BENEFICIARY), async (req, res, next) => {
  try {
    const application = await updateOwnApplication(req.user, req.body);
    res.json({ application });
  } catch (err) {
    next(err);
  }
});

router.post('/mine/submit', requireRole(ROLES.BENEFICIARY), async (req, res, next) => {
  try {
    const result = await submitOwnApplication(req.user);
    res.json(result); // 200 for both fresh and idempotent (retried) submissions
  } catch (err) {
    next(err);
  }
});

router.post('/:id/transition', requireRole(...STAFF), async (req, res, next) => {
  try {
    const result = await transitionApplication(req.user, req.params.id, req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
