import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLES } from '../services/authService.js';
import {
  getModelStatus,
  listScores,
  getDetail,
  runScore,
  flagScore,
  correctScore,
  getSummary
} from '../services/scoringService.js';

/**
 * Random Forest Vulnerability Scoring endpoints (Batch 5).
 *
 * Every route requires an authenticated barangay or CSWD staff account —
 * beneficiaries get 403, and everything is scoped to Barangay Tambacan
 * inside the service layer (never from client input).
 *
 *  GET  /model                      — honest model status (version, dataset
 *                                     provenance, measured evaluation)
 *  GET  /summary                    — dashboard counts (scored/missing/stale)
 *  GET  /beneficiaries              — list with filters, sorting, states
 *  POST /beneficiaries/:id/score    — run or re-run the score (CSWD only;
 *                                     barangay staff get 403)
 *  GET  /beneficiaries/:id          — detail: current score + full history
 *  POST /scores/:scoreId/flag       — flag a questionable result (CSWD)
 *  POST /scores/:scoreId/correct    — authorized manual correction (CSWD)
 *
 * Route order matters: concrete paths are registered before '/:id'.
 */
const router = Router();
const STAFF = [ROLES.BARANGAY_STAFF, ROLES.CSWD_STAFF];

router.use(requireAuth, requireRole(...STAFF));

router.get('/model', async (req, res, next) => {
  try {
    res.json(await getModelStatus());
  } catch (err) {
    next(err);
  }
});

router.get('/summary', async (req, res, next) => {
  try {
    res.json(await getSummary(req.user));
  } catch (err) {
    next(err);
  }
});

router.get('/beneficiaries', async (req, res, next) => {
  try {
    const result = await listScores(req.user, {
      search: req.query.search,
      class: req.query.class,
      state: req.query.state,
      sort: req.query.sort,
      order: req.query.order,
      limit: req.query.limit,
      offset: req.query.offset
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/beneficiaries/:id/score', async (req, res, next) => {
  try {
    const result = await runScore(req.user, req.params.id, req.body || {});
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/beneficiaries/:id', async (req, res, next) => {
  try {
    res.json(await getDetail(req.user, req.params.id));
  } catch (err) {
    next(err);
  }
});

router.post('/scores/:scoreId/flag', async (req, res, next) => {
  try {
    res.json(await flagScore(req.user, req.params.scoreId, req.body || {}));
  } catch (err) {
    next(err);
  }
});

router.post('/scores/:scoreId/correct', async (req, res, next) => {
  try {
    res.json(await correctScore(req.user, req.params.scoreId, req.body || {}));
  } catch (err) {
    next(err);
  }
});

export default router;
