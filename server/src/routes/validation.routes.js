import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLES } from '../services/authService.js';
import {
  listQueue,
  listFlags,
  decideFlag,
  rescanRecord,
  rescanAllRecords,
  getDetail
} from '../services/validationService.js';

/**
 * Data Validation & Duplicate Detection endpoints (Batch 4).
 *
 * Every route requires an authenticated barangay or CSWD staff account —
 * beneficiaries get 403 here, and every query is scoped to Barangay Tambacan
 * inside the service layer (never from client input).
 *
 *  GET  /queue        — validation queue with search/filters
 *  GET  /duplicates   — duplicate flags with their evidence
 *  POST /flags/:id    — decide a flag: confirm | dismiss | request_info
 *  GET  /:id          — full review bundle for one record
 *  POST /:id/rescan   — re-run duplicate detection for one record
 *
 * Route order matters: concrete paths are registered before '/:id'.
 */
const router = Router();
const STAFF = [ROLES.BARANGAY_STAFF, ROLES.CSWD_STAFF];

router.use(requireAuth, requireRole(...STAFF));

router.get('/queue', async (req, res, next) => {
  try {
    const result = await listQueue(req.user, {
      search: req.query.search,
      status: req.query.status,
      purok: req.query.purok,
      from: req.query.from,
      to: req.query.to,
      duplicate: req.query.duplicate,
      limit: req.query.limit,
      offset: req.query.offset
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/duplicates', async (req, res, next) => {
  try {
    const result = await listFlags(req.user, {
      status: req.query.status,
      limit: req.query.limit
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/flags/:flagId', async (req, res, next) => {
  try {
    const result = await decideFlag(req.user, req.params.flagId, req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/rescan-all', async (req, res, next) => {
  try {
    const result = await rescanAllRecords(req.user);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const result = await getDetail(req.user, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/rescan', async (req, res, next) => {
  try {
    const result = await rescanRecord(req.user, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
