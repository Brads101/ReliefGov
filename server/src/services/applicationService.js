import { supabaseAdmin } from '../lib/supabase.js';
import { badRequest, forbidden, notFound, unavailable, HttpError } from '../lib/errors.js';
import { ROLES, IMPLEMENTATION_BARANGAY, IMPLEMENTATION_CITY, IMPLEMENTATION_PROVINCE } from './authService.js';
import { notify, notifyRole } from './notificationService.js';
import { scanForDuplicates } from './validationService.js';
import {
  SEXES, CIVIL_STATUSES, INCOME_LEVELS, HOUSE_STATUSES, INCIDENT_TYPES, DAMAGE_EXTENTS,
  name, optionalText, enumValue, dateValue, integer, amount, mobile, requiredText, collect
} from '../lib/validate.js';

/**
 * Beneficiary Profiling Module — application lifecycle (Batch 3).
 *
 * The browser NEVER writes beneficiary rows directly: every create / update /
 * submit / status transition runs through this service with the service-role
 * key, after ownership checks and server-side validation. The client-supplied
 * barangay field is never read — the capstone scope is fixed to Tambacan.
 *
 * Workflow (documented statuses):
 *
 *   Draft ──submit──▶ Pending ──staff──▶ Under Verification ──▶ Approved
 *     ▲                                    │  ▲  │
 *     └──edit + resubmit── Needs Correction┘  │  └──▶ Rejected
 *
 *   * Submission NEVER approves: only staff transitions reach Approved.
 *   * Approved / Rejected are CSWD-only (Batch 4 separation of duties);
 *     Barangay Staff start verification, return records for correction,
 *     and endorse them to CSWD. Every staff transition records an
 *     internal verification review (outcome + remarks).
 *   * Needs Correction / Rejected require a written reason.
 *   * Submission runs duplicate detection (Batch 4) and alerts barangay staff.
 *   * Submit is idempotent: retries and double clicks return the already
 *     submitted application instead of creating a second submission.
 */

export const STATUS = Object.freeze({
  DRAFT: 'Draft',
  PENDING: 'Pending',
  UNDER_VERIFICATION: 'Under Verification',
  NEEDS_CORRECTION: 'Needs Correction',
  APPROVED: 'Approved',
  REJECTED: 'Rejected'
});

export const EDITABLE_STATUSES = Object.freeze([STATUS.DRAFT, STATUS.NEEDS_CORRECTION]);
export const OPEN_STATUSES = Object.freeze([
  STATUS.DRAFT, STATUS.PENDING, STATUS.UNDER_VERIFICATION, STATUS.NEEDS_CORRECTION
]);

const STAFF_ROLES = [ROLES.BARANGAY_STAFF, ROLES.CSWD_STAFF];

/** Allowed staff transitions — anything else is refused with HTTP 409. */
const TRANSITIONS = Object.freeze({
  [STATUS.PENDING]: [STATUS.UNDER_VERIFICATION, STATUS.NEEDS_CORRECTION],
  [STATUS.UNDER_VERIFICATION]: [STATUS.NEEDS_CORRECTION, STATUS.APPROVED, STATUS.REJECTED]
});

const REASON_REQUIRED = new Set([STATUS.NEEDS_CORRECTION, STATUS.REJECTED]);

/**
 * Final decisions (Approved / Rejected) are CSWD-only (Batch 4):
 * Barangay Staff verify, return for correction, and endorse; the central
 * CSWD office gives the final validation outcome on every application.
 */
const CSWD_ONLY_STATUSES = new Set([STATUS.APPROVED, STATUS.REJECTED]);

const STATUS_NOTIFICATIONS = Object.freeze({
  [STATUS.PENDING]: {
    level: 'info',
    title: 'Application submitted',
    body: 'Your disaster assistance application has been submitted and is pending verification by the barangay office.'
  },
  [STATUS.UNDER_VERIFICATION]: {
    level: 'info',
    title: 'Application under verification',
    body: 'The barangay/CSWD office has started verifying your application. No action is needed from you right now.'
  },
  [STATUS.NEEDS_CORRECTION]: {
    level: 'warning',
    title: 'Changes needed on your application',
    body: (reason) =>
      `Your application needs a correction before it can continue. Please review it, make the changes, and submit it again. Reason: ${reason}`
  },
  [STATUS.APPROVED]: {
    level: 'success',
    title: 'Application approved',
    body: 'Your disaster assistance application has been verified and approved by the CSWD office.'
  },
  [STATUS.REJECTED]: {
    level: 'error',
    title: 'Application not approved',
    body: (reason) => `Your disaster assistance application was not approved. Reason: ${reason}`
  }
});

