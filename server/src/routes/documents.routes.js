import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ROLES } from '../services/authService.js';
import {
  uploadDocument,
  listDocuments,
  createDownloadUrl,
  deleteDocument,
  updateDocumentStatus
} from '../services/documentService.js';

/**
 * Supporting documents (private Supabase Storage bucket).
 * All roles may upload; beneficiaries only ever see their own documents,
 * Barangay/CSWD staff see Tambacan records. File type and size are
 * validated server-side (PDF/JPEG/PNG, max 5 MB).
 * Staff-only document review (accept / reject with reason) arrives in
 * Batch 4 via PATCH /:id/status.
 */
const router = Router();
const STAFF = [ROLES.BARANGAY_STAFF, ROLES.CSWD_STAFF];

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const documents = await listDocuments(req.user, {
      beneficiary_id: String(req.query.beneficiary_id || '') || undefined
    });
    res.json({ documents, total: documents.length });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const document = await uploadDocument(req.user, {
      file: body.file,
      beneficiary_id: body.beneficiary_id,
      purpose: body.purpose
    });
    res.status(201).json({ document });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/download', async (req, res, next) => {
  try {
    const inline = req.query.inline === 'true' || req.query.view === 'true';
    const result = await createDownloadUrl(req.user, req.params.id, { inline });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Staff document review (Batch 4): Accepted / Rejected (reason required).
router.patch('/:id/status', requireRole(...STAFF), async (req, res, next) => {
  try {
    const result = await updateDocumentStatus(req.user, req.params.id, req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const result = await deleteDocument(req.user, req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
