/**
 * Shared labels and option lists for the Beneficiary Profiling module.
 * Mirrors the server-side rules in server/src/lib/validate.js and
 * applicationService.js — the server remains authoritative; these exist to
 * give applicants friendly, immediate feedback on mobile and desktop.
 *
 * KEEP IN SYNC with the server when a rule changes.
 */

export const STATUS_META = {
  Draft: { label: 'Draft', tone: 'neutral', hint: 'Saved but not yet submitted. You can keep editing it.' },
  Pending: { label: 'Pending', tone: 'warning', hint: 'Submitted and waiting for the barangay office to start verification.' },
  'Under Verification': { label: 'Under Verification', tone: 'info', hint: 'The barangay/CSWD office is verifying your application. Please wait.' },
  'Needs Correction': { label: 'Needs Correction', tone: 'warning', hint: 'The office asked for a change. Review the reason, edit your application, and submit it again.' },
  Approved: { label: 'Approved', tone: 'success', hint: 'Your application has been verified and approved.' },
  Rejected: { label: 'Rejected', tone: 'danger', hint: 'Your application was not approved. See the reason below.' }
};

export const STATUS_TONE = Object.fromEntries(
  Object.entries(STATUS_META).map(([key, meta]) => [key, meta.tone])
);

export const EDITABLE_STATUSES = ['Draft', 'Needs Correction'];

export const SEX_OPTIONS = ['Female', 'Male', 'Prefer not to say'];
export const CIVIL_STATUS_OPTIONS = ['Single', 'Married', 'Widowed', 'Separated', 'Other'];
export const YES_NO_OPTIONS = ['No', 'Yes'];
/**
 * Beneficiary-facing income categories — ranged bands requested by the CSWD
 * Office. The stored value keeps the legacy vocabulary ('Low' | 'Moderate' |
 * 'High' — DB check constraint, migrations 0002/0003) so the vulnerability
 * scoring model's ordinal encoding is unaffected. Screens display the
 * category label via incomeLevelLabel(); 'No income' survives as a legacy
 * value for records created before the categories existed.
 */
export const INCOME_CATEGORY_OPTIONS = [
  { value: 'Low', label: 'Income Category A — ₱5,000–₱10,000' },
  { value: 'Moderate', label: 'Income Category B — ₱10,000–₱20,000' },
  { value: 'High', label: 'Income Category C — ₱20,000–₱50,000' }
];

const INCOME_LEVEL_LABELS = {
  'No income': 'No income',
  Low: 'Income Category A — ₱5,000–₱10,000',
  Moderate: 'Income Category B — ₱10,000–₱20,000',
  High: 'Income Category C — ₱20,000–₱50,000'
};

/** Stored income value -> display label (legacy values included). */
export function incomeLevelLabel(value) {
  return INCOME_LEVEL_LABELS[value] || value || '—';
}
/**
 * House condition / status — the three situations the barangay form now
 * offers. 'Informal settler' and 'Other' were removed from the list at the
 * barangay's request; they are NOT deleted from any record.
 *
 * The stored vocabulary is unchanged ('Owned' | 'Rented' | 'Shared' |
 * 'Informal settler' | 'Other' — DB check constraint, migrations 0002/0003)
 * because the scoring model maps it (Owned→OWNER, Rented→RENTER,
 * Shared→SHARER, Informal settler→RENTER, Other→SHARER — see
 * ml-service/app.py) and two records already hold 'Informal settler'.
 * Read-only views print the stored value as-is, and the form keeps a
 * record's own legacy value visible via houseStatusOptions() so editing one
 * can never blank it out or silently overwrite it.
 */
export const HOUSE_STATUS_OPTIONS = ['Owned', 'Rented', 'Shared'];

