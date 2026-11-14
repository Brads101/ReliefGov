import crypto from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase.js';
import { badRequest, forbidden, notFound, HttpError } from '../lib/errors.js';
import { ROLES } from './authService.js';
import { notify } from './notificationService.js';

/**
 * Supporting-document storage (private Supabase Storage bucket).
 *
 * Every upload/download goes through the server so that file type, size and
 * ownership are enforced in one place; the browser never talks to Storage
 * directly and the service-role key never leaves the server. Files live in
 * the private `beneficiary-documents` bucket under `<user-id>/<uuid>-<name>`;
 * downloads are short-lived signed URLs created after an ownership check.
 */

export const BUCKET = 'beneficiary-documents';
export const MAX_BYTES = 5 * 1024 * 1024; // 5 MB (matches the bucket limit)

const ALLOWED = Object.freeze({
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png'
});

/**
 * Allowed `documents.purpose` values — mirrors the DB check constraint
 * (migration 0002) AND the applicant-facing list (client constants.js).
 * Validated here so a bad purpose is a clean 400 instead of a constraint
 * violation surfacing as a 500 from the insert.
 */
export const DOCUMENT_PURPOSES = Object.freeze([
  'Barangay certificate',
  'Valid ID',
  'Proof of residence',
  'Damage photos',
  'Medical record',
  'Other'
]);

const DOCUMENT_COLUMNS =
  'id, beneficiary_id, household_id, uploaded_by, bucket, storage_path, file_name, mime_type, size_bytes, purpose, status, created_at';

function decodeDataUrl(file) {
  if (!file || typeof file !== 'object' || typeof file.data !== 'string') {
    throw badRequest('File content is required as a base64 data URL in `file.data`.');
  }
  const match = /^data:([^;]+);base64,(.+)$/.exec(file.data);
  if (!match) throw badRequest('File must be a base64 data URL (data:<mime>;base64,…).');
  const [, mime, b64] = match;
  if (!Object.hasOwn(ALLOWED, mime)) {
    throw badRequest('Unsupported file type. Allowed: PDF, JPEG, PNG.');
  }
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length === 0) throw badRequest('The uploaded file is empty.');
  if (buffer.length > MAX_BYTES) {
    throw badRequest(`File is too large. The maximum size is ${Math.floor(MAX_BYTES / 1024 / 1024)} MB.`);
  }
  // Magic-byte sniffing: the declared mime type must match the actual bytes.
  const isPdf = buffer.subarray(0, 4).toString('latin1') === '%PDF';
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const matches =
    (mime === 'application/pdf' && isPdf) ||
    (mime === 'image/jpeg' && isJpeg) ||
    (mime === 'image/png' && isPng);
  if (!matches) throw badRequest('The file content does not match its declared type.');

  return { mime, buffer, extension: ALLOWED[mime] };
}

function safeFileName(name) {
  const base = String(name || 'document').split(/[\\/]/).pop().trim();
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100) || 'document';
}

