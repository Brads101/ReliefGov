/**
 * SYNTHETIC DEMONSTRATION DATA — Barangay Tambacan, Iligan City, Lanao del Norte.
 *
 * IMPORTANT: Every record produced by this file is fabricated for capstone
 * demonstration purposes only. These are NOT real beneficiaries, NOT official
 * LGU records, and NOT historical CSWD/barangay data.
 *
 * The only barangay represented anywhere in ReliefGov is Barangay Tambacan.
 */

const FIRST_NAMES = [
  'Aira', 'Bryan', 'Cathy', 'Dennis', 'Elena', 'Fritz', 'Grace', 'Hazel',
  'Ivan', 'Jasmine', 'Kevin', 'Lorna', 'Miguel', 'Nadine', 'Oscar', 'Paolo',
  'Queenie', 'Ramon', 'Sofia', 'Theodore', 'Umira', 'Vicente', 'Wendy', 'Yusuf'
];
const LAST_NAMES = [
  'Abdullah', 'Bantas', 'Cabahug', 'Dumalag', 'Escalona', 'Fuentes', 'Gata',
  'Hadjifred', 'Insipido', 'Jamili', 'Kortez', 'Lapuz', 'Mamalubat', 'Nacua',
  'Ompad', 'Padilla', 'Quisumbing', 'Ramadal', 'Sangkay', 'Taharudin', 'Ubaldo'
];
const CIVIL_STATUS = ['Single', 'Married', 'Widowed', 'Separated'];
const EMPLOYMENT = ['Employed', 'Self-employed', 'Unemployed', 'Informal worker', 'Retired'];
const HOUSING = ['Owned', 'Rented', 'Shared with relative', 'Temporarily staying with family'];

/** Deterministic PRNG so demo data is stable across restarts (mulberry32). */
function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, list) => list[Math.floor(rng() * list.length)];

const pad = (n, width) => String(n).padStart(width, '0');

/**
 * Builds the synthetic demonstration dataset.
 * @param {number} size number of households to generate
 */
export function buildSyntheticBeneficiaries(size = 48) {
  const rng = mulberry32(20261014);
  const records = [];

  for (let i = 0; i < size; i += 1) {
    const first = pick(rng, FIRST_NAMES);
    const last = pick(rng, LAST_NAMES);
    const householdSize = 1 + Math.floor(rng() * 7);
    const income = Math.round((3000 + rng() * 22000) / 100) * 100;
    const yearBorn = 1946 + Math.floor(rng() * 56); // 1946–2001
    const month = 1 + Math.floor(rng() * 12);
    const day = 1 + Math.floor(rng() * 28);

    const isSenior = yearBorn <= 1966;
    const isPwd = rng() < 0.12;
    const isPregnant = !isSenior && rng() < 0.08;
    const loneParent = rng() < 0.18;
    const noIncome = rng() < 0.15;

    const statusRoll = rng();
    const validationStatus =
      statusRoll < 0.55 ? 'Verified' : statusRoll < 0.85 ? 'Pending' : 'Flagged';

    records.push({
      id: `tambacan-demo-${pad(i + 1, 4)}`,
      beneficiary_number: `RG-TB-DEMO-${pad(i + 1, 4)}`,
      first_name: first,
      middle_name: '',
      last_name: last,
      sex: rng() < 0.55 ? 'Female' : 'Male',
      date_of_birth: `${yearBorn}-${pad(month, 2)}-${pad(day, 2)}`,
      civil_status: pick(rng, CIVIL_STATUS),
      mobile_number: `09${Math.floor(100000000 + rng() * 899999999)}`,
      address: {
        household_no: String(1 + Math.floor(rng() * 180)),
        purok: `Purok ${1 + Math.floor(rng() * 5)}`,
        barangay: 'Tambacan',
        city_municipality: 'Iligan City',
        province: 'Lanao del Norte'
      },
      household_size: householdSize,
      housing_type: pick(rng, HOUSING),
      employment_status: noIncome ? 'Unemployed' : pick(rng, EMPLOYMENT),
      monthly_family_income: income,
      monthly_per_capita_income: Math.round((income / householdSize) * 100) / 100,
      is_senior: isSenior,
      is_pregnant: isPregnant,
      is_pwd: isPwd,
      is_lone_parent: loneParent,
      has_no_income: noIncome,
      is_internally_displaced: false,
      vulnerability_score: null, // Scoring runs in a later batch.
      vulnerability_class: null,
      validation_status: validationStatus,
      data_origin: 'synthetic-demo',
      created_at: new Date(Date.UTC(2026, 0, 1 + (i % 40))).toISOString(),
      updated_at: new Date(Date.UTC(2026, 0, 1 + (i % 40))).toISOString()
    });
  }

  return records;
}

export const SYNTHETIC_DATASET_NOTICE =
  'Synthetic demonstration data for Barangay Tambacan — not real beneficiaries or official LGU records.';

export default buildSyntheticBeneficiaries;