/** Dropdown options; a legacy value already on the record is preserved. */
export function houseStatusOptions(current) {
  if (current && !HOUSE_STATUS_OPTIONS.includes(current)) {
    return [...HOUSE_STATUS_OPTIONS, current];
  }
  return HOUSE_STATUS_OPTIONS;
}
export const INCIDENT_TYPE_OPTIONS = ['Typhoon', 'Flood'];
export function incidentTypeOptions(current) {
  if (current && !INCIDENT_TYPE_OPTIONS.includes(current)) {
    return [...INCIDENT_TYPE_OPTIONS, current];
  }
  return INCIDENT_TYPE_OPTIONS;
}
/**
 * Extent of property damage — labelled with the exact categories the
 * vulnerability model was trained on (see server/src/ml/README.md and
 * DAMAGE_TO_DATASET in ml-service/app.py):
 *
 *     None -> FLOODED · Minor -> PARTIALLY · Major -> HEAVILY FLOODED · Total -> TOTALLY
 *
 * The stored value keeps the legacy vocabulary ('None' | 'Minor' | 'Major' |
 * 'Total' — DB check constraint, migrations 0002/0003) so the model's
 * ordinal encoding (None=0 … Total=3) and every existing row are unaffected.
 * Only the words on screen change; screens read them through
 * damageExtentLabel(), so dropdowns, profile views and reports agree.
 */
export const DAMAGE_EXTENT_OPTIONS = [
  { value: 'None', label: 'FLOODED' },
  { value: 'Minor', label: 'PARTIALLY' },
  { value: 'Major', label: 'HEAVILY FLOODED' },
  { value: 'Total', label: 'TOTALLY' }
];

const DAMAGE_EXTENT_LABELS = {
  None: 'FLOODED',
  Minor: 'PARTIALLY',
  Major: 'HEAVILY FLOODED',
  Total: 'TOTALLY'
};

/** Stored damage extent -> display label (legacy values included). */
export function damageExtentLabel(value) {
  return DAMAGE_EXTENT_LABELS[value] || value || '—';
}

/**
 * Placeholder purok list for Barangay Tambacan — replace with the official
 * barangay purok/sitio list when confirmed with the LGU (documented
 * assumption in docs/IMPLEMENTATION-PLAN.md). "Other" allows free text so
 * no resident is ever unable to answer the field.
 */
export const PUROK_OPTIONS = [
  'Purok 1', 'Purok 2', 'Purok 3', 'Purok 4',
  'Purok 5', 'Purok 6', 'Purok 7', 'Purok 8',
  'Other (specify)'
];

/**
 * Maps Purok to Location Flood Hazard Exposure:
 * Puroks 1–4 are designated high-risk coastal and riverbank zones in Barangay Tambacan.
 * Puroks 5–8 and inland zones are designated low-risk / safe areas.
 */
export function isFloodPronePurok(purok) {
  if (!purok) return false;
  const p = String(purok).trim().toLowerCase();
  return /purok\s*0?[1-4](?:[a-z\-]|$)/i.test(p);
}

export const DOCUMENT_PURPOSES = [
  'Barangay certificate',
  'Valid ID',
  'Proof of residence',
  'Damage photos',
  'Medical record',
  'Other'
];

export const DOCUMENT_PURPOSE_LABELS = {
  'Barangay certificate': 'Barangay Certificate of Residency',
  'Damage photos': 'Photo of the damaged house',
  'Valid ID': 'National ID',
  'Proof of residence': 'Proof of residence',
  'Medical record': 'Medical record',
  'Other': 'Other'
};

export function documentPurposeLabel(purpose) {
  return DOCUMENT_PURPOSE_LABELS[purpose] || purpose || 'Document';
}

export const DOCUMENT_PURPOSE_OPTIONS = DOCUMENT_PURPOSES.map((purpose) => ({
  value: purpose,
  label: DOCUMENT_PURPOSE_LABELS[purpose] || purpose
}));

/**
 * Guided attachment checklist shown in the form's Documents section.
 * Mirrors server rules: Barangay Certificate of Residency is required for all;
 * Damage photo is required whenever property damage is claimed (Minor, Major, Total).
 * `purpose` values must stay inside DOCUMENT_PURPOSES (DB check constraint,
 * migration 0002).
 */
