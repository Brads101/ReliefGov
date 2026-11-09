import { supabaseAdmin } from '../src/lib/supabase.js';

async function main() {
  const { data: beneficiaries, error } = await supabaseAdmin
    .from('beneficiaries')
    .select('id, beneficiary_number, user_id, first_name, middle_name, last_name, purok, household_size, monthly_family_income, income_level, house_status, damage_extent, household_id, household_no');

  if (error) {
    console.error('Error fetching beneficiaries:', error);
    process.exit(1);
  }

  console.log('Total beneficiaries to process:', beneficiaries.length);

  const { data: profiles } = await supabaseAdmin.from('profiles').select('id');
  const validProfileIds = new Set((profiles || []).map(p => p.id));

  let synced = 0;
  for (const b of beneficiaries) {
    const headName = [b.first_name, b.middle_name, b.last_name].filter(Boolean).join(' ') || 'Unknown';
    const creator = b.user_id && validProfileIds.has(b.user_id) ? b.user_id : null;
    
    // Check documents for barangay certificate
    const { data: docs } = await supabaseAdmin
      .from('documents')
      .select('purpose, status')
      .eq('beneficiary_id', b.id);
    const hasCert = (docs || []).some(d => d.purpose === 'Barangay certificate' && d.status !== 'Rejected');

    let hhId = b.household_id;
    let hhNo = b.household_no;

    if (!hhId) {
      const cleanRef = (b.beneficiary_number || '').replace(/^TAM-/, '') || Math.random().toString(36).substring(2, 8).toUpperCase();
      const newHhNo = 'TAM-HH-' + cleanRef;
      
      const { data: hh, error: hhErr } = await supabaseAdmin
        .from('households')
        .insert({
          household_no: newHhNo,
          family_head_name: headName,
          purok: b.purok,
          address_line: b.purok ? (b.purok + ', Tambacan, Iligan City') : 'Tambacan, Iligan City',
          family_size: b.household_size || 1,
          monthly_family_income: b.monthly_family_income,
          income_level: b.income_level,
          house_status: b.house_status,
          damage_extent: b.damage_extent,
          has_barangay_certificate: hasCert,
          barangay: 'Tambacan',
          city_municipality: 'Iligan City',
          province: 'Lanao del Norte',
          created_by: creator
        })
        .select('id, household_no')
        .single();

      if (hhErr) {
        console.error('Failed to create household for', b.beneficiary_number, hhErr);
        continue;
      }

      hhId = hh.id;
      hhNo = hh.household_no;

      await supabaseAdmin
        .from('beneficiaries')
        .update({ household_id: hhId, household_no: hhNo })
        .eq('id', b.id);
    } else {
      await supabaseAdmin
        .from('households')
        .update({
          family_head_name: headName,
          purok: b.purok,
          address_line: b.purok ? (b.purok + ', Tambacan, Iligan City') : 'Tambacan, Iligan City',
          family_size: b.household_size || 1,
          monthly_family_income: b.monthly_family_income,
          income_level: b.income_level,
          house_status: b.house_status,
          damage_extent: b.damage_extent,
          has_barangay_certificate: hasCert
        })
        .eq('id', hhId);
    }

    if (hhId) {
      await supabaseAdmin.from('documents').update({ household_id: hhId }).eq('beneficiary_id', b.id);
      await supabaseAdmin.from('aid_distributions').update({ household_id: hhId }).eq('beneficiary_id', b.id);
    }
    synced++;
  }

  console.log(`Successfully synced ${synced} households!`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
