/**
 * Duplicate detection helpers (Batch 4 — Data Validation module).
 *
 * Practical, explainable comparisons over information the applicant already
 * provided and the office is authorized to hold. No national ID, biometric or
 * external-database integration exists here by design (explicitly out of
 * scope for the capstone).
 *
 * A matching name ALONE is never treated as proof of a duplicate: it can
 * raise a low-confidence flag for a human to review, nothing more. Strong
 * evidence is agreement on name + date of birth or name + mobile number.
 *
 * Every score comes with plain-language evidence strings so authorized staff
 * can see exactly WHY a pair of records was flagged.
 */

const FLAG_THRESHOLD_NAME = 0.78; // name-based review flags
const CONFIDENT_NAME = 0.80;
/** No name anchor → never a flag. Coinciding life facts (same birth date in
 *  the same purok, a shared household mobile number) must not flag two
 *  different people; a duplicate claim always starts from the name. */
const FLAG_NAME_FLOOR = 0.45;

/** Lowercase, strip accents/punctuation, collapse whitespace. */
export function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Letters and digits only — for compact comparisons. */
export function normalizeCompact(value) {
  return normalizeText(value).replace(/\s/g, '');
}

/** 09171234567 / +639171234567 / 639171234567 → 09171234567 (or null). */
export function normalizeMobile(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('63') && digits.length === 12) digits = `0${digits.slice(2)}`;
  if (digits.startsWith('630') && digits.length === 13) digits = `0${digits.slice(2)}`;
  return digits || null;
}

/** Levenshtein similarity in [0, 1]: 1 = identical strings. */
export function stringSimilarity(a, b) {
  const s1 = String(a || '');
  const s2 = String(b || '');
  if (s1 === s2) return 1;
  if (!s1 || !s2) return 0;
  const rows = s1.length + 1;
  const cols = s2.length + 1;
  let prev = new Array(cols).fill(0).map((_, i) => i);
  for (let i = 1; i < rows; i += 1) {
    const cur = [i];
    for (let j = 1; j < cols; j += 1) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  const dist = prev[cols - 1];
  return 1 - dist / Math.max(s1.length, s2.length);
}

/**
 * Full-name similarity in [0, 1]. Considers both the direct spelling and the
 * token-sorted form so "Maria Clara Santos" and "Clara Maria Santos" score
 * the same while genuinely different names score low.
 */
export function nameSimilarity(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const direct = stringSimilarity(na, nb);
  const ta = na.split(' ').sort().join(' ');
  const tb = nb.split(' ').sort().join(' ');
  const sorted = ta === tb ? 1 : stringSimilarity(ta, tb);
  return Math.max(direct, sorted);
}

const fullName = (row) =>
  [row?.first_name, row?.middle_name, row?.last_name].filter(Boolean).join(' ');

/**
 * Score two beneficiary records against each other.
 *
 * @param {object} a     the record being reviewed / flagged
 * @param {object} b     the candidate record
 * @returns {{score:number, flagged:boolean, confidence:'high'|'medium'|'low'|null,
 *            nameSimilarity:number, matches:object, evidence:string[]}}
 *   `matches` values are true (agree), false (both present, disagree) or
 *   null (not enough information to compare).
 */
export function scorePair(a, b) {
  const nameA = fullName(a);
  const nameB = fullName(b);
  const sim = nameSimilarity(nameA, nameB);

  const lastA = normalizeText(a?.last_name);
  const lastB = normalizeText(b?.last_name);
  const sameLastName = Boolean(lastA && lastB && (lastA === lastB || stringSimilarity(lastA, lastB) >= 0.85));

  const dobA = a?.date_of_birth || null;
  const dobB = b?.date_of_birth || null;
  const dobMatch = dobA && dobB ? dobA === dobB : null;

  const mobA = normalizeMobile(a?.mobile_number);
  const mobB = normalizeMobile(b?.mobile_number);
  const mobileMatch = mobA && mobB ? mobA === mobB : null;

  const purokA = normalizeText(a?.purok);
  const purokB = normalizeText(b?.purok);
  const purokMatch = purokA && purokB ? purokA === purokB : null;

  const hhA = a?.household_size ?? null;
  const hhB = b?.household_size ?? null;
  const householdMatch = hhA != null && hhB != null ? Number(hhA) === Number(hhB) : null;

  // Weighted score over the fields that actually have information on both
  // sides (weights renormalized when a field is unknown).
  const components = [
    { key: 'name', weight: 0.45, value: sim },
    { key: 'dob', weight: 0.25, value: dobMatch },
    { key: 'mobile', weight: 0.20, value: mobileMatch },
    { key: 'purok', weight: 0.05, value: purokMatch },
    { key: 'household', weight: 0.05, value: householdMatch }
  ].filter((c) => c.value !== null);
  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const score = totalWeight > 0
    ? components.reduce((sum, c) => sum + c.weight * (c.value ? 1 : 0), 0) / totalWeight
    : 0;

  // Confidence ladder — practical, explainable duplicate scoring.
  // A matching name alone is NEVER stronger than low. Strong identifiers
  // (DOB, mobile, address) are required to reach medium or high confidence.
  let confidence = null;
  if (
    (dobMatch === true && sim >= 0.70) ||
    (mobileMatch === true && sim >= 0.60)
  ) {
    confidence = 'high';
  } else if (
    (sameLastName && purokMatch === true && sim >= 0.65) ||
    (sim >= 0.75 && (purokMatch === true || householdMatch === true)) ||
    (dobMatch === true && purokMatch === true && sim >= FLAG_NAME_FLOOR) ||
    (mobileMatch === true && sim >= FLAG_NAME_FLOOR) ||
    (score >= 0.70 && (dobMatch === true || mobileMatch === true || purokMatch === true))
  ) {
    confidence = 'medium';
  } else if (
    sim >= 0.70 ||
    (sameLastName && purokMatch === true)
  ) {
    confidence = 'low';
  }

  const evidence = [];
  if (sim >= 0.999) evidence.push(`Full name matches exactly (${nameA})`);
  else if (sim >= 0.80) evidence.push(`Full names are ${Math.round(sim * 100)}% similar (${nameA} vs ${nameB})`);
  else if (sim >= 0.5) evidence.push(`Names partially overlap (${Math.round(sim * 100)}% similar)`);
  if (sameLastName && purokMatch === true) evidence.push(`Same surname (${a.last_name || lastA}) in ${a.purok || purokA}`);
  if (dobMatch === true) evidence.push(`Date of birth matches (${dobA})`);
  if (mobileMatch === true) evidence.push(`Mobile number matches (${mobA})`);
  if (purokMatch === true && !sameLastName) evidence.push(`Same purok (${a.purok})`);
  if (householdMatch === true) evidence.push(`Same family size (${hhA})`);
  if (confidence === 'low') evidence.push('Name/household similarity — review before deciding');

  return {
    score: Number(score.toFixed(4)),
    flagged: confidence !== null,
    confidence,
    nameSimilarity: Number(sim.toFixed(4)),
    matches: {
      name: sim >= FLAG_THRESHOLD_NAME,
      dob: dobMatch,
      mobile: mobileMatch,
      purok: purokMatch,
      household: householdMatch
    },
    evidence
  };
}

export default {
  normalizeText,
  normalizeCompact,
  normalizeMobile,
  stringSimilarity,
  nameSimilarity,
  scorePair
};
