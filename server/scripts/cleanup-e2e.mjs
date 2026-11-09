/* One-off Batch 4 UI-test cleanup: removes the two throwaway E2E records
 * (Emil Smoketrial x2), their documents/storage, notifications, and auth
 * users, plus any stray draft records from earlier interactive testing. */
import { supabaseAdmin } from '../src/lib/supabase.js';

const THROWAWAY_USERS = [
  '0a468e1f-0675-4145-8615-6019ce7b9a4d', // W1
  'e036b075-cdf0-47b5-8372-ea45c546d5cd'  // W2
];

const STAFF_USERS = [
  'tambacan.staff@reliefgov.demo',
  'cswd.staff@reliefgov.demo'
];

async function main() {
  // 1. Find throwaway beneficiary records + any stray drafts from testing.
  const { data: rows, error: qErr } = await supabaseAdmin
    .from('beneficiaries')
    .select('id, user_id, beneficiary_number, application_status, first_name, last_name')
    .or(`user_id.in.(${THROWAWAY_USERS.join(',')}),application_status.eq.Draft`);
  if (qErr) throw new Error(`query: ${qErr.message}`);
  console.log('records to remove:', rows.map(
    (r) => `${r.beneficiary_number} ${r.first_name} ${r.last_name} [${r.application_status}]`
  ));

  const ids = rows.map((r) => r.id);
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((u) => u))];

  // 2. Storage files (documents rows reference them; FK cascades on delete).
  const { data: docs } = await supabaseAdmin
    .from('documents')
    .select('storage_path')
    .in('beneficiary_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  if (docs?.length) {
    const { error } = await supabaseAdmin.storage.from('beneficiary-documents')
      .remove(docs.map((d) => d.storage_path));
    console.log(`storage: removed ${docs.length} file(s)`, error ? `ERR ${error.message}` : 'ok');
  }

  // 3. Notifications for these users + notifications sent to staff during this run.
  const { data: staffRows } = await supabaseAdmin.from('users').select('id').in('email', STAFF_USERS);
  const staffIds = (staffRows || []).map((u) => u.id);
  const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const { data: notifCount, error: nErr } = await supabaseAdmin
    .from('notifications')
    .delete()
    .or(`user_id.in.(${[...userIds, ...staffIds].join(',')}),and(user_id.in.(${staffIds.join(',')}),created_at.gte.${since})`)
    .select('id');
  console.log(`notifications: removed ${notifCount?.length ?? 0}`, nErr ? `ERR ${nErr.message}` : 'ok');

  // 4. Beneficiary rows (flags/reviews/history cascade).
  const { error: bErr } = await supabaseAdmin.from('beneficiaries').delete().in('id', ids);
  console.log(`beneficiaries: removed ${ids.length}`, bErr ? `ERR ${bErr.message}` : 'ok');

  // 5. Auth users.
  for (const uid of userIds) {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(uid);
    console.log(`auth user ${uid.slice(0, 8)}:`, error ? `ERR ${error.message}` : 'removed');
  }

  // 6. Verify final state.
  const { count } = await supabaseAdmin
    .from('beneficiaries')
    .select('id', { count: 'exact', head: true });
  console.log('remaining beneficiary rows:', count);
}

main().catch((err) => { console.error(err); process.exit(1); });
