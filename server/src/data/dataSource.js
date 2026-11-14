import env from '../config/env.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { unavailable, notFound } from '../lib/errors.js';
import { buildSyntheticBeneficiaries, SYNTHETIC_DATASET_NOTICE } from './synthetic.js';

/**
 * ReliefGov data source adapter.
 *
 * Modes (checked in order):
 *  1. "supabase"  — Supabase PostgreSQL is configured; production-grade path.
 *  2. "synthetic" — USE_SYNTHETIC_DEMO_DATA=true; in-memory dataset that is
 *                   clearly labelled as synthetic demonstration data.
 *  3. "none"      — no database configured; data endpoints return 503 with an
 *                   actionable message instead of fabricated numbers.
 */

const TABLE = 'beneficiaries';

let syntheticCache = null;

function syntheticStore() {
  if (!syntheticCache) syntheticCache = buildSyntheticBeneficiaries(48);
  return syntheticCache;
}

export function mode() {
  if (env.supabaseServiceRoleKey && env.supabaseUrl) return 'supabase';
  if (env.useSyntheticDemoData) return 'synthetic';
  if (env.supabaseConfigured) return 'supabase'; // table access via anon + RLS
  return 'none';
}

export function describeSource() {
  const current = mode();
  if (current === 'supabase') {
    return {
      mode: 'supabase',
      label: 'Supabase PostgreSQL',
      dataSource: 'live-database',
      notice: null
    };
  }
  if (current === 'synthetic') {
    return {
      mode: 'synthetic',
      label: 'Synthetic demonstration data',
      dataSource: 'synthetic-demo',
      notice: SYNTHETIC_DATASET_NOTICE
    };
  }
  return {
    mode: 'none',
    label: 'Database not configured',
    dataSource: 'none',
    notice:
      'Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in server/.env (see server/.env.example).'
  };
}

const assertAvailable = () => {
  if (mode() === 'none') {
    throw unavailable(
      'Database not configured. Configure Supabase in server/.env or enable USE_SYNTHETIC_DEMO_DATA for demonstration records.',
      describeSource()
    );
  }
};

const inTambacan = (record) =>
  String(record?.address?.barangay || record?.barangay || '').toLowerCase() ===
  'tambacan';

/* ----------------------------- queries ----------------------------- */

export async function listBeneficiaries({ search = '', status = '', application_status = '', limit = 25, offset = 0 } = {}) {
  assertAvailable();

  if (mode() === 'synthetic') {
    let rows = syntheticStore().filter(inTambacan);
    if (status) rows = rows.filter((r) => r.validation_status === status);
    if (application_status) rows = rows.filter((r) => r.application_status === application_status);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) =>
        `${r.first_name} ${r.middle_name} ${r.last_name} ${r.beneficiary_number}`
          .toLowerCase()
          .includes(q)
      );
    }
    const total = rows.length;
    return { total, rows: rows.slice(offset, offset + limit) };
  }

  let query = supabaseAdmin
    .from(TABLE)
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });
  // Hard cap: only Barangay Tambacan records are ever served.
  query = query.eq('barangay', 'Tambacan');
  if (status) query = query.eq('validation_status', status);
  if (application_status) query = query.eq('application_status', application_status);
  if (search.trim()) {
    const q = search.trim().replace(/[%_]/g, '');
    // Search real columns only — there is no full_name column on beneficiaries.
    query = query.or(
      `first_name.ilike.%${q}%,last_name.ilike.%${q}%,beneficiary_number.ilike.%${q}%`
    );
  }
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw unavailable(`Failed to read beneficiary records: ${error.message}`);
  return { total: count ?? (data?.length || 0), rows: data || [] };
}

export async function getBeneficiary(id) {
  assertAvailable();

  if (mode() === 'synthetic') {
    const found = syntheticStore().find((r) => r.id === id && inTambacan(r));
    if (!found) throw notFound('Beneficiary record not found.');
    return found;
  }

  const { data, error } = await supabaseAdmin.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw unavailable(`Failed to read beneficiary record: ${error.message}`);
  if (!data) throw notFound('Beneficiary record not found.');
  if (!inTambacan(data)) throw notFound('Beneficiary record not found.');
  return data;
}

export async function counts() {
  assertAvailable();

  if (mode() === 'synthetic') {
    const rows = syntheticStore().filter(inTambacan);
    const by = (s) => rows.filter((r) => r.validation_status === s).length;
    return {
      total: rows.length,
      verified: by('Verified'),
      pending: by('Pending'),
      flagged: by('Flagged'),
      scored: rows.filter((r) => r.vulnerability_score !== null).length
    };
  }

  const base = supabaseAdmin.from(TABLE).select('*', { count: 'exact', head: true }).eq('barangay', 'Tambacan');
  const total = await base;
  if (total.error) throw unavailable(`Failed to read counts: ${total.error.message}`);

  const stat = async (value) => {
    const { count, error } = await supabaseAdmin
      .from(TABLE)
      .select('*', { count: 'exact', head: true })
      .eq('barangay', 'Tambacan')
      .eq('validation_status', value);
    if (error) throw unavailable(`Failed to read counts: ${error.message}`);
    return count || 0;
  };

  const scoredResult = await supabaseAdmin
    .from(TABLE)
    .select('*', { count: 'exact', head: true })
    .eq('barangay', 'Tambacan')
    .not('vulnerability_score', 'is', null);
  if (scoredResult.error) throw unavailable(`Failed to read counts: ${scoredResult.error.message}`);

  return {
    total: total.count || 0,
    verified: await stat('Verified'),
    pending: await stat('Pending'),
    flagged: await stat('Flagged'),
    scored: scoredResult.count || 0
  };
}

export default {
  mode,
  describeSource,
  listBeneficiaries,
  getBeneficiary,
  counts
};
