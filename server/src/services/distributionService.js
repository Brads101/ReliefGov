import { supabaseAdmin } from '../lib/supabase.js';
import { badRequest, forbidden, notFound, HttpError, unavailable } from '../lib/errors.js';
import { ROLES } from './authService.js';
import { notify } from './notificationService.js';

/**
 * Aid Distribution Monitoring (Batch 6).
 *
 * This module RECORDS AND MONITORS relief distribution for Barangay
 * Tambacan. It is a monitoring ledger, not a payment system: it stores
 * assistance type, quantity and notes. It does NOT move money, process
 * cash transfers, or integrate with any financial system — that is out of
 * scope for the capstone and is never implied by a peso figure here.
 *
 * Rules enforced in this service (never trusted from the client):
 *  1. Tambacan only — the barangay is set server-side and never read from
 *     the request body, query string, or URL.
 *  2. Only ELIGIBLE, REVIEWED applications can be recorded: the beneficiary
 *     must be an Approved Tambacan record. Drafts, pending and rejected
 *     records are refused with an explicit message.
 *  3. Duplicate protection: one OPEN (Planned) entry per beneficiary per
 *     assistance type. A repeated submit answers 409 — it never silently
 *     creates a second open plan. (Backstopped by the partial unique index
 *     aid_open_plan_idx in migration 0006.)
 *  4. Consistent workflow: Planned -> Released, or Planned -> Cancelling.
 *     Released and Cancelled are terminal; every transition is audited.
 *  5. Both staff roles may record and monitor; the beneficiary who owns a
 *     record may read their own entries (RLS) and is notified on release.
 */

const STAFF_ROLES = Object.freeze([ROLES.BARANGAY_STAFF, ROLES.CSWD_STAFF]);

/**
 * Assistance types this system will CREATE — relief goods only.
 *
 * The `aid_distributions` CHECK constraint still permits the historical
 * vocabulary ('Food pack', 'Financial assistance', 'Shelter repair',
 * 'Medical assistance', 'Other') so rows recorded before this policy
 * remain readable, but the API refuses to write anything except
 * 'Relief goods'. The constraint itself is deliberately NOT altered.
 * Cash assistance is therefore refused server-side, not merely hidden by
 * the client dropdown.
 */
export const ASSISTANCE_TYPES = Object.freeze(['Relief goods']);

/** Workflow states — mirrors the aid_distributions status check constraint. */
export const DISTRIBUTION_STATUSES = Object.freeze(['Planned', 'Released', 'Cancelled']);

/** Statuses that count as an OPEN plan for duplicate detection. */
const OPEN_STATUSES = Object.freeze(['Planned']);

const DISTRIBUTION_COLUMNS =
  'id, reference_no, beneficiary_id, assistance_type, quantity, amount, status, ' +
  'barangay, distributed_by, distributed_at, notes, status_reason, recorded_by, created_at, updated_at';

const RECORD_COLUMNS =
  'id, beneficiary_number, user_id, first_name, middle_name, last_name, purok, ' +
  'application_status, validation_status, barangay';

const SORT_KEYS = Object.freeze(['date', 'beneficiary', 'type']);

function admin() {
  if (!supabaseAdmin) {
    throw unavailable('Aid distribution monitoring requires Supabase configuration on the server.');
  }
  return supabaseAdmin;
}

function assertStaff(user) {
  if (!user || !STAFF_ROLES.includes(user.role)) {
    throw forbidden('Only barangay and CSWD staff can record or monitor aid distribution.');
  }
}

const fullName = (row) =>
  [row?.first_name, row?.middle_name, row?.last_name].filter(Boolean).join(' ');

async function audit(actorId, action, entityId, detail) {
  try {
    await admin().from('audit_logs').insert({
      actor_id: actorId,
      action,
      entity: 'aid_distributions',
      entity_id: entityId,
      detail
    });
  } catch (err) {
    console.warn('[ReliefGov] audit log write failed:', err.message);
  }
}

/**
 * Loads a beneficiary for distribution. Only Approved Tambacan records are
 * eligible; anything else is 404 (no existence leak) and the reason is
 * surfaced by the caller when the record exists but is not eligible.
 */
async function getEligibleRecordOrThrow(id) {
  const { data, error } = await admin()
    .from('beneficiaries')
    .select(RECORD_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data || data.barangay !== 'Tambacan' || data.application_status === 'Draft') {
    throw notFound('Beneficiary record not found.');
  }
  return data;
}