export const DOCUMENT_CHECKLIST = [
  {
    purpose: 'Barangay certificate',
    title: 'Barangay Certificate of Residency',
    required: true,
    why: 'Required before you can submit — the barangay office uses it to certify your residency in Barangay Tambacan and disaster calamity status.'
  },
  {
    purpose: 'Damage photos',
    title: 'Photo of the damaged house',
    required: false, // dynamically set to true when damage_extent is Minor, Major, or Total
    why: 'Required when property damage is claimed (Partially, Heavily Flooded, or Totally) — provides photographic evidence of the damage to ensure objective validation.'
  },
  {
    purpose: 'Valid ID',
    title: 'National ID',
    required: false,
    why: 'Recommended — helps the office confirm your identity during validation. Identity documents are deliberately never used in vulnerability scoring.'
  }
];

/* ------------------------------------------------------------------ *
 * Data Validation & Duplicate Detection (Batch 4).
 * Mirrors server-side vocabulary (validationService.js / migration 0004).
 * ------------------------------------------------------------------ */

/** beneficiaries.validation_status badges (staff registry + review views). */
export const VALIDATION_STATUS_META = {
  Pending: { label: 'Pending', tone: 'warning' },
  Verified: { label: 'Verified', tone: 'success' },
  Flagged: { label: 'Flagged', tone: 'danger' },
  Duplicate: { label: 'Duplicate', tone: 'danger' },
  Rejected: { label: 'Rejected', tone: 'danger' }
};

/** Duplicate-flag confidence — a name match alone only ever reaches "Low". */
export const CONFIDENCE_META = {
  low: { label: 'Low confidence', tone: 'neutral', hint: 'Name similarity only — weakest evidence.' },
  medium: { label: 'Medium confidence', tone: 'warning', hint: 'Name plus a matching detail.' },
  high: { label: 'High confidence', tone: 'danger', hint: 'Name matches a strong identifier.' }
};

/** Flag decision vocabulary (server: confirm | dismiss | request_info). */
export const FLAG_DECISIONS = [
  { value: 'confirm', label: 'Confirm duplicate', description: 'Links the two records for the file. Nothing is deleted and the application keeps its current status.' },
  { value: 'dismiss', label: 'Dismiss flag', description: 'The records are different people; stop flagging this pair.' },
  { value: 'request_info', label: 'Request further information', description: 'Keep the flag open and ask the applicant for more information.' }
];

/** mirrors reports.report_type check (migration 0006 / reportService.js). */
export const REPORT_TYPES = [
  'Beneficiary registry',
  'Validation summary',
  'Duplicate review',
  'Vulnerability summary',
  'Aid distribution',
  'Activity log',
  'Period summary'
];

/** Staff document review outcomes (server validates these too). */
export const DOCUMENT_STATUSES = ['Accepted', 'Rejected'];

export const REQUIRED_DOCUMENT_PURPOSE = 'Barangay certificate';

/* ------------------------------------------------------------------ *
 * Monitoring & Reporting + Aid Distribution + Notifications (Batch 6).
 * Mirrors server-side vocabulary (reportService.js, distributionService.js,
 * notificationService.js). The server stays authoritative.
 * ------------------------------------------------------------------ */

/**
 * Aid distribution workflow states. Planned -> Released or Cancelled;
 * Released and Cancelled are terminal (enforced server-side).
 */
export const DISTRIBUTION_STATUS_META = {
  Planned: { label: 'Planned', tone: 'info', hint: 'Recorded but not yet released to the beneficiary.' },
  Released: { label: 'Released', tone: 'success', hint: 'Assistance was handed over and attributed to staff.' },
  Cancelled: { label: 'Cancelled', tone: 'neutral', hint: 'Entry cancelled with a documented reason.' }
};

export const DISTRIBUTION_STATUSES = ['Planned', 'Released', 'Cancelled'];

/** The single in-scope value of the aid_distributions.assistance_type check
 *  (migration 0002). The capstone distributes relief goods only — no cash or
 *  other types are offered — while legacy rows carrying earlier values remain
 *  valid server-side. */
