/**
 * ReliefGov — Database verification script (Part 7 final verification).
 *
 * Read-only checks against the live Supabase project:
 *  1. All application tables exist and are reachable.
 *  2. Migration 0002-0006 columns exist (schema state proof).
 *  3. RLS is effectively enforced: anon key (no auth) must get ZERO rows
 *     from every table (if RLS were disabled, anon would read everything).
 *  4. Tambacan scoping: every beneficiary row is 'Tambacan' (DB check
 *     constraint also enforces this).
 *  5. Controlled vocabularies: statuses, report types, notification
 *     categories, assistance types, score dataset_type='synthetic'.
 *  6. Integrity spot-checks + data-state row counts.
 *
 * Usage: node scripts/verify-db.js   (from server/)
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!url || !serviceKey || !anonKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY in server/.env');
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
function ok(name, detail = '') { pass += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
function bad(name, detail = '') { fail += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
function check(cond, name, detail = '') { cond ? ok(name, detail) : bad(name, detail); }

const TABLES = [
  'profiles', 'beneficiaries', 'validation_results', 'verification_reviews',
  'application_status_history', 'vulnerability_scores', 'notifications',
  'audit_logs', 'households', 'documents', 'aid_distributions', 'reports',
];

console.log('\n=== 1. Table existence + row counts (service role) ===');
const counts = {};
for (const t of TABLES) {
  const { count, error } = await admin.from(t).select('*', { count: 'exact', head: true });
  if (error) bad(`table ${t}`, error.message);
  else { counts[t] = count ?? 0; ok(`table ${t}`, `${count ?? 0} row(s)`); }
}

console.log('\n=== 2. Migration 0003-0006 column existence ===');
const columnProbes = [
  ['beneficiaries', 'beneficiary_number'],
  ['beneficiaries', 'house_status'],
  ['beneficiaries', 'status_reason'],
  ['beneficiaries', 'incident_type'],
  ['application_status_history', 'to_status'],
  ['vulnerability_scores', 'status'],
  ['vulnerability_scores', 'dataset_type'],
  ['vulnerability_scores', 'indicator_snapshot'],
  ['aid_distributions', 'recorded_by'],
  ['aid_distributions', 'status_reason'],
  ['notifications', 'category'],
  ['notifications', 'link_path'],
];
for (const [t, col] of columnProbes) {
  const { error } = await admin.from(t).select(col).limit(1);
  check(!error, `${t}.${col} exists`, error ? error.message : 'present');
}

console.log('\n=== 3. RLS enforcement (anon key, unauthenticated) ===');
for (const t of TABLES) {
  const { data, error } = await anon.from(t).select('*').limit(5);
  const blocked = !!error || !data || data.length === 0;
  check(blocked, `RLS blocks anon on ${t}`,
    error ? `denied (${error.code || error.message.slice(0, 40)})` : `0 rows exposed`);
}

console.log('\n=== 4. Tambacan scoping ===');
{
  const { data, error } = await admin.from('beneficiaries').select('id, beneficiary_number, barangay, application_status');
  if (error) bad('beneficiary barangay scan', error.message);
  else {
    const nonTambacan = data.filter((r) => r.barangay !== 'Tambacan');
    check(nonTambacan.length === 0, "all beneficiaries barangay = 'Tambacan'",
      `${data.length} record(s) scanned`);
    for (const r of nonTambacan) console.log(`        offending: ${r.beneficiary_number} — ${r.barangay}`);
  }
}
{
  const { data, error } = await admin.from('aid_distributions').select('id, barangay');
  if (error) bad('distribution barangay scan', error.message);
  else {
    const bad2 = data.filter((r) => r.barangay !== 'Tambacan');
    check(bad2.length === 0, "all aid distributions barangay = 'Tambacan'", `${data.length} record(s) scanned`);
  }
}
{
  const { data, error } = await admin.from('profiles').select('id, role, barangay');
  if (error) bad('profile barangay scan', error.message);
  else {
    const staff = data.filter((r) => r.role !== 'beneficiary');
    const bad3 = staff.filter((r) => r.barangay !== 'Tambacan');
    check(bad3.length === 0, 'all staff profiles scoped to Tambacan', `${staff.length} staff row(s)`);
  }
}

console.log('\n=== 5. Controlled vocabularies ===');
{
  const { data } = await admin.from('reports').select('report_type');
  const types = [...new Set((data || []).map((r) => r.report_type))];
  const allowed = ['Beneficiary registry', 'Validation summary', 'Vulnerability summary',
    'Aid distribution', 'Activity log', 'Duplicate review', 'Period summary'];
  check(types.every((t) => allowed.includes(t)), 'report types within DB constraint', types.join(', ') || '(no rows)');
}
{
  const { data } = await admin.from('notifications').select('category, level');
  const cats = [...new Set((data || []).map((r) => r.category).filter(Boolean))];
  const allowedCat = ['application', 'validation', 'scoring', 'distribution', 'staff', 'system'];
  check(cats.every((c) => allowedCat.includes(c)), 'notification categories within DB constraint', cats.join(', ') || '(no rows)');
  const levels = [...new Set((data || []).map((r) => r.level))];
  check(levels.every((l) => ['info', 'success', 'warning', 'error'].includes(l)), 'notification levels within DB constraint', levels.join(', ') || '(no rows)');
}
{
  const { data } = await admin.from('vulnerability_scores').select('dataset_type, class, status');
  const kinds = [...new Set((data || []).map((r) => r.dataset_type))];
  check(kinds.every((k) => k === 'synthetic' || k === 'historical'), 'score dataset_type labeled', kinds.join(', ') || '(no rows)');
  const classes = [...new Set((data || []).map((r) => r.class))];
  check(classes.every((c) => ['Low', 'Moderate', 'High', 'Severe'].includes(c)), 'score class within (Low, Moderate, High, Severe)', classes.join(', ') || '(no rows)');
  const st = [...new Set((data || []).map((r) => r.status))];
  check(st.every((s) => ['current', 'superseded'].includes(s)), "score status in ('current','superseded')", st.join(', ') || '(no rows)');
}
{
  const { data } = await admin.from('aid_distributions').select('status, assistance_type');
  const statuses = [...new Set((data || []).map((r) => r.status))];
  const allowed = ['Planned', 'Released', 'Cancelled'];
  check(statuses.every((s) => allowed.includes(s)), 'distribution statuses within vocabulary', statuses.join(', ') || '(no rows)');
  const types = [...new Set((data || []).map((r) => r.assistance_type))];
  // DB CHECK vocabulary (unchanged). The API will only ever WRITE
  // 'Relief goods' — see distributionService.ASSISTANCE_TYPES — so any
  // other value here is a pre-existing row kept for history, not something
  // the system still offers.
  const allowedTypes = ['Food pack', 'Financial assistance', 'Shelter repair', 'Medical assistance', 'Relief goods', 'Other'];
  check(types.every((s) => allowedTypes.includes(s)), 'assistance types within DB constraint', types.join(', ') || '(no rows)');
  const cash = types.filter((t) => t !== 'Relief goods');
  console.log(`    note: ${cash.length ? cash.join(', ') : 'no'} legacy non-relief row type(s) present (read-only history)`);
}
{
  const { data } = await admin.from('beneficiaries').select('application_status, validation_status');
  const apps = [...new Set((data || []).map((r) => r.application_status))];
  check(apps.every((s) => ['Draft', 'Pending', 'Under Verification', 'Needs Correction', 'Approved', 'Rejected'].includes(s)),
    'application statuses within workflow vocabulary', apps.join(', ') || '(no rows)');
  const vals = [...new Set((data || []).map((r) => r.validation_status))];
  check(vals.every((s) => ['Pending', 'Verified', 'Flagged', 'Duplicate', 'Rejected'].includes(s)),
    'validation statuses within vocabulary', vals.join(', ') || '(no rows)');
}

console.log('\n=== 6. Integrity spot-checks ===');
{
  // One current score per beneficiary (partial unique index behavior).
  const { data } = await admin.from('vulnerability_scores').select('beneficiary_id, status');
  const current = (data || []).filter((r) => r.status === 'current');
  const byBen = {};
  for (const r of current) byBen[r.beneficiary_id] = (byBen[r.beneficiary_id] || 0) + 1;
  const dupes = Object.entries(byBen).filter(([, n]) => n > 1);
  check(dupes.length === 0, 'at most one current score per beneficiary',
    dupes.length ? JSON.stringify(dupes) : `${current.length} current row(s)`);
}
{
  // No orphaned open distribution plans: every Planned row belongs to an Approved beneficiary.
  const { data: plans } = await admin.from('aid_distributions').select('id, status, beneficiary_id');
  const { data: bens } = await admin.from('beneficiaries').select('id, application_status');
  const statusById = Object.fromEntries((bens || []).map((b) => [b.id, b.application_status]));
  const badPlans = (plans || []).filter((p) => p.status === 'Planned' && statusById[p.beneficiary_id] !== 'Approved');
  check(badPlans.length === 0, 'no Planned distribution for non-Approved beneficiary',
    badPlans.length ? JSON.stringify(badPlans.map((p) => p.id)) : 'consistent');
}
{
  // Notifications always target an existing auth user.
  const { data: notifs } = await admin.from('notifications').select('id, user_id');
  const { data: profiles } = await admin.from('profiles').select('id');
  const profileIds = new Set((profiles || []).map((p) => p.id));
  const orphan = (notifs || []).filter((n) => n.user_id && !profileIds.has(n.user_id));
  check(orphan.length === 0, 'no notifications to unknown users', `${(notifs || []).length} notification(s) scanned`);
}

console.log(`\n========== RESULT: ${pass} passed, ${fail} failed ==========`);
console.log('Data-state snapshot:', JSON.stringify(counts));
process.exit(fail > 0 ? 1 : 0);