/** Joins distribution rows with their beneficiary for display. */
async function hydrate(rows) {
  if (!rows || rows.length === 0) return [];
  const recordIds = [...new Set(rows.map((r) => r.beneficiary_id).filter(Boolean))];
  const staffIds = [
    ...new Set(rows.flatMap((r) => [r.recorded_by, r.distributed_by]).filter(Boolean))
  ];

  const [recordsResult, staffResult] = await Promise.all([
    recordIds.length
      ? admin().from('beneficiaries').select(RECORD_COLUMNS).in('id', recordIds)
      : Promise.resolve({ data: [], error: null }),
    staffIds.length
      ? admin().from('profiles').select('id, full_name, role').in('id', staffIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (recordsResult.error) throw new HttpError(500, recordsResult.error.message);
  if (staffResult.error) throw new HttpError(500, staffResult.error.message);

  const recordsById = new Map((recordsResult.data || []).map((r) => [r.id, r]));
  const staffById = new Map((staffResult.data || []).map((s) => [s.id, s]));

  return rows.map((row) => {
    const record = recordsById.get(row.beneficiary_id) || null;
    return {
      ...row,
      beneficiary: record
        ? {
            id: record.id,
            beneficiary_number: record.beneficiary_number,
            full_name: fullName(record),
            purok: record.purok,
            application_status: record.application_status,
            validation_status: record.validation_status
          }
        : null,
      recorded_by_profile: row.recorded_by ? staffById.get(row.recorded_by) || null : null,
      distributed_by_profile: row.distributed_by ? staffById.get(row.distributed_by) || null : null
    };
  });
}

/* ------------------------------------------------------------------ */
/* List + summary                                                      */
/* ------------------------------------------------------------------ */

/**
 * Distribution list for staff — Tambacan only, with filters, search,
 * sorting and pagination. Every row is joined with its beneficiary and
 * the responsible staff member.
 */
export async function listDistributions(user, filters = {}) {
  assertStaff(user);

  const search = String(filters.search || '').trim().replace(/[%_,()]/g, '');
  const status = String(filters.status || '').trim();
  const type = String(filters.type || '').trim();
  const sort = String(filters.sort || 'date').trim();
  const order = String(filters.order || 'desc').trim();
  const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 100);
  const offset = Math.max(Number(filters.offset) || 0, 0);

  if (status && !DISTRIBUTION_STATUSES.includes(status)) {
    throw badRequest('Unknown distribution status filter.', {
      status: `Must be one of: ${DISTRIBUTION_STATUSES.join(', ')}.`
    });
  }
  if (type && !ASSISTANCE_TYPES.includes(type)) {
    throw badRequest('Unknown assistance type filter.', {
      type: `Must be one of: ${ASSISTANCE_TYPES.join(', ')}.`
    });
  }
  if (!SORT_KEYS.includes(sort)) {
    throw badRequest('Unknown sort key.', { sort: `Must be one of: ${SORT_KEYS.join(', ')}.` });
  }
  if (order !== 'asc' && order !== 'desc') {
    throw badRequest('Unknown sort order.', { order: "Use 'asc' or 'desc'." });
  }

  let query = admin()
    .from('aid_distributions')
    .select(DISTRIBUTION_COLUMNS, { count: 'exact' })
    .eq('barangay', 'Tambacan');

  if (status) query = query.eq('status', status);
  if (type) query = query.eq('assistance_type', type);

  const sortColumn =
    sort === 'beneficiary' ? 'created_at' : sort === 'type' ? 'assistance_type' : 'distributed_at';
  query = query.order(sortColumn, { ascending: order === 'asc', nullsFirst: false })
    .order('created_at', { ascending: false });

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) throw new HttpError(500, `Failed to read distribution records: ${error.message}`);

  const rows = await hydrate(data || []);

  // Search runs on the hydrated display names/beneficiary numbers, which
  // Supabase cannot filter in the same query; filter the page in memory.
  const filtered = search
    ? rows.filter((row) => {
        const hay = [
          row.reference_no,
          row.beneficiary?.full_name,
          row.beneficiary?.beneficiary_number
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(search.toLowerCase());
      })
    : rows;

  return {
    distributions: filtered,
    total: count ?? filtered.length,
    limit,
    offset,
    hasMore: offset + filtered.length < (count ?? filtered.length)
  };
}

/** Live counts for the monitoring dashboard and the page header. */
export async function getDistributionSummary(user) {
  assertStaff(user);

  const [rowsResult, recordCountResult] = await Promise.all([
    admin().from('aid_distributions').select('status, assistance_type, quantity').eq('barangay', 'Tambacan'),
    admin().from('beneficiaries').select('id', { count: 'exact', head: true }).eq('barangay', 'Tambacan')
  ]);
  if (rowsResult.error) throw unavailable(`Failed to read distribution summary: ${rowsResult.error.message}`);
  if (recordCountResult.error) throw unavailable(`Failed to read beneficiary count: ${recordCountResult.error.message}`);

  const rows = rowsResult.data || [];
  const byStatus = { Planned: 0, Released: 0, Cancelled: 0 };
  const byType = {};
  let totalQuantity = 0;

  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    byType[row.assistance_type] = (byType[row.assistance_type] || 0) + 1;
    totalQuantity += Number(row.quantity) || 0;
  }

  return {
    total: rows.length,
    by_status: byStatus,
    by_assistance_type: byType,
    total_quantity: totalQuantity,
    eligible_records: recordCountResult.count || 0,
    scope: { barangay: 'Tambacan', city: 'Iligan City', province: 'Lanao del Norte' },
    generatedAt: new Date().toISOString()
  };
}

/* ------------------------------------------------------------------ */
/* Record a distribution                                               */
/* ------------------------------------------------------------------ */

/**
 * Records a NEW distribution entry for an eligible (Approved) Tambacan
 * beneficiary. Refuses a second open plan for the same assistance type.
 */
export async function createDistribution(user, body) {
  assertStaff(user);

  const beneficiaryId = String(body?.beneficiary_id || '').trim();
  if (!beneficiaryId) {
    throw badRequest('Choose the beneficiary this assistance is for.', {
      beneficiary_id: 'A beneficiary record is required.'
    });
  }

  const assistanceType = String(body?.assistance_type || '').trim();
  if (!ASSISTANCE_TYPES.includes(assistanceType)) {
    throw badRequest('Choose a valid assistance type.', {
      assistance_type: `Must be one of: ${ASSISTANCE_TYPES.join(', ')}.`
    });
  }

  const quantity = Number(body?.quantity ?? 1);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 10000) {
    throw badRequest('Enter a valid quantity.', { quantity: 'Must be between 1 and 10000.' });
  }

  const rawAmount = body?.amount;
  let amount = null;
  if (rawAmount !== undefined && rawAmount !== null && String(rawAmount).trim() !== '') {
    amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) {
      throw badRequest('Enter a valid recorded amount.', {
        amount: 'Must be a non-negative figure under 100,000,000.'
      });
    }
  }

  const notes = String(body?.notes || '').trim();
  if (notes.length > 500) {
    throw badRequest('The notes are too long.', { notes: 'Keep them under 500 characters.' });
  }

  // Eligibility gate — reviewed and approved records only.
  const record = await getEligibleRecordOrThrow(beneficiaryId);
  if (record.application_status !== 'Approved') {
    throw badRequest(
      `This record cannot receive aid distribution yet (current status: ${record.application_status}).`,
      {
        beneficiary_id:
          'Only Approved applications are eligible for distribution. Complete verification first.'
      }
    );
  }

  // Duplicate gate — one open plan per beneficiary per assistance type.
  const { data: openRows, error: openError } = await admin()
    .from('aid_distributions')
    .select('id, reference_no, status')
    .eq('beneficiary_id', beneficiaryId)
    .eq('assistance_type', assistanceType)
    .in('status', OPEN_STATUSES);
  if (openError) throw new HttpError(500, openError.message);

  if (openRows && openRows.length > 0) {
    throw new HttpError(
      409,
      `An open ${assistanceType.toLowerCase()} entry already exists for this beneficiary (reference ${openRows[0].reference_no}). Mark it released or cancelled before recording another.`,
      { beneficiary_id: 'Duplicate open entry.', reference_no: openRows[0].reference_no }
    );
  }

  const { data, error } = await admin()
    .from('aid_distributions')
    .insert({
      beneficiary_id: beneficiaryId,
      assistance_type: assistanceType,
      quantity,
      amount,
      notes: notes || null,
      status: 'Planned',
      barangay: 'Tambacan',
      recorded_by: user.id
    })
    .select(DISTRIBUTION_COLUMNS)
    .single();
  if (error) {
    // The partial unique index is the final backstop for a racing double submit.
    if (error.code === '23505') {
      throw new HttpError(409, 'An open entry for this assistance type already exists.', {
        beneficiary_id: 'Duplicate open entry.'
      });
    }
    throw new HttpError(500, error.message);
  }

  await audit(user.id, 'distribution.create', data.id, {
    beneficiary_id: beneficiaryId,
    assistance_type: assistanceType,
    quantity,
    status: 'Planned'
  });

  const [hydrated] = await hydrate([data]);
  return { distribution: hydrated };
}