export const ASSISTANCE_TYPES = ['Relief goods'];

/** mirrors notifications.category check (migration 0006). */
export const NOTIFICATION_CATEGORY_LABELS = {
  application: 'Application',
  validation: 'Validation',
  scoring: 'Scoring',
  distribution: 'Distribution',
  staff: 'Staff',
  system: 'System'
};

export const NOTIFICATION_CATEGORIES = Object.keys(NOTIFICATION_CATEGORY_LABELS);

/* ------------------------------------------------------------------ *
 * Random Forest Vulnerability Scoring (Batch 5).
 * Mirrors server-side vocabulary (scoringService.js / ml/config.js).
 * ------------------------------------------------------------------ */

/**
 * Priority categories the model predicts, least → most vulnerable.
 * Tones are display-only; the category itself is the model's own output.
 *
 * Wording is the model's own vocabulary: Low / Medium / High. The stored
 * value for the middle class is 'Moderate' (DB check constraint, migration
 * 0001, and the model's dataset labels), so only the label changes.
 *
 * Legacy four-class rows: the previous model also emitted 'Severe'. It is
 * never predicted, offered or counted as its own category any more — every
 * screen folds it into 'High' via vulnerabilityClassOf() so the system shows
 * exactly three categories while the stored history stays untouched.
 */
export const VULNERABILITY_CLASS_META = {
  Low: { label: 'Low priority', tone: 'success' },
  Moderate: { label: 'Medium priority', tone: 'info' },
  High: { label: 'High priority', tone: 'warning' }
};

export const VULNERABILITY_CLASSES = ['Low', 'Moderate', 'High'];

/** Stored class → the three categories the system reports today. */
export function vulnerabilityClassOf(value) {
  return value === 'Severe' ? 'High' : value;
}

/** Label/tone for a stored class; legacy 'Severe' renders as High. */
export function vulnerabilityClassMeta(value) {
  return VULNERABILITY_CLASS_META[vulnerabilityClassOf(value)] || null;
}

/** Display label for a stored class (falls back to the raw value). */
export function vulnerabilityClassLabel(value) {
  if (!value) return '—';
  const meta = vulnerabilityClassMeta(value);
  return meta ? meta.label : value;
}

/**
 * Reference bands for the 0-100 priority score, per category.
 *
 * These are NOT classification cut-offs. The category is the class with the
 * highest probability; the score is the documented conversion
 * 100 * (0.5 * P(Medium) + P(High)), so a category's score bands overlap by
 * construction — e.g. a Medium verdict with 56% Medium / 44% High votes
 * scores 72. They are shown to staff as a reading aid only.
 */
export const PRIORITY_SCORE_BANDS = {
  Low: [0, 50],
  Moderate: [25, 75],
  High: [50, 100]
};

/** "0 – 50" for a stored class, folding legacy 'Severe' into High. */
export function priorityScoreBand(value) {
  const band = PRIORITY_SCORE_BANDS[vulnerabilityClassOf(value)];
  return band ? `${band[0]} – ${band[1]}` : '—';
}

/**
 * Non-zero baseline reference score for Low priority (12.50).
 * Matches MANUAL_CATEGORY_INDEX.Low (the documented midpoint of the lower quartile).
 * Provided so staff have an informative reference number rather than an uninformative 0.00.
 */
export const LOW_PRIORITY_BASELINE_SCORE = 12.5;

/**
 * Returns the numeric priority score (0–100) for display.
 */
export function displayPriorityScore(score, klass) {
  if (score === null || score === undefined) return null;
  const num = Number(score);
  if (isNaN(num)) return null;
  return num;
}

/**
 * Merges an API `by_class` breakdown onto the three categories, folding any
 * legacy 'Severe' count into High so a chart's bars always add up to the
 * number of scored records stated beside them.
 */
