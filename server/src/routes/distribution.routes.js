import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLES } from '../services/authService.js';
import {
  listDistributions,
  getDistributionSummary,
  createDistribution,
  transitionDistribution
} from '../services/distributionService.js';

/**
 * Aid Distribution Monitoring endpoints (Batch 6).
 *
 * Staff-only. Everything is scoped to Barangay Tambacan inside the service
 * layer — never from the request body, query string, or URL. Beneficiaries
 * receive 403 on every route (their own entries remain visible through RLS
 * on the database, but no staff monitoring surface is exposed to them).
 *
 *  GET    /summary              — live counts by status / assistance type
 *  GET    /                     — list with filters, search, pagination
 *  POST   /                     — record a distribution (eligible records only)
 *  POST   /:id/status           — Planned -> Released | Cancelled (audited)
 *
 * No cash or payment processing happens here; this is a monitoring ledger.
 */
const router = Router();
const STAFF = [ROLES.BARANGAY_STAFF, ROLES.CSWD_STAFF];

router.use(requireAuth, requireRole(...STAFF));

router.get('/summary', async (req, res, next) => {
  try {
    res.json(await getDistributionSummary(req.user));
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    res.json(
      await listDistributions(req.user, {
        search: req.query.search,
        status: req.query.status,
        type: req.query.type,
        sort: req.query.sort,
        order: req.query.order,
        limit: req.query.limit,
        offset: req.query.offset
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await createDistribution(req.user, req.body || {}));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/status', async (req, res, next) => {
  try {
    res.json(await transitionDistribution(req.user, req.params.id, req.body || {}));
  } catch (err) {
    next(err);
  }
});

export default router;