/* ------------------------------------------------------------------ */
/* Status transitions                                                  */
/* ------------------------------------------------------------------ */

/**
 * Moves an entry through the workflow:
 *   Planned -> Released  (records who released it and when)
 *   Planned -> Cancelled (requires a reason)
 * Released and Cancelled are terminal. Every transition is audited and the
 * beneficiary is notified.
 */
export async function transitionDistribution(user, id, body) {
  assertStaff(user);

  const toStatus = String(body?.to_status || '').trim();
  if (!['Released', 'Cancelled'].includes(toStatus)) {
    throw badRequest('Unknown distribution status.', {
      to_status: "Must be 'Released' or 'Cancelled'."
    });
  }

  const { data: existing, error: readError } = await admin()
    .from('aid_distributions')
    .select(DISTRIBUTION_COLUMNS)
    .eq('id', id)
    .eq('barangay', 'Tambacan')
    .maybeSingle();
  if (readError) throw new HttpError(500, readError.message);
  if (!existing) throw notFound('Distribution record not found.');

  if (existing.status !== 'Planned') {
    throw new HttpError(
      409,
      `This entry is already ${existing.status.toLowerCase()} and cannot be changed.`,
      { status: `Current status is ${existing.status}.` }
    );
  }

  let statusReason = null;
  if (toStatus === 'Cancelled') {
    statusReason = String(body?.reason || '').trim();
    if (statusReason.length < 5) {
      throw badRequest('A reason is required to cancel a distribution entry.', {
        reason: 'Give a brief reason (at least 5 characters).'
      });
    }
    if (statusReason.length > 500) {
      throw badRequest('The reason is too long.', { reason: 'Keep it under 500 characters.' });
    }
  }

  const patch = { status: toStatus, status_reason: statusReason };
  if (toStatus === 'Released') {
    patch.distributed_at = new Date().toISOString();
    patch.distributed_by = user.id;
  }

  const { data, error } = await admin()
    .from('aid_distributions')
    .update(patch)
    .eq('id', id)
    .eq('status', 'Planned')
    .select(DISTRIBUTION_COLUMNS)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) {
    // Another staff member transitioned it between our read and write.
    throw new HttpError(409, 'This entry was just changed by another user. Reload and try again.');
  }

  // Audit action follows the codebase verb convention (scoring.flag,
  // document.accept, application.transition): distribution.release /
  // distribution.cancel, with the status transition kept in the detail.
  await audit(user.id, `distribution.${toStatus === 'Released' ? 'release' : 'cancel'}`, data.id, {
    beneficiary_id: data.beneficiary_id,
    assistance_type: data.assistance_type,
    from_status: 'Planned',
    to_status: toStatus,
    reason: statusReason
  });

  await notifyBeneficiary(data, toStatus, statusReason);

  const [hydrated] = await hydrate([data]);
  return { distribution: hydrated };
}