export function normalizeClassCounts(counts = {}) {
  const out = { Low: 0, Moderate: 0, High: 0 };
  for (const [key, value] of Object.entries(counts || {})) {
    const cls = vulnerabilityClassOf(key);
    if (Object.prototype.hasOwnProperty.call(out, cls)) out[cls] += Number(value) || 0;
  }
  return out;
}

/** Row states in the scoring list (server: scoringService.stateOf). */
export const SCORE_STATE_META = {
  missing: { label: 'Not scored', tone: 'neutral', hint: '' },
  scored: { label: 'Scored', tone: 'success', hint: 'Current score matches the assessment data on file.' },
  stale: { label: 'Stale', tone: 'warning', hint: 'Assessment data or the model version changed after scoring — re-run recommended.' },
  flagged: { label: 'Flagged', tone: 'danger', hint: 'A reviewer marked this score as questionable.' }
};

export const SCORE_STATES = ['missing', 'scored', 'stale', 'flagged'];

/**
 * Honest disclosure labels — every score carries the provenance of the model
 * that produced it: 'historical' for scores from the model trained on the
 * collected household dataset, 'synthetic' for scores stored before that
 * model swap (kept for audit, never relabelled). These strings must never be
 * softened.
 */
export const DATASET_BADGE = {
  synthetic: {
    label: 'Synthetic-trained model',
    tone: 'warning',
    hint: 'Produced by the earlier model, which was trained on a synthetic development dataset rather than real household records. Re-run recommended now that a model trained on collected records is live.'
  },
  historical: {
    label: 'Historical model',
    tone: 'success',
    hint: ''
  },
  manual: {
    label: 'Manual correction',
    tone: 'info',
    hint: 'Set by an authorized CSWD reviewer, not by the model.'
  }
};

export const FORM_STEPS = [
  { key: 'personal', label: 'Personal information', description: '' },
  { key: 'household', label: 'Household', description: '' },
  { key: 'incident', label: 'Disaster incident', description: '' },
  { key: 'documents', label: 'Supporting documents', description: '' },
  { key: 'review', label: 'Review & submit', description: '' }
];

