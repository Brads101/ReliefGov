import { supabaseAdmin } from '../src/lib/supabase.js';

async function main() {
  const { data: bens, error: benError } = await supabaseAdmin
    .from('beneficiaries')
    .select('id, beneficiary_number, first_name, last_name, purok, application_status, validation_status, created_at, submitted_at, user_id')
    .order('created_at', { ascending: false })
    .limit(10);

  if (benError) console.error('benError:', benError);
  console.log('Recent beneficiaries:');
  console.table(bens);

  const { data: flags, error: flagError } = await supabaseAdmin
    .from('validation_results')
    .select('id, beneficiary_id, candidate_id, status, confidence, similarity_score, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (flagError) console.error('flagError:', flagError);
  console.log('Recent validation flags:');
  console.table(flags);
}

main().catch(console.error);