/** Tells the record owner what happened — in-system only, no SMS/email. */
async function notifyBeneficiary(distribution, toStatus, reason) {
  try {
    const { data: record } = await admin()
      .from('beneficiaries')
      .select('user_id')
      .eq('id', distribution.beneficiary_id)
      .maybeSingle();
    if (!record?.user_id) return;

    const payload =
      toStatus === 'Released'
        ? {
            title: 'Relief assistance released',
            body: `Your ${distribution.assistance_type.toLowerCase()} (reference ${distribution.reference_no}) has been released by the barangay office. Quantity: ${distribution.quantity}.`,
            level: 'success',
            category: 'distribution',
            link_path: '/application'
          }
        : {
            title: 'Relief assistance entry cancelled',
            body: `The ${distribution.assistance_type.toLowerCase()} entry (reference ${distribution.reference_no}) was cancelled. Reason: ${reason}`,
            level: 'warning',
            category: 'distribution',
            link_path: '/application'
          };

    await notify(record.user_id, payload);
  } catch (err) {
    console.warn('[ReliefGov] distribution notification failed:', err.message);
  }
}

export default {
  ASSISTANCE_TYPES,
  DISTRIBUTION_STATUSES,
  listDistributions,
  getDistributionSummary,
  createDistribution,
  transitionDistribution
};