/** Client-side field rules — mirror of server/src/lib/validate.js. */
const NAME_RE = /^[\p{L} .,'-]+$/u;
const MOBILE_RE = /^09\d{9}$/;

const text = (value) => String(value ?? '').trim();

export function validateStep(stepKey, form) {
  const errors = {};
  const set = (field, message) => { errors[field] = message; };

  if (stepKey === 'personal') {
    if (!text(form.first_name)) set('first_name', 'First name is required.');
    else if (text(form.first_name).length < 2 || !NAME_RE.test(text(form.first_name))) {
      set('first_name', 'Enter a valid first name (letters only).');
    }
    if (!text(form.last_name)) set('last_name', 'Last name is required.');
    else if (text(form.last_name).length < 2 || !NAME_RE.test(text(form.last_name))) {
      set('last_name', 'Enter a valid last name (letters only).');
    }
    if (!text(form.sex)) set('sex', 'Please select an option.');
    if (!text(form.date_of_birth)) set('date_of_birth', 'Date of birth is required.');
    else if (new Date(form.date_of_birth) > new Date()) set('date_of_birth', 'Date of birth cannot be in the future.');
    if (!text(form.civil_status)) set('civil_status', 'Please select an option.');
    if (!text(form.is_pwd)) set('is_pwd', 'Please select whether you or any member has a disability (PWD).');
    if (text(form.mobile_number) && !MOBILE_RE.test(text(form.mobile_number))) {
      set('mobile_number', 'Use a Philippine mobile number like 09171234567.');
    }
  }

  if (stepKey === 'household') {
    if (!text(form.purok)) set('purok', 'Purok / zone of residence is required.');
    if (form.purok === 'Other (specify)' && !text(form.purok_other)) {
      set('purok_other', 'Please write your purok or zone.');
    }
    const size = Number(form.household_size);
    if (!text(form.household_size)) set('household_size', 'Family size is required.');
    else if (!Number.isInteger(size) || size < 1 || size > 50) {
      set('household_size', 'Family size must be a whole number between 1 and 50.');
    }
    if (!text(form.house_status)) set('house_status', 'Please select the house condition.');
  }

  if (stepKey === 'incident') {
    if (!text(form.incident_type)) set('incident_type', 'Please select the type of disaster.');
    if (!text(form.incident_date)) set('incident_date', 'Date of the incident is required.');
    else if (new Date(form.incident_date) > new Date()) set('incident_date', 'The incident date cannot be in the future.');
    const description = text(form.incident_description);
    if (!description) set('incident_description', 'Please describe what happened.');
    else if (description.length < 10) set('incident_description', 'Please write at least 10 characters.');
    if (!text(form.damage_extent)) set('damage_extent', 'Please select the extent of property damage.');
  }

  return errors;
}

/**
 * The payload the API accepts (server whitelist).
 * @param {object} form
 * @param {{skipEmpty?: boolean}} [options] skipEmpty=true omits blank fields
 *   so a partially-filled Draft can be saved; submit uses skipEmpty=false so
 *   the server's full required-field validation runs on the complete form.
 */
export function toApiPayload(form, { skipEmpty = true } = {}) {
  const payload = {};
  const put = (key, value) => {
    if (skipEmpty && (value === '' || value === null || value === undefined)) return;
    payload[key] = value;
  };

  put('first_name', text(form.first_name));
  put('last_name', text(form.last_name));
  put('sex', text(form.sex));
  put('date_of_birth', text(form.date_of_birth));
  put('civil_status', text(form.civil_status));
  if (form.is_pwd !== '' && form.is_pwd !== null && form.is_pwd !== undefined) {
    put('is_pwd', form.is_pwd === 'Yes' || form.is_pwd === true);
  }
  const effectivePurok = form.purok === 'Other (specify)' ? text(form.purok_other) : text(form.purok);
  put('purok', effectivePurok);
  const size = Number(form.household_size);
  if (form.household_size !== '' && form.household_size !== null && form.household_size !== undefined && Number.isFinite(size)) {
    put('household_size', size);
  }
  put('income_level', text(form.income_level));
  put('house_status', text(form.house_status));
  put('location_flood_exposure', isFloodPronePurok(effectivePurok) ? 'Yes' : 'No');
  put('incident_type', text(form.incident_type));
  put('incident_date', text(form.incident_date));
  put('incident_description', text(form.incident_description));
  put('damage_extent', text(form.damage_extent));
  put('middle_name', text(form.middle_name));
  put('mobile_number', text(form.mobile_number));
  return payload;
}

/** Server application row -> flat form state. */
export function fromApiApplication(application) {
  if (!application) return null;
  const knownPurok = PUROK_OPTIONS.includes(application.purok);
  return {
    first_name: application.first_name || '',
    middle_name: application.middle_name || '',
    last_name: application.last_name || '',
    sex: application.sex || '',
    date_of_birth: application.date_of_birth || '',
    civil_status: application.civil_status || '',
    mobile_number: application.mobile_number || '',
    is_pwd: application.is_pwd ? 'Yes' : 'No',
    purok: knownPurok ? application.purok : application.purok ? 'Other (specify)' : '',
    purok_other: knownPurok ? '' : application.purok || '',
    household_size: application.household_size ?? '',
    income_level: application.income_level || '',
    house_status: application.house_status || '',
    location_flood_exposure: isFloodPronePurok(application.purok) ? 'Yes' : 'No',
    incident_type: application.incident_type || '',
    incident_date: application.incident_date || '',
    incident_description: application.incident_description || '',
    damage_extent: application.damage_extent || ''
  };
}

export const EMPTY_FORM = {
  first_name: '', middle_name: '', last_name: '', sex: '', date_of_birth: '',
  civil_status: '', mobile_number: '', is_pwd: 'No', purok: '', purok_other: '',
  household_size: '', income_level: '', house_status: '',
  incident_type: '', incident_date: '', incident_description: '', damage_extent: '',
  location_flood_exposure: 'No'
};
