/* One-off E2E probe cleanup — removes ONLY the throwaway probe accounts:
 *   probe.upload@test.local (Batch 8 upload/rubric E2E)
 *   probe.e2e@test.local   (upload-recognition UI E2E)
 * together with their beneficiary rows, documents (rows + storage objects),
 * notifications, vulnerability scores, and auth users.
 *
 * Selection is strictly by probe email — protected demo records are never
 * part of the delete set. The script prints a dry-run report first; pass
 * --apply to actually delete, then re-verifies the protected records.
 *
 * Usage:  node scripts/cleanup-probes.mjs [--apply]
 */
import { supabaseAdmin } from '../src/lib/supabase.js';

const PROBE_EMAILS = ['probe.upload@test.local', 'probe.e2e@test.local'];
const PROTECTED_DRAFTS = ['TAM-261015-PGWE', 'TAM-261015-NBYA', 'TAM-261014-EXRC'];
const APPLY = process.argv.includes('--apply');

function log(...args) {
  console.log(...args);
}

async function main() {
  if (!supabaseAdmin) throw new Error('Service-role Supabase client not configured.');

  // ---- resolve probe users + their beneficiary rows -----------------------
  const { data: users, error: uErr } = await supabaseAdmin
    .from('profiles')
    .select('id, email, role')
    .in('email', PROBE_EMAILS);
  if (uErr) throw new Error(`users: ${uErr.message}`);
  log(`probe users found: ${users.length}/${PROBE_EMAILS.length}`,
    users.map((u) => u.email).join(', ') || '(none)');
  const userIds = users.map((u) => u.id);

  const { data: bens, error: bErr } = await supabaseAdmin
    .from('beneficiaries')
    .select('id, user_id, beneficiary_number, application_status, first_name, last_name')
    .in('user_id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']);
  if (bErr) throw new Error(`beneficiaries: ${bErr.message}`);
  log('probe beneficiaries:', bens.map((b) => `${b.beneficiary_number} [${b.application_status}]`).join(', ') || '(none)');
  const benIds = bens.map((b) => b.id);
  const set = (ids) => (ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  const benign = set(benIds);

  // ---- what exists for them ------------------------------------------------
  const [{ data: docs }, { data: scores }, { data: notifs }] = await Promise.all([
    supabaseAdmin.from('documents').select('id, file_name, purpose, storage_path').in('beneficiary_id', benign),
    supabaseAdmin.from('vulnerability_scores').select('id').in('beneficiary_id', benign),
    supabaseAdmin.from('notifications').select('id, user_id').in('user_id', set(userIds))
  ]);
  log(`to delete: documents=${docs?.length ?? 0} (storage objects included), scores=${scores?.length ?? 0}, notifications=${notifs?.length ?? 0}`);

  // ---- staff-side notification residue from probe activity today -----------
  const { data: staffRows } = await supabaseAdmin.from('profiles').select('id, email').in('role', ['barangay_staff', 'cswd_staff']);
  const staffIds = (staffRows || []).map((u) => u.id);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { data: staffToday } = await supabaseAdmin
    .from('notifications')
    .select('id, user_id, title, body, created_at')
    .in('user_id', set(staffIds))
    .gte('created_at', today.toISOString());
  log(`staff notifications created today: ${staffToday?.length ?? 0}`);

  // Staff copies that explicitly reference the probe records (safe subset:
  // matched by probe reference numbers / names, never by date alone).
  const PROBE_TOKENS = ['TAM-261015-3FBX', 'TAM-261015-30YT', 'Probe Upload', 'Probe E2E'];
  const probeRefNotifs = (staffToday || []).filter((n) =>
    PROBE_TOKENS.some((tok) => `${n.title || ''} ${n.body || ''}`.includes(tok))
  );
  log(`staff notifications referencing probe records: ${probeRefNotifs.length}`);
  probeRefNotifs.forEach((n) => log(`   - [${n.created_at}] ${n.title}`));

  if (!APPLY) {
    log('\nDRY RUN — nothing deleted. Re-run with --apply to remove the probe records listed above.');
    return;
  }

  // ---- delete: storage objects, then rows (oldest → newest) ---------------
  if (docs?.length) {
    const { error } = await supabaseAdmin.storage.from('beneficiary-documents')
      .remove(docs.map((d) => d.storage_path).filter(Boolean));
    log('storage objects:', error ? `ERR ${error.message}` : `removed ${docs.length}`);
  }

  if (notifs?.length) {
    const { error } = await supabaseAdmin.from('notifications').delete().in('id', notifs.map((n) => n.id));
    log('probe notifications:', error ? `ERR ${error.message}` : `removed ${notifs.length}`);
  }

  if (probeRefNotifs.length) {
    const { error } = await supabaseAdmin.from('notifications').delete().in('id', probeRefNotifs.map((n) => n.id));
    log('staff copies referencing probe records:', error ? `ERR ${error.message}` : `removed ${probeRefNotifs.length}`);
  }

  const { data: scoreDel, error: sErr } = await supabaseAdmin
    .from('vulnerability_scores').delete().in('beneficiary_id', benign).select('id');
  log('scores:', sErr ? `ERR ${sErr.message}` : `removed ${scoreDel?.length ?? 0}`);

  const { data: docDel, error: dErr } = await supabaseAdmin
    .from('documents').delete().in('beneficiary_id', benign).select('id');
  log('document rows:', dErr ? `ERR ${dErr.message}` : `removed ${docDel?.length ?? 0}`);

  const { data: benDel, error: bb } = await supabaseAdmin
    .from('beneficiaries').delete().in('id', benign).select('id');
  log('beneficiaries:', bb ? `ERR ${bb.message}` : `removed ${benDel?.length ?? 0}`);

  for (const uid of userIds) {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(uid);
    log(`auth user ${uid.slice(0, 8)}:`, error ? `ERR ${error.message}` : 'removed');
  }

  // ---- verify: probes gone, protected records intact -----------------------
  const { data: left } = await supabaseAdmin.from('profiles').select('email').in('email', PROBE_EMAILS);
  log('probe users remaining:', left?.length ?? 0);

  const { data: allUsers } = await supabaseAdmin.from('profiles').select('email, role').order('email');
  log(`all users (${allUsers.length}):`);
  (allUsers || []).forEach((u) => log(`   ${u.email} — ${u.role}`));

  const { data: protectedRows } = await supabaseAdmin
    .from('beneficiaries')
    .select('beneficiary_number, application_status, first_name, last_name')
    .in('beneficiary_number', PROTECTED_DRAFTS);
  log('protected records:', protectedRows);
}

main().catch((err) => { console.error(err); process.exit(1); });