const APP_COLUMNS = [
  'id', 'beneficiary_number', 'user_id', 'household_id', 'household_no',
  'first_name', 'middle_name', 'last_name', 'sex', 'date_of_birth',
  'civil_status', 'mobile_number', 'purok', 'barangay', 'city_municipality', 'province',
  'household_size', 'monthly_family_income', 'income_level', 'house_status',
  'incident_type', 'incident_date', 'incident_description', 'damage_extent',
  'application_status', 'status_reason', 'submitted_at',
  'validation_status', 'vulnerability_score', 'vulnerability_class',
  'data_origin', 'created_at', 'updated_at'
].join(', ');

const HISTORY_COLUMNS =
  'id, beneficiary_id, from_status, to_status, reason, actor_role, created_at';

const DOCUMENT_COLUMNS =
  'id, beneficiary_id, uploaded_by, bucket, storage_path, file_name, mime_type, size_bytes, purpose, status, created_at';

/** Fields the applicant may never write — rejected loudly if sent. */
const READ_ONLY_FIELDS = new Set([
  'id', 'beneficiary_number', 'user_id', 'household_id', 'household_no',
  'barangay', 'city_municipality', 'province',
  'application_status', 'status_reason', 'submitted_at',
  'validation_status', 'vulnerability_score', 'vulnerability_class',
  'duplicate_of', 'data_origin', 'employment_status',
  'monthly_per_capita_income', 'is_senior', 'is_pregnant',
  'is_lone_parent', 'has_no_income', 'is_internally_displaced',
  'created_at', 'updated_at'
]);

const FIELD_RULES = {
  first_name: (val) => name(val, { label: 'First name' }),
  middle_name: (val) => optionalText(val, { label: 'Middle name', max: 80 }),
  last_name: (val) => name(val, { label: 'Last name' }),
  sex: (val) => enumValue(val, { label: 'Sex', allowed: SEXES }),
  date_of_birth: (val) => dateValue(val, { label: 'Date of birth' }),
  civil_status: (val) => enumValue(val, { label: 'Civil status', allowed: CIVIL_STATUSES }),
  mobile_number: (val) => mobile(val),
  is_pwd: (val) => {
    if (val === undefined || val === null || val === '') return null;
    if (typeof val === 'boolean' || ['Yes', 'No', 'true', 'false'].includes(String(val))) return null;
    return 'Disability status must be Yes or No.';
  },
  purok: (val) => requiredText(val, { label: 'Purok / zone', max: 100 }),
  household_size: (val) => integer(val, { label: 'Family size', min: 1, max: 50 }),
  income_level: (val) => (val ? enumValue(val, { label: 'Household income level', allowed: INCOME_LEVELS }) : null),
  monthly_family_income: (val) => amount(val, { label: 'Monthly family income', required: false }),
  house_status: (val) => enumValue(val, { label: 'House condition / status', allowed: HOUSE_STATUSES }),
  housing_type: (val) => optionalText(val, { label: 'Housing type / Flood exposure', max: 50 }),
  location_flood_exposure: (val) => {
    if (val === undefined || val === null || val === '') return null;
    if (['Yes', 'No', 'true', 'false'].includes(String(val))) return null;
    return 'Location flood hazard exposure must be Yes or No.';
  },
  incident_type: (val) => enumValue(val, { label: 'Disaster type', allowed: INCIDENT_TYPES }),
  incident_date: (val) => dateValue(val, { label: 'Date of incident' }),
  incident_description: (val) => requiredText(val, { label: 'Incident description', min: 10, max: 1000 }),
  damage_extent: (val) => enumValue(val, { label: 'Extent of property damage', allowed: DAMAGE_EXTENTS })
};

