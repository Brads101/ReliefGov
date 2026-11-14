import { Router } from 'express';
import dataSource from '../data/dataSource.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLES } from '../services/authService.js';

const router = Router();

/**
 * Read-only beneficiary listing for Batch 1.
 * Full create/update/scan workflows arrive in the Beneficiary Profiling batch.
 * Barangay Staff and CSWD Staff only; both are restricted to Tambacan records.
 */
const STAFF = [ROLES.BARANGAY_STAFF, ROLES.CSWD_STAFF];

router.get('/', requireAuth, requireRole(...STAFF), async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const result = await dataSource.listBeneficiaries({
      search: String(req.query.search || ''),
      status: String(req.query.status || ''),
      application_status: String(req.query.application_status || ''),
      limit,
      offset
    });
    res.json({
      ...result,
      source: dataSource.describeSource(),
      scope: { barangay: 'Tambacan', city: 'Iligan City' }
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireAuth, requireRole(...STAFF), async (req, res, next) => {
  try {
    const record = await dataSource.getBeneficiary(req.params.id);
    res.json({ beneficiary: record, source: dataSource.describeSource() });
  } catch (err) {
    next(err);
  }
});

export default router;