/** A beneficiary may only attach documents to their own profile record. */
async function resolveBeneficiary(user, beneficiaryId) {
  if (!beneficiaryId) return null;
  const { data, error } = await supabaseAdmin
    .from('beneficiaries')
    .select('id, user_id, barangay')
    .eq('id', beneficiaryId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw notFound('Beneficiary record not found.');
  if (user.role === ROLES.BENEFICIARY && data.user_id !== user.id) {
    throw forbidden('You can only attach documents to your own beneficiary record.');
  }
  return data;
}

export async function uploadDocument(user, { file, beneficiary_id, purpose }) {
  if (!user) throw forbidden();
  const { mime, buffer, extension } = decodeDataUrl(file);

  // Purpose is checked BEFORE anything is written: an unknown purpose would
  // otherwise violate the documents_purpose_check constraint and surface as
  // an unhelpful 500 after the file had already been stored.
  let normalizedPurpose = String(purpose ?? 'Other').trim() || 'Other';
  if (/^national\s*id$/i.test(normalizedPurpose)) {
    normalizedPurpose = 'Valid ID';
  }
  if (!DOCUMENT_PURPOSES.includes(normalizedPurpose)) {
    throw badRequest('Unknown document purpose.', {
      purpose: `Must be one of: ${DOCUMENT_PURPOSES.join(', ')}.`
    });
  }

  const beneficiary = await resolveBeneficiary(user, beneficiary_id);

  const storagePath = `${user.id}/${crypto.randomUUID()}-${safeFileName(file.name)}${extension}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: mime, upsert: false, cacheControl: '3600' });
  if (uploadError) throw new HttpError(500, `Upload failed: ${uploadError.message}`);

  const { data, error } = await supabaseAdmin
    .from('documents')
    .insert({
      beneficiary_id: beneficiary?.id ?? null,
      uploaded_by: user.id,
      bucket: BUCKET,
      storage_path: storagePath,
      file_name: safeFileName(file.name),
      mime_type: mime,
      size_bytes: buffer.length,
      purpose: normalizedPurpose
    })
    .select(DOCUMENT_COLUMNS)
    .single();
  if (error) {
    await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);
    // Defense in depth: if a purpose slipped past the check above (e.g. the
    // DB list changed), report it as the client-fixable 400 it is.
    if (/documents_purpose_check/.test(error.message || '')) {
      throw badRequest('Unknown document purpose.', {
        purpose: `Must be one of: ${DOCUMENT_PURPOSES.join(', ')}.`
      });
    }
    throw new HttpError(500, `Document record failed: ${error.message}`);
  }
  return data;
}

/** Lists documents the user is allowed to see (own uploads, or all for staff). */
export async function listDocuments(user, { beneficiary_id } = {}) {
  let query = supabaseAdmin.from('documents').select(DOCUMENT_COLUMNS).order('created_at', { ascending: false });
  if (user.role === ROLES.BENEFICIARY) {
    query = query.eq('uploaded_by', user.id);
  }
  if (beneficiary_id) query = query.eq('beneficiary_id', beneficiary_id);
  const { data, error } = await query;
  if (error) throw new HttpError(500, error.message);
  return data || [];
}

async function loadDocument(id) {
  const { data, error } = await supabaseAdmin
    .from('documents')
    .select(DOCUMENT_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  return data;
}

async function canAccess(user, doc) {
  if (user.role === ROLES.CSWD_STAFF) return true;
  if (user.role === ROLES.BARANGAY_STAFF) return true; // Tambacan-only study scope
  if (doc.uploaded_by === user.id) return true;
  if (doc.beneficiary_id) {
    const { data } = await supabaseAdmin
      .from('beneficiaries')
      .select('id')
      .eq('id', doc.beneficiary_id)
      .eq('user_id', user.id)
      .maybeSingle();
    return Boolean(data);
  }
  return false;
}

/** Returns a short-lived signed URL after verifying ownership/role. */
export async function createDownloadUrl(user, id, { expiresInSec = 300, inline = false } = {}) {
  const doc = await loadDocument(id);
  if (!doc) throw notFound('Document not found.');
  if (!(await canAccess(user, doc))) throw forbidden('You are not allowed to access this document.');

  const options = inline ? {} : { download: doc.file_name };
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(doc.storage_path, expiresInSec, options);
  if (error) throw new HttpError(500, `Signed URL failed: ${error.message}`);
  return { url: data.signedUrl, expiresInSec, document: doc };
}

export async function deleteDocument(user, id) {
  const doc = await loadDocument(id);
  if (!doc) throw notFound('Document not found.');
  const isOwner = doc.uploaded_by === user.id;
  if (!isOwner && user.role !== ROLES.CSWD_STAFF) {
    throw forbidden('Only the uploader or a CSWD staff member can delete a document.');
  }

  const { error } = await supabaseAdmin.from('documents').delete().eq('id', id);
  if (error) throw new HttpError(500, error.message);
  const { error: storageError } = await supabaseAdmin.storage.from(BUCKET).remove([doc.storage_path]);
  if (storageError) console.warn('[ReliefGov] storage remove failed:', storageError.message);
  return { ok: true };
}

const DOCUMENT_STATUSES = Object.freeze(['Accepted', 'Rejected']);

/**
 * Staff document review (Batch 4): accept or reject a supporting document.
 * Rejection requires a written reason; the uploader is notified of the
 * outcome. Server-side only — the client cannot set document status itself.
 */
export async function updateDocumentStatus(user, id, input) {
  if (!user || (user.role !== ROLES.BARANGAY_STAFF && user.role !== ROLES.CSWD_STAFF)) {
    throw forbidden('Only barangay and CSWD staff can review supporting documents.');
  }
  const status = String(input?.status || '').trim();
  if (!DOCUMENT_STATUSES.includes(status)) {
    throw badRequest('Unknown document status.', {
      status: `Must be one of: ${DOCUMENT_STATUSES.join(', ')}.`
    });
  }
  const reason = String(input?.reason || '').trim();
  if (status === 'Rejected' && reason.length < 5) {
    throw badRequest('A reason is required when rejecting a document.', {
      reason: 'Explain the reason (at least 5 characters) so the applicant knows what to fix.'
    });
  }
  if (reason.length > 500) {
    throw badRequest('The reason is too long.', { reason: 'Keep it under 500 characters.' });
  }

  const doc = await loadDocument(id);
  if (!doc) throw notFound('Document not found.');

  const { data, error } = await supabaseAdmin
    .from('documents')
    .update({ status, status_reason: status === 'Rejected' ? reason : null })
    .eq('id', id)
    .select(DOCUMENT_COLUMNS)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);

  let returnedForCorrection = false;
  if (status === 'Rejected' && doc.beneficiary_id) {
    const { data: beneficiary } = await supabaseAdmin
      .from('beneficiaries')
      .select('id, beneficiary_number, first_name, last_name, user_id, application_status, validation_status')
      .eq('id', doc.beneficiary_id)
      .maybeSingle();

    if (beneficiary && beneficiary.application_status !== 'Needs Correction' && beneficiary.application_status !== 'Rejected') {
      const fromStatus = beneficiary.application_status;
      const rejectionReason = `Document rejected (${doc.purpose}): ${reason}`;

      const { error: appUpdateError } = await supabaseAdmin
        .from('beneficiaries')
        .update({
          application_status: 'Needs Correction',
          status_reason: rejectionReason
        })
        .eq('id', beneficiary.id);

      if (!appUpdateError) {
        returnedForCorrection = true;

        try {
          await supabaseAdmin.from('application_status_history').insert({
            beneficiary_id: beneficiary.id,
            from_status: fromStatus,
            to_status: 'Needs Correction',
            reason: rejectionReason,
            actor_role: user.role
          });
        } catch (hErr) {
          console.warn('[ReliefGov] status history write failed:', hErr.message);
        }

        try {
          await supabaseAdmin.from('verification_reviews').insert({
            beneficiary_id: beneficiary.id,
            reviewer_id: user.id,
            reviewer_role: user.role,
            stage: user.role === ROLES.BARANGAY_STAFF ? 'barangay' : 'cswd',
            outcome: 'Needs Correction',
            remarks: `Document "${doc.purpose}" rejected: ${reason}`
          });
        } catch (rErr) {
          console.warn('[ReliefGov] verification review write failed:', rErr.message);
        }

        const applicantId = beneficiary.user_id || doc.uploaded_by;
        if (applicantId) {
          try {
            await notify(applicantId, {
              title: 'Application returned for correction',
              body: `Your application was returned for correction because your "${doc.purpose}" was rejected: ${reason}. Please update your document and resubmit.`,
              level: 'warning',
              category: 'application',
              link_path: '/application/edit'
            });
          } catch (nErr) {
            console.warn('[ReliefGov] notification write failed:', nErr.message);
          }
        }
      }
    }
  }

  if (doc.uploaded_by && !returnedForCorrection) {
    await notify(doc.uploaded_by, {
      title: status === 'Accepted' ? 'Document accepted' : 'Document needs attention',
      body: status === 'Accepted'
        ? `Your "${doc.purpose}" document was reviewed and accepted.`
        : `Your "${doc.purpose}" document was not accepted. Reason: ${reason}`,
      level: status === 'Accepted' ? 'success' : 'warning',
      category: 'validation',
      link_path: '/application'
    });
  }
  try {
    await supabaseAdmin.from('audit_logs').insert({
      actor_id: user.id,
      action: `document.${status === 'Accepted' ? 'accept' : 'reject'}`,
      entity: 'documents',
      entity_id: id,
      detail: {
        purpose: doc.purpose,
        reason: status === 'Rejected' ? reason : null,
        returned_for_correction: returnedForCorrection
      }
    });
  } catch (err) {
    console.warn('[ReliefGov] audit log write failed:', err.message);
  }
  return { document: data, returnedForCorrection };
}

export default {
  BUCKET,
  MAX_BYTES,
  DOCUMENT_PURPOSES,
  uploadDocument,
  listDocuments,
  createDownloadUrl,
  deleteDocument,
  updateDocumentStatus
};