function admin() {
  if (!supabaseAdmin) {
    throw unavailable('The Beneficiary Profiling module requires Supabase configuration on the server.');
  }
  return supabaseAdmin;
}

function assertApplicant(body) {
  if (body && typeof body === 'object') {
    const bad = Object.keys(body).filter((key) => READ_ONLY_FIELDS.has(key));
    if (bad.length > 0) {
      const details = Object.fromEntries(
        bad.map((key) => [
          key,
          key === 'barangay'
            ? 'Barangay is fixed to Barangay Tambacan by the system and cannot be chosen in the form.'
            : 'This field is managed by the ReliefGov workflow and cannot be edited here.'
        ])
      );
      throw badRequest('Some fields cannot be changed from this form.', details);
    }
  }
}

function validateFields(body, { partial }) {
  const spec = partial
    ? Object.fromEntries(Object.entries(FIELD_RULES).filter(([field]) => Object.hasOwn(body || {}, field)))
    : FIELD_RULES;
  if (partial && Object.keys(spec).length === 0) {
    throw badRequest('There are no updateable fields in this request.');
  }
  const values = collect(spec, body);
  if ('household_size' in values) {
    values.household_size = values.household_size === null ? null : Number(values.household_size);
  }
  if ('monthly_family_income' in values) {
    values.monthly_family_income =
      values.monthly_family_income === null ? null : Number(values.monthly_family_income);
  }
  if ('is_pwd' in values && values.is_pwd !== null && values.is_pwd !== undefined) {
    values.is_pwd = values.is_pwd === true || values.is_pwd === 'true' || values.is_pwd === 'Yes';
  }
  const purokToCheck = values.purok || body?.purok;
  if (purokToCheck) {
    const isFlood = /purok\s*0?[1-4](?:[a-z\-]|$)/i.test(String(purokToCheck).trim());
    values.housing_type = isFlood ? 'Yes' : 'No';
  } else if ('location_flood_exposure' in values && values.location_flood_exposure !== null && values.location_flood_exposure !== undefined) {
    const isFlood = values.location_flood_exposure === true || values.location_flood_exposure === 'true' || values.location_flood_exposure === 'Yes';
    values.housing_type = isFlood ? 'Yes' : 'No';
  }
  delete values.location_flood_exposure;
  return values;
}

function isFloodPronePurok(purok) {
  if (!purok) return false;
  return /purok\s*0?[1-4](?:[a-z\-]|$)/i.test(String(purok).trim());
}

function decorateApplication(row) {
  if (!row) return null;
  const isFlood = row.purok ? isFloodPronePurok(row.purok) : (row.housing_type === 'Yes');
  return {
    ...row,
    location_flood_exposure: isFlood ? 'Yes' : 'No'
  };
}

