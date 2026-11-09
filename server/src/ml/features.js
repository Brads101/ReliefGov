/**
 * Indicator handling for vulnerability scoring.
 *
 * This module validates and records indicators; it does NOT encode inputs
 * for the model. The shipped Colab pipeline does its own one-hot encoding
 * inside ml-service/app.py, which also maps this system's wording onto the
 * dataset's exact category wording before inference.
 *
 * RECORDED INDICATORS — five values captured with every score:
 *
 *   household_size   family size (integer, 1–50)
 *   income_level     household income level
 *                    ('No income' | 'Low' | 'Moderate' | 'High')
 *   damage_extent    extent of disaster damage
 *                    ('None' | 'Minor' | 'Major' | 'Total')
 *   house_status     housing situation
 *                    ('Owned' | 'Rented' | 'Shared' | 'Informal settler' |
 *                     'Other')
 *   damage_photo     documentary evidence of the claimed damage: 1 when the
 *                    beneficiary has at least one attached "Damage photos"
 *                    document that has not been rejected by staff, else 0.
 *                    OPTIONAL — a missing photo never blocks scoring; it is
 *                    the model's view of "the claimed damage is corroborated
 *                    by a photo on file".
 *
 * MODEL INPUTS — three of the five: income_level, damage_extent and
 *   house_status. household_size and damage_photo are validated, written to
 *   every score's `indicator_snapshot` and used for staleness detection, but
 *   the shipped model never sees them; `/health` reports them as
 *   `features.capturedNotUsed`.
 *
 * DELIBERATELY EXCLUDED (fairness & safety):
 *   sex, civil status, date of birth/age, senior/pregnant/PWD/lone-parent
 *   flags, mobile number, names, purok — none of these are documented
 *   assessment indicators, and several are sensitive attributes. The model
 *   never sees them; scoring a record cannot leak them into the result.
 *   IDENTITY DOCUMENTS (barangay certificate / valid ID / national ID
 *   presence) are also excluded ON PURPOSE: they measure documentation, not
 *   vulnerability, and scoring by document possession would penalize
 *   applicants who cannot obtain an ID. Identity documents are used by the
 *   Data Validation module only, never as a score input.
 *
 * ENCODING — note on the ordinals below:
 *   The numeric values (income No income=3 … High=0; damage None=0 … Total=3)
 *   and the HOUSE_ONE_HOT list are this module's VALIDATION VOCABULARY: they
 *   define the allowed values and feed `missingIndicators`. They are NOT what
 *   the running model consumes — the Python pipeline one-hot-encodes the raw
 *   strings itself.
 *   `encodeRecord` still builds the retired 8-column feature vector used by
 *   the pre-Colab JavaScript forest. Nothing in the serving path calls it
 *   any more; it remains because the test suite still pins its documented
 *   behaviour.
 *
 * A record missing ANY of the four profile indicators cannot be scored —
 * scoring silently degrading on partial data would hide data-quality
 * problems from reviewers. `damage_photo` is optional by design (absent
 * evidence is a legitimate value of 0, not missing data).
 */

import { badRequest } from '../lib/errors.js';

export const FEATURE_NAMES = [
  'household_size',
  'income_level',
  'damage_extent',
  'house_status',
  'damage_photo'
];

export const INCOME_ORDINAL = { 'No income': 3, Low: 2, Moderate: 1, High: 0 };
export const DAMAGE_ORDINAL = { None: 0, Minor: 1, Major: 2, Total: 3 };
export const HOUSE_ONE_HOT = ['Informal settler', 'Shared', 'Rented', 'Other']; // Owned = all zeros

/**
 * Validates the core profile indicators on a beneficiary row.
 * @returns {string[]} list of human-readable problems (empty = valid)
 */
export function missingIndicators(record) {
  const problems = [];
  const size = Number(record?.household_size);
  if (!Number.isInteger(size) || size < 1 || size > 50) {
    problems.push('family size must be a whole number between 1 and 50');
  }
  if (!record?.income_level || !(record?.income_level in INCOME_ORDINAL)) {
    problems.push(`income level must be one of: ${Object.keys(INCOME_ORDINAL).join(', ')}`);
  }
  if (!record?.damage_extent || !(record?.damage_extent in DAMAGE_ORDINAL)) {
    problems.push(`damage extent must be one of: ${Object.keys(DAMAGE_ORDINAL).join(', ')}`);
  }
  if (!HOUSE_ONE_HOT.includes(record?.house_status) && record?.house_status !== 'Owned') {
    problems.push(`house status must be one of: ${[...HOUSE_ONE_HOT, 'Owned'].join(', ')}`);
  }
  return problems;
}

/**
 * Normalizes the documentary-evidence flag to 0/1.
 */
export function damagePhotoValue(record) {
  const v = record?.damage_photo;
  return v === true || v === 1 || v === '1' ? 1 : 0;
}

/**
 * Builds the feature vector for backward compatibility with tests.
 */
export function encodeRecord(record) {
  const problems = missingIndicators(record);
  if (problems.length > 0) {
    throw badRequest('This record cannot be scored until its assessment indicators are complete.', {
      indicators: problems
    });
  }
  const size = Math.min(50, Math.max(1, Number(record?.household_size) || 1));
  const income = INCOME_ORDINAL[record?.income_level] ?? 1;
  const damage = DAMAGE_ORDINAL[record?.damage_extent] ?? 1;
  return [
    size,
    income,
    damage,
    ...HOUSE_ONE_HOT.map((h) => (record?.house_status === h ? 1 : 0)),
    damagePhotoValue(record)
  ];
}

/**
 * Human-readable value snapshot stored with each score.
 */
export function indicatorSnapshot(record) {
  return {
    household_size: record?.household_size,
    income_level: record?.income_level,
    damage_extent: record?.damage_extent,
    house_status: record?.house_status,
    damage_photo: damagePhotoValue(record)
  };
}

/** True when any scoring indicator changed since the stored snapshot. */
export function snapshotChanged(record, snapshot) {
  if (!snapshot) return true;
  const now = indicatorSnapshot(record);
  return FEATURE_NAMES.some((key) => String(now[key]) !== String(snapshot[key]));
}

export default {
  FEATURE_NAMES,
  INCOME_ORDINAL,
  DAMAGE_ORDINAL,
  HOUSE_ONE_HOT,
  missingIndicators,
  damagePhotoValue,
  encodeRecord,
  indicatorSnapshot,
  snapshotChanged
};
