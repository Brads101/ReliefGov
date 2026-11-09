import { badRequest } from './errors.js';

/**
 * Small dependency-free field validators shared by the beneficiary
 * application endpoints. Every rule returns an error message string or
 * `null` when the value is acceptable, so callers can collect a complete
 * per-field error map before answering the client (all errors at once,
 * instead of failing on the first problem).
 *
 * Server-side validation is authoritative: the browser mirrors these rules
 * for friendly messages, but nothing is trusted from the client.
 */

export const SEXES = ['Female', 'Male', 'Prefer not to say'];
export const CIVIL_STATUSES = ['Single', 'Married', 'Widowed', 'Separated', 'Other'];
export const INCOME_LEVELS = ['No income', 'Low', 'Moderate', 'High'];
export const HOUSE_STATUSES = ['Owned', 'Rented', 'Shared', 'Informal settler', 'Other'];
export const INCIDENT_TYPES = ['Typhoon', 'Flood'];
export const DAMAGE_EXTENTS = ['None', 'Minor', 'Major', 'Total'];

// Letters (any script), spaces and basic name punctuation only.
const NAME_RE = /^[\p{L} .,'-]+$/u;
const MOBILE_RE = /^09\d{9}$/;

function raw(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

export function requiredText(value, { label, min = 1, max = 200 } = {}) {
  const v = raw(value);
  if (!v) return `${label} is required.`;
  if (v.length < min) return `${label} must be at least ${min} characters.`;
  if (v.length > max) return `${label} must be at most ${max} characters.`;
  return null;
}

export function optionalText(value, { label, max = 200 } = {}) {
  const v = raw(value);
  if (!v) return null;
  if (v.length > max) return `${label} must be at most ${max} characters.`;
  return null;
}

export function name(value, { label, required = true } = {}) {
  const v = raw(value);
  if (!v) return required ? `${label} is required.` : null;
  if (v.length < 2) return `${label} must be at least 2 characters.`;
  if (v.length > 80) return `${label} must be at most 80 characters.`;
  if (!NAME_RE.test(v)) return `${label} may only contain letters, spaces, and . , ' -`;
  return null;
}

export function enumValue(value, { label, allowed } = {}) {
  const v = raw(value);
  if (!v) return `${label} is required.`;
  if (!allowed.includes(v)) return `${label} must be one of: ${allowed.join(', ')}.`;
  return null;
}

function parseDate(value) {
  const v = raw(value);
  if (!v) return null;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
}

export function dateValue(value, { label, required = true, notFuture = true } = {}) {
  const v = raw(value);
  if (!v) return required ? `${label} is required.` : null;
  const d = parseDate(v);
  if (d === 'invalid') return `${label} must be a valid date (YYYY-MM-DD).`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${label} must use the YYYY-MM-DD format.`;
  if (notFuture && d.getTime() > Date.now()) return `${label} cannot be in the future.`;
  if (d.getFullYear() < 1900) return `${label} is not a plausible date.`;
  return null;
}

export function integer(value, { label, min, max, required = true } = {}) {
  if (value === undefined || value === null || raw(value) === '') {
    return required ? `${label} is required.` : null;
  }
  const n = Number(value);
  if (!Number.isInteger(n)) return `${label} must be a whole number.`;
  if (n < min || n > max) return `${label} must be between ${min} and ${max}.`;
  return null;
}

export function amount(value, { label, min = 0, max = 10000000, required = true } = {}) {
  if (value === undefined || value === null || raw(value) === '') {
    return required ? `${label} is required.` : null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return `${label} must be a number.`;
  if (n < min) return `${label} cannot be negative.`;
  if (n > max) return `${label} is unreasonably large.`;
  return null;
}

export function mobile(value, { label = 'Mobile number', required = false } = {}) {
  const v = raw(value);
  if (!v) return required ? `${label} is required.` : null;
  if (!MOBILE_RE.test(v)) return `${label} must be a Philippine mobile number like 09171234567.`;
  return null;
}

/** Runs a map of field -> error producer, returning { values, errors }. */
export function collect(spec, body) {
  const errors = {};
  const values = {};
  for (const [field, produce] of Object.entries(spec)) {
    const message = produce(body?.[field], body);
    if (message) {
      errors[field] = message;
    } else if (body?.[field] !== undefined && body[field] !== null) {
      const v = raw(body[field]);
      values[field] = v === '' ? null : v;
    }
  }
  if (Object.keys(errors).length > 0) {
    throw badRequest('Please correct the highlighted fields.', errors);
  }
  return values;
}

export default {
  requiredText,
  optionalText,
  name,
  enumValue,
  dateValue,
  integer,
  amount,
  mobile,
  collect
};
