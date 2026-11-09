import { Router } from 'express';
import dataSource from '../data/dataSource.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLES } from '../services/authService.js';
import { unavailable } from '../lib/errors.js';

const router = Router();

const STAFF = [ROLES.BARANGAY_STAFF, ROLES.CSWD_STAFF];

const tally = (rows, key) => {
  const counts = {};
  for (const row of rows) {
    const value = row[key] ?? '—';
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
};

/**
 * Dashboard counters are always computed from the configured data source.
 * No totals are hard-coded. Aggregate counters are shown to staff roles only;
 * beneficiaries receive a restricted response instead of community-wide numbers.
 */
router.get('/summary', requireAuth, async (req, res, next) => {
  try {
    const restricted = !STAFF.includes(req.user.role);
    if (restricted) {
      return res.json({
        counts: null,
        restricted: true,
        source: dataSource.describeSource(),
        scope: { barangay: 'Tambacan', city: 'Iligan City', province: 'Lanao del Norte' },
        generatedAt: new Date().toISOString()
      });
    }
    const counts = await dataSource.counts();
    res.json({
      counts,
      source: dataSource.describeSource(),
      scope: { barangay: 'Tambacan', city: 'Iligan City', province: 'Lanao del Norte' },
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Staff operations summary (Batch 4): validation-queue counts, open
 * duplicate flags, recent submissions, purok breakdown, vulnerability
 * visibility, local distribution monitoring and prepared reports.
 * Everything is computed live from Tambacan records.
 */
router.get('/staff-summary', requireAuth, requireRole(...STAFF), async (req, res, next) => {
  try {
    if (!supabaseAdmin) {
      throw unavailable('The staff operations summary requires Supabase configuration on the server.');
    }
    const db = supabaseAdmin;

    const [appsResult, flagCountResult, aidResult, reportCountResult, reportsResult, activityResult, unreadResult] = await Promise.all([
      db.from('beneficiaries')
        .select('id, beneficiary_number, first_name, last_name, purok, application_status, validation_status, vulnerability_class, submitted_at')
        .eq('barangay', 'Tambacan')
        .neq('application_status', 'Draft'),
      db.from('validation_results').select('id', { count: 'exact', head: true }).eq('status', 'Flagged'),
      db.from('aid_distributions').select('status, assistance_type, amount').eq('barangay', 'Tambacan'),
      db.from('reports').select('id', { count: 'exact', head: true }),
      db.from('reports').select('id, report_type, created_at').order('created_at', { ascending: false }).limit(3),
      db.from('audit_logs').select('action, entity, created_at').order('created_at', { ascending: false }).limit(8),
      db.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', req.user.id).is('read_at', null)
    ]);

    for (const result of [appsResult, flagCountResult, aidResult, reportCountResult, reportsResult, activityResult, unreadResult]) {
      if (result.error) throw unavailable(`Failed to read staff summary: ${result.error.message}`);
    }

    const apps = appsResult.data || [];
    const byStatus = tally(apps, 'application_status');
    const recentSubmissions = [...apps]
      .sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0))
      .slice(0, 5)
      .map((row) => ({
        id: row.id,
        beneficiary_number: row.beneficiary_number,
        full_name: [row.first_name, row.last_name].filter(Boolean).join(' '),
        purok: row.purok,
        application_status: row.application_status,
        submitted_at: row.submitted_at
      }));

    const purokCounts = tally(apps, 'purok');
    const purokBreakdown = Object.entries(purokCounts)
      .map(([purok, count]) => ({ purok, count }))
      .sort((a, b) => b.count - a.count || String(a.purok).localeCompare(String(b.purok)));

    const scored = apps.filter((row) => row.vulnerability_class);
    const aid = aidResult.data || [];
    const aidByStatus = tally(aid, 'status');

    res.json({
      queue: {
        pending: byStatus.Pending || 0,
        under_verification: byStatus['Under Verification'] || 0,
        needs_correction: byStatus['Needs Correction'] || 0,
        approved: byStatus.Approved || 0,
        rejected: byStatus.Rejected || 0,
        total: apps.length
      },
      openDuplicateFlags: flagCountResult.count || 0,
      recentSubmissions,
      purokBreakdown,
      vulnerability: {
        scored: scored.length,
        by_class: tally(scored, 'vulnerability_class')
      },
      distribution: {
        total: aid.length,
        planned: aidByStatus.Planned || 0,
        released: aidByStatus.Released || 0,
        cancelled: aidByStatus.Cancelled || 0,
        by_assistance_type: tally(aid, 'assistance_type'),
        total_amount: aid.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
      },
      reports: {
        prepared: reportCountResult.count || 0,
        recent: reportsResult.data || []
      },
      // Recent system activity: the latest audited staff/system actions,
      // newest first. Real audit rows only — nothing is invented.
      recentActivity: (activityResult.data || []).map((row) => ({
        action: row.action,
        entity: row.entity,
        at: row.created_at
      })),
      // The signed-in user's OWN notification counters (never another
      // account's) — recipients stay isolated by the service layer.
      notifications: { unread: unreadResult.count || 0 },
      scope: { barangay: 'Tambacan', city: 'Iligan City', province: 'Lanao del Norte' },
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    next(err);
  }
});

export default router;
