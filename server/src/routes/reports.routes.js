import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLES } from '../services/authService.js';
import {
  listReports,
  createReport,
  buildExportRows,
  toCsv,
  REPORT_TYPES
} from '../services/reportService.js';
import { badRequest } from '../lib/errors.js';
import { supabaseAdmin } from '../lib/supabase.js';

/**
 * Monitoring & Reporting endpoints (Batch 6 — full module).
 *
 *  GET  /                — prepared reports (barangay prepares & submits;
 *                          CSWD oversees)
 *  POST /                — prepare a report from live Barangay Tambacan counts
 *  GET  /preview         — ROW-LEVEL data for the on-screen printable layout
 *  GET  /export?format=  — CSV download using the SAME authorization,
 *                          scope and filters as the preview above
 *
 * Both routes are staff-only. Exports re-apply the Tambacan scope and the
 * date range inside the service, so a crafted request cannot widen them.
 */
const router = Router();
const STAFF = [ROLES.BARANGAY_STAFF, ROLES.CSWD_STAFF];

router.use(requireAuth, requireRole(...STAFF));

/** Shared filter parsing for preview + export — one source of truth. */
function parseFilters(query) {
  const reportType = String(query.report_type || '').trim();
  if (!REPORT_TYPES.includes(reportType)) {
    throw badRequest('Choose a valid report type.', {
      report_type: `Must be one of: ${REPORT_TYPES.join(', ')}.`
    });
  }
  const dateFrom = String(query.date_from || '').trim() || null;
  const dateTo = String(query.date_to || '').trim() || null;
  for (const [field, value] of [['date_from', dateFrom], ['date_to', dateTo]]) {
    if (value && Number.isNaN(Date.parse(value))) {
      throw badRequest(`Invalid ${field} date.`, { [field]: 'Use a valid date (YYYY-MM-DD).' });
    }
  }
  if (dateFrom && dateTo && Date.parse(dateFrom) > Date.parse(dateTo)) {
    throw badRequest('The report period is inverted.', {
      date_from: 'Start date must be on or before the end date.'
    });
  }
  return { reportType, dateFrom, dateTo };
}

router.get('/', async (req, res, next) => {
  try {
    res.json(await listReports(req.user));
  } catch (err) {
    next(err);
  }
});

router.get('/preview', async (req, res, next) => {
  try {
    const filters = parseFilters(req.query);
    const { columns, rows } = await buildExportRows(req.user, filters);
    res.json({
      report_type: filters.reportType,
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
      scope: { barangay: 'Tambacan', city: 'Iligan City', province: 'Lanao del Norte' },
      generatedAt: new Date().toISOString(),
      columns,
      rows,
      row_count: rows.length
    });
  } catch (err) {
    next(err);
  }
});

router.get('/export', async (req, res, next) => {
  try {
    const filters = parseFilters(req.query);
    const format = String(req.query.format || 'csv').trim().toLowerCase();
    if (format !== 'csv') {
      throw badRequest('Unsupported export format.', { format: "Only 'csv' is available." });
    }
    const { columns, rows } = await buildExportRows(req.user, filters);

    const stamp = new Date().toISOString().slice(0, 10);
    const slug = filters.reportType.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const period = filters.dateFrom || filters.dateTo
      ? `_${filters.dateFrom || 'start'}_to_${filters.dateTo || 'today'}`
      : '';
    const filename = `reliefgov_${slug}_tambacan${period}_${stamp}.csv`;

    // Audited so CSWD can see what was exported and by whom.
    try {
      await supabaseAdmin.from('audit_logs').insert({
        actor_id: req.user.id,
        action: 'report.export',
        entity: 'reports',
        entity_id: null,
        detail: { report_type: filters.reportType, format: 'csv', row_count: rows.length, date_from: filters.dateFrom, date_to: filters.dateTo }
      });
    } catch (err) {
      console.warn('[ReliefGov] audit log write failed:', err.message);
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(toCsv(columns, rows));
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const result = await createReport(req.user, req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
