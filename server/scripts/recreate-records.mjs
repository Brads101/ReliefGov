import { supabaseAdmin } from '../src/lib/supabase.js';
import { createOwnApplication, submitOwnApplication, transitionApplication } from '../src/services/applicationService.js';
import { uploadDocument } from '../src/services/documentService.js';

const PASSWORD = 'DemoPassword123!';

// 1x1 transparent PNG data url
const SAMPLE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function getOrCreateUser(email, fullName) {
  const { data: existing } = await supabaseAdmin
    .from('profiles')
    .select('id, email, full_name, role')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    return existing;
  }

  const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName }
  });

  if (error) throw error;

  await supabaseAdmin
    .from('profiles')
    .update({ role: 'beneficiary', approval_status: 'approved', is_active: true, full_name: fullName })
    .eq('id', created.user.id);

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, email, full_name, role')
    .eq('id', created.user.id)
    .single();

  return profile;
}

async function getStaffUser() {
  const { data: staff } = await supabaseAdmin
    .from('profiles')
    .select('id, email, full_name, role')
    .in('role', ['barangay_staff', 'cswd_staff'])
    .eq('is_active', true)
    .limit(1)
    .single();
  return staff;
}

async function run() {
  console.log('Seeding demo flow records...');
  const staff = await getStaffUser();

  // 1. Sylvia Marasigan (Account 1)
  const u1 = await getOrCreateUser('demo.sylvia1@tambacan.local', 'Sylvia Marasigan');
  const { data: old1 } = await supabaseAdmin.from('beneficiaries').select('id').eq('user_id', u1.id);
  if (old1?.length) {
    for (const b of old1) {
      await supabaseAdmin.from('validation_results').delete().or(`beneficiary_id.eq.${b.id},candidate_id.eq.${b.id}`);
      await supabaseAdmin.from('beneficiaries').delete().eq('id', b.id);
    }
  }

  const app1 = await createOwnApplication(u1, {
    first_name: 'Sylvia',
    middle_name: '',
    last_name: 'Marasigan',
    sex: 'Female',
    date_of_birth: '1992-07-04',
    civil_status: 'Single',
    mobile_number: '09170000009',
    purok: 'Purok 2',
    household_size: 5,
    income_level: 'Low',
    monthly_family_income: 6500,
    house_status: 'Informal settler',
    incident_type: 'Flood',
    incident_date: '2026-09-25',
    incident_description: 'Floodwater entered the house and damaged our furniture and appliances.',
    damage_extent: 'Major'
  });

  await uploadDocument(u1, {
    file: { name: 'barangay_certificate_sylvia.png', data: SAMPLE_PNG },
    beneficiary_id: app1.id,
    purpose: 'Barangay certificate'
  });

  await submitOwnApplication(u1);
  if (staff) {
    await transitionApplication(staff, app1.id, {
      to_status: 'Under Verification',
      remarks: 'Initial endorsement from Barangay Tambacan verification desk.'
    });
  }

  // 2. Sylvia Marasigan (Account 2 - Re-application duplicate)
  const u2 = await getOrCreateUser('demo.sylvia2@tambacan.local', 'Sylvia Marasigan');
  const { data: old2 } = await supabaseAdmin.from('beneficiaries').select('id').eq('user_id', u2.id);
  if (old2?.length) {
    for (const b of old2) {
      await supabaseAdmin.from('validation_results').delete().or(`beneficiary_id.eq.${b.id},candidate_id.eq.${b.id}`);
      await supabaseAdmin.from('beneficiaries').delete().eq('id', b.id);
    }
  }

  const app2 = await createOwnApplication(u2, {
    first_name: 'Sylvia',
    middle_name: '',
    last_name: 'Marasigan',
    sex: 'Female',
    date_of_birth: '1992-07-04',
    civil_status: 'Single',
    mobile_number: '09170000010',
    purok: 'Purok 2',
    household_size: 7,
    income_level: 'No income',
    monthly_family_income: 0,
    house_status: 'Informal settler',
    incident_type: 'Flood',
    incident_date: '2026-09-25',
    incident_description: 'Repeated flood application with higher reported household size.',
    damage_extent: 'Total'
  });

  await uploadDocument(u2, {
    file: { name: 'barangay_cert_sylvia_copy.png', data: SAMPLE_PNG },
    beneficiary_id: app2.id,
    purpose: 'Barangay certificate'
  });

  await submitOwnApplication(u2);
  if (staff) {
    await transitionApplication(staff, app2.id, {
      to_status: 'Under Verification',
      remarks: 'Endorsed for review. Potential duplicate flag raised.'
    });
  }

  // 3. Zoraida Padillada
  const u3 = await getOrCreateUser('demo.zoraida@tambacan.local', 'Zoraida Padillada');
  const { data: old3 } = await supabaseAdmin.from('beneficiaries').select('id').eq('user_id', u3.id);
  if (old3?.length) {
    for (const b of old3) {
      await supabaseAdmin.from('validation_results').delete().or(`beneficiary_id.eq.${b.id},candidate_id.eq.${b.id}`);
      await supabaseAdmin.from('beneficiaries').delete().eq('id', b.id);
    }
  }

  const app3 = await createOwnApplication(u3, {
    first_name: 'Zoraida',
    middle_name: '',
    last_name: 'Padillada',
    sex: 'Female',
    date_of_birth: '1985-11-12',
    civil_status: 'Married',
    mobile_number: '09181234567',
    purok: 'Purok 2',
    household_size: 4,
    income_level: 'Low',
    monthly_family_income: 8000,
    house_status: 'Owned',
    incident_type: 'Flood',
    incident_date: '2026-09-25',
    incident_description: 'Water reached 1 meter height inside property.',
    damage_extent: 'Major'
  });

  await uploadDocument(u3, {
    file: { name: 'cert_zoraida.png', data: SAMPLE_PNG },
    beneficiary_id: app3.id,
    purpose: 'Barangay certificate'
  });

  await submitOwnApplication(u3);

  console.log('Seeded successfully:');
  console.log('1. Sylvia Marasigan (Ref):', app1.beneficiary_number, 'Status: Under Verification');
  console.log('2. Sylvia Marasigan (Ref):', app2.beneficiary_number, 'Status: Under Verification (Flagged Duplicate)');
  console.log('3. Zoraida Padillada (Ref):', app3.beneficiary_number, 'Status: Pending');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