function makeBeneficiaryNumber() {
  const now = new Date();
  const stamp = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TAM-${stamp}-${suffix}`;
}

/** Latest record for this account (the open one when it exists). */
export async function getOwnApplication(user) {
  const { data, error } = await admin()
    .from('beneficiaries')
    .select(APP_COLUMNS)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return decorateApplication(data);
}

async function getApplicationOrThrow(id) {
  const { data, error } = await admin()
    .from('beneficiaries')
    .select(APP_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw notFound('Application record not found.');
  return decorateApplication(data);
}

/** Full bundle for the "My Application" page. */
export async function getMineBundle(user) {
  const application = await getOwnApplication(user);
  if (!application) {
    return { application: null, documents: [], history: [], hasBarangayCertificate: false };
  }
  const [documents, history] = await Promise.all([
    admin()
      .from('documents')
      .select(DOCUMENT_COLUMNS)
      .eq('beneficiary_id', application.id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) throw new HttpError(500, error.message);
        return data;
      }),
    admin()
      .from('application_status_history')
      .select(HISTORY_COLUMNS)
      .eq('beneficiary_id', application.id)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) throw new HttpError(500, error.message);
        return data;
      })
  ]);
  return {
    application,
    documents,
    history,
    hasBarangayCertificate: documents.some((doc) => doc.purpose === 'Barangay certificate')
  };
}

async function recordTransition({ beneficiaryId, from, to, reason, actor }) {
  const { error } = await admin().from('application_status_history').insert({
    beneficiary_id: beneficiaryId,
    from_status: from,
    to_status: to,
    reason: reason || null,
    actor_id: actor?.id || null,
    actor_role: actor?.role || 'system'
  });
  if (error) console.warn('[ReliefGov] status history write failed:', error.message);
}

async function writeAudit(actorId, action, entityId, detail) {
  try {
    await admin().from('audit_logs').insert({
      actor_id: actorId,
      action,
      entity: 'beneficiaries',
      entity_id: entityId,
      detail
    });
  } catch (err) {
    console.warn('[ReliefGov] audit log write failed:', err.message);
  }
}

/**
 * Records the staff verification outcome + internal remarks for a status
 * change (Batch 4). Remarks stay inside the office (staff read-only);
 * the applicant-facing reason lives in status_reason / notifications.
 */
async function recordVerificationReview({ beneficiaryId, reviewer, outcome, remarks }) {
  const stage = reviewer.role === ROLES.BARANGAY_STAFF ? 'barangay_verification' : 'cswd_review';
  const { error } = await admin().from('verification_reviews').insert({
    beneficiary_id: beneficiaryId,
    reviewer_id: reviewer.id || null,
    reviewer_role: reviewer.role,
    stage,
    outcome,
    remarks: remarks || null
  });
  if (error) console.warn('[ReliefGov] verification review write failed:', error.message);
}

async function notifyApplicant(application, toStatus) {
  const note = STATUS_NOTIFICATIONS[toStatus];
  if (!note || !application.user_id) return;
  const body = typeof note.body === 'function' ? note.body(application.status_reason) : note.body;
  await notify(application.user_id, {
    title: note.title,
    body,
    level: note.level,
    category: toStatus === 'Needs Correction' ? 'validation' : 'application',
    link_path: '/application'
  });
}

/**
 * Synchronizes the beneficiary's household information to the public.households table.
 * Ensures the household profile is never empty and links documents & aid distributions.
 */
export async function syncHouseholdForBeneficiary(beneficiaryId) {
  if (!beneficiaryId) return;
  try {
    const { data: b } = await admin()
      .from('beneficiaries')
      .select('id, beneficiary_number, user_id, first_name, middle_name, last_name, purok, household_size, monthly_family_income, income_level, house_status, damage_extent, household_id, household_no')
      .eq('id', beneficiaryId)
      .maybeSingle();

    if (!b) return;

    const headName = [b.first_name, b.middle_name, b.last_name].filter(Boolean).join(' ') || 'Applicant';

    const { data: docs } = await admin()
      .from('documents')
      .select('purpose, status')
      .eq('beneficiary_id', b.id);
    const hasCert = (docs || []).some((d) => d.purpose === 'Barangay certificate' && d.status !== 'Rejected');

    let hhId = b.household_id;
    let hhNo = b.household_no;

    if (!hhId) {
      const cleanRef = (b.beneficiary_number || '').replace(/^TAM-/, '') || Math.random().toString(36).substring(2, 8).toUpperCase();
      const newHhNo = `TAM-HH-${cleanRef}`;
      const { data: hh, error: hhErr } = await admin()
        .from('households')
        .insert({
          household_no: newHhNo,
          family_head_name: headName,
          purok: b.purok,
          address_line: b.purok ? `${b.purok}, Tambacan, Iligan City` : 'Tambacan, Iligan City',
          family_size: b.household_size || 1,
          monthly_family_income: b.monthly_family_income,
          income_level: b.income_level,
          house_status: b.house_status,
          damage_extent: b.damage_extent,
          has_barangay_certificate: hasCert,
          barangay: 'Tambacan',
          city_municipality: 'Iligan City',
          province: 'Lanao del Norte',
          created_by: b.user_id || null
        })
        .select('id, household_no')
        .maybeSingle();

      if (!hhErr && hh?.id) {
        hhId = hh.id;
        hhNo = hh.household_no;
        await admin()
          .from('beneficiaries')
          .update({ household_id: hhId, household_no: hhNo })
          .eq('id', b.id);
      }
    } else {
      await admin()
        .from('households')
        .update({
          family_head_name: headName,
          purok: b.purok,
          address_line: b.purok ? `${b.purok}, Tambacan, Iligan City` : 'Tambacan, Iligan City',
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
      await admin().from('documents').update({ household_id: hhId }).eq('beneficiary_id', b.id).is('household_id', null);
      await admin().from('aid_distributions').update({ household_id: hhId }).eq('beneficiary_id', b.id).is('household_id', null);
    }
  } catch (err) {
    console.warn('[ReliefGov] household sync warning:', err.message);
  }
}

/* ------------------------------------------------------------------ */
/* Applicant actions                                                   */
/* ------------------------------------------------------------------ */

export async function createOwnApplication(user, body) {
  if (user.role !== ROLES.BENEFICIARY) {
    throw forbidden('Only beneficiary accounts can start a disaster assistance application.');
  }
  const existing = await getOwnApplication(user);
  if (existing && OPEN_STATUSES.includes(existing.application_status)) {
    throw new HttpError(409, 'You already have an active disaster assistance application.', {
      application_status: existing.application_status
    });
  }
  assertApplicant(body);
  // A DRAFT may be incomplete — saving between sections is the point — but
  // the record must at least identify the applicant (NOT NULL columns).
  // Full completeness is enforced again by submitOwnApplication before the
  // application ever reaches staff.
  const identityErrors = {};
  if (!String(body?.first_name || '').trim()) identityErrors.first_name = 'First name is required.';
  if (!String(body?.last_name || '').trim()) identityErrors.last_name = 'Last name is required.';
  if (Object.keys(identityErrors).length > 0) {
    throw badRequest('Please provide your first and last name to start an application.', identityErrors);
  }
  const values = validateFields(body, { partial: true });

  const { data, error } = await admin()
    .from('beneficiaries')
    .insert({
      beneficiary_number: makeBeneficiaryNumber(),
      user_id: user.id,
      ...values,
      barangay: IMPLEMENTATION_BARANGAY,
      city_municipality: IMPLEMENTATION_CITY,
      province: IMPLEMENTATION_PROVINCE,
      application_status: STATUS.DRAFT,
      data_origin: 'self-service'
    })
    .select(APP_COLUMNS)
    .single();

  if (error) {
    // 23505 = unique violation on the one-open-application index (race).
    if (error.code === '23505') {
      throw new HttpError(409, 'You already have an active disaster assistance application.');
    }
    throw new HttpError(500, `Could not create the application: ${error.message}`);
  }
  await syncHouseholdForBeneficiary(data.id);
  return decorateApplication(data);
}

export async function updateOwnApplication(user, body) {
  if (user.role !== ROLES.BENEFICIARY) {
    throw forbidden('Only beneficiary accounts can edit a disaster assistance application.');
  }
  const application = await getOwnApplication(user);
  if (!application) {
    throw notFound('You have not started a disaster assistance application yet.');
  }
  if (!EDITABLE_STATUSES.includes(application.application_status)) {
    throw new HttpError(
      409,
      `Your application is "${application.application_status}" and can no longer be edited unless the office requests a correction.`,
      { application_status: application.application_status }
    );
  }
  assertApplicant(body);
  const values = validateFields(body, { partial: true });

  const { data, error } = await admin()
    .from('beneficiaries')
    .update(values)
    .eq('id', application.id)
    .eq('user_id', user.id) // ownership is re-checked server-side
    .select(APP_COLUMNS)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw notFound('Application record not found.');
  await syncHouseholdForBeneficiary(data.id);
  return decorateApplication(data);
}

export async function submitOwnApplication(user) {
  if (user.role !== ROLES.BENEFICIARY) {
    throw forbidden('Only beneficiary accounts can submit a disaster assistance application.');
  }
  const application = await getOwnApplication(user);
  if (!application) {
    throw notFound('You have not started a disaster assistance application yet.');
  }

  // Idempotent: a repeated submit (double click, network retry) succeeds
  // without creating a second submission or duplicate history entry.
  if (!EDITABLE_STATUSES.includes(application.application_status)) {
    return { application, alreadySubmitted: true };
  }

  // Re-validate the stored row: it may pre-date a rule change or have been
  // written outside the API — nothing submitted reaches staff unvalidated.
  validateFields(application, { partial: false });

  const { data: documents, error: docError } = await admin()
    .from('documents')
    .select('id, purpose, status')
    .eq('beneficiary_id', application.id);
  if (docError) throw new HttpError(500, docError.message);

  const activeDocs = (documents || []).filter((doc) => doc.status !== 'Rejected');

  if (!activeDocs.some((doc) => doc.purpose === 'Barangay certificate')) {
    throw badRequest('A Barangay Certificate of Residency is required before submission.', {
      documents: 'Please upload your Barangay Certificate of Residency in the Documents section, then submit again.'
    });
  }

  const { data: updated, error } = await admin()
    .from('beneficiaries')
    .update({
      application_status: STATUS.PENDING,
      submitted_at: new Date().toISOString(),
      status_reason: null
    })
    .eq('id', application.id)
    .eq('user_id', user.id)
    .eq('application_status', application.application_status) // optimistic lock
    .select(APP_COLUMNS)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message);
  if (!updated) {
    // Another request submitted it first — report success, add no history.
    const current = await getOwnApplication(user);
    return { application: current, alreadySubmitted: true };
  }

  await recordTransition({
    beneficiaryId: application.id,
    from: application.application_status,
    to: STATUS.PENDING,
    reason: null,
    actor: user
  });
  await notifyApplicant({ ...updated, user_id: user.id }, STATUS.PENDING);

  // Batch 4: file duplicate flags against other Tambacan records before the
  // record reaches the staff queue. A failure here is logged, never blocks
  // the submission itself.
  try {
    await scanForDuplicates(updated);
  } catch (err) {
    console.warn('[ReliefGov] duplicate scan failed:', err.message);
  }

  // Batch 4: the barangay office is alerted to every new submission
  // (and to corrected resubmissions, which re-enter the queue as Pending).
  await notifyRole(ROLES.BARANGAY_STAFF, {
    title: 'New application submitted',
    body: `${updated.beneficiary_number} — ${updated.first_name} ${updated.last_name} (${updated.purok || 'purok n/a'}) has been submitted and is awaiting barangay verification.`,
    level: 'info',
    category: 'staff',
    link_path: '/validation'
  });

  await writeAudit(user.id, 'application.submit', application.id, {
    from: application.application_status,
    to: STATUS.PENDING
  });

  await syncHouseholdForBeneficiary(updated.id);

  return { application: updated, alreadySubmitted: false };
}

/* ------------------------------------------------------------------ */
/* Staff verification actions                                          */
/* ------------------------------------------------------------------ */

export async function transitionApplication(user, id, input) {
  if (!STAFF_ROLES.includes(user.role)) {
    throw forbidden('Only barangay and CSWD staff can change an application status.');
  }
  const toStatus = String(input?.to_status || '').trim();
  if (!Object.values(STATUS).includes(toStatus)) {
    throw badRequest('Unknown application status.', {
      to_status: `Must be one of: ${Object.values(STATUS).join(', ')}.`
    });
  }

  const application = await getApplicationOrThrow(id);
  const fromStatus = application.application_status;
  if (fromStatus === toStatus) {
    throw new HttpError(409, `The application is already "${toStatus}".`, { application_status: fromStatus });
  }
  const allowed = TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    throw new HttpError(
      409,
      `An application cannot move from "${fromStatus}" to "${toStatus}". Allowed next: ${allowed.join(', ') || 'none (terminal status)'}.`,
      { allowed }
    );
  }
  // Intake verification (Pending → Under Verification) is Barangay-only.
  if (fromStatus === STATUS.PENDING && toStatus === STATUS.UNDER_VERIFICATION && user.role !== ROLES.BARANGAY_STAFF) {
    throw forbidden(
      'Only Barangay Staff can perform intake verification and endorse applications for CSWD review.'
    );
  }

  // Separation of duties & Endorsement Gate (Batch 4 & Approach 1):
  // Only CSWD staff may approve or reject, and only AFTER Barangay Staff has verified the application.
  if (CSWD_ONLY_STATUSES.has(toStatus)) {
    if (user.role !== ROLES.CSWD_STAFF) {
      throw forbidden(
        'Only CSWD staff can approve or reject applications. Verify the record and endorse it for CSWD review instead.'
      );
    }

    const { data: reviews, error: revErr } = await admin()
      .from('verification_reviews')
      .select('id, reviewer_role, stage, outcome')
      .eq('beneficiary_id', application.id);
    if (revErr) throw new HttpError(500, revErr.message);

    const verifiedByBarangay = (reviews || []).some(
      (r) => r.reviewer_role === ROLES.BARANGAY_STAFF || r.stage === 'barangay_verification' || r.stage === 'barangay'
    );

    if (!verifiedByBarangay) {
      throw forbidden(
        'This application cannot be approved or rejected yet. It must first be verified and endorsed by Barangay Staff.'
      );
    }
  }

  const reason = String(input?.reason || '').trim();
  if (REASON_REQUIRED.has(toStatus) && reason.length < 5) {
    throw badRequest('A clear reason is required for this status change.', {
      reason: 'Explain the reason (at least 5 characters) so the applicant knows what to do.'
    });
  }
  if (reason.length > 500) {
    throw badRequest('The reason is too long.', { reason: 'Keep the reason under 500 characters.' });
  }
  const finalReason = REASON_REQUIRED.has(toStatus) ? reason : reason || null;

  // Internal office remarks for this outcome (Batch 4) — staff-only.
  const remarks = String(input?.remarks || '').trim();
  if (remarks.length > 500) {
    throw badRequest('The remarks are too long.', { remarks: 'Keep the remarks under 500 characters.' });
  }

  // Validation status follows the final CSWD decision (Batch 4). A record
  // already confirmed as a duplicate keeps its 'Duplicate' marking.
  const validationUpdate = {};
  if (toStatus === STATUS.APPROVED && application.validation_status !== 'Duplicate') {
    validationUpdate.validation_status = 'Verified';
  } else if (toStatus === STATUS.REJECTED && application.validation_status !== 'Duplicate') {
    validationUpdate.validation_status = 'Rejected';
  }

  const { data: updated, error } = await admin()
    .from('beneficiaries')
    .update({ application_status: toStatus, status_reason: finalReason, ...validationUpdate })
    .eq('id', application.id)
    .eq('application_status', fromStatus) // optimistic lock against races
    .select(APP_COLUMNS)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!updated) {
    throw new HttpError(409, 'The application status changed while you were acting on it. Please refresh.');
  }

  await recordTransition({
    beneficiaryId: application.id,
    from: fromStatus,
    to: toStatus,
    reason: finalReason,
    actor: user
  });
  await recordVerificationReview({
    beneficiaryId: application.id,
    reviewer: user,
    outcome: toStatus,
    remarks
  });
  await notifyApplicant({ ...updated, status_reason: finalReason }, toStatus);

  // Staff notifications (Batch 4): barangay endorsement reaches CSWD;
  // returned records reach the barangay office.
  const referenceLine = `${updated.beneficiary_number} — ${updated.first_name} ${updated.last_name}`;
  if (toStatus === STATUS.UNDER_VERIFICATION && user.role === ROLES.BARANGAY_STAFF) {
    await notifyRole(ROLES.CSWD_STAFF, {
      title: 'Endorsed for CSWD review',
      body: `${referenceLine} was verified by the barangay office and is ready for final CSWD validation.`,
      level: 'info',
      category: 'staff',
      link_path: '/validation'
    });
  }
  if (toStatus === STATUS.NEEDS_CORRECTION) {
    await notifyRole(ROLES.BARANGAY_STAFF, {
      title: 'Returned record',
      body: `${referenceLine} was returned to the applicant for correction. Reason: ${finalReason}`,
      level: 'warning',
      category: 'staff',
      link_path: '/validation'
    });
  }

  await writeAudit(user.id, 'application.transition', application.id, {
    from: fromStatus,
    to: toStatus,
    has_reason: Boolean(finalReason),
    has_remarks: Boolean(remarks)
  });

  return { application: updated };
}

export default {
  STATUS,
  EDITABLE_STATUSES,
  OPEN_STATUSES,
  getOwnApplication,
  getMineBundle,
  createOwnApplication,
  updateOwnApplication,
  submitOwnApplication,
  transitionApplication
};
