import { ApiError, api, BASE } from './api.js';

/**
 * Supporting-document uploads with a real progress bar.
 * `fetch()` cannot report upload progress, so uploads use XMLHttpRequest
 * and stream the request body; the rest of the app keeps using `api()`.
 *
 * FILE-TYPE TRUTH (bug fix): browsers disagree about the MIME type they
 * report for photos — a JPEG saved as `.jfif` can arrive as `image/jfif`,
 * `image/jpeg`, or an empty string depending on the browser. The server
 * validates the DECLARED type against the actual bytes, so the client must
 * send a canonical type. Here the first bytes of the file are sniffed
 * first (PDF / JPEG / PNG signatures), with the declared type and the file
 * extension as fallbacks — the data URL is then built with that canonical
 * type so a `.jfif`/no-MIME photo uploads exactly like any other JPEG.
 */

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // matches the server (5 MB)
export const ACCEPTED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];

const EXT_TO_MIME = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jpe': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.png': 'image/png'
};

const startsWith = (bytes, ascii) =>
  bytes.length >= ascii.length &&
  [...ascii].every((ch, i) => bytes[i] === ch.charCodeAt(0));

/**
 * Determines the canonical MIME type of a picked file.
 * @returns {Promise<string|null>} one of ACCEPTED_MIME, or null when the
 *   file is not a supported document/photo (e.g. HEIC, WEBP, ZIP, text).
 */
export async function sniffFileMime(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    // Magic-byte signatures — what the server checks too.
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
    if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
    if (startsWith(head, '%PDF')) return 'application/pdf';
  } catch {
    // Fall through to declared type / extension below.
  }
  const declared = String(file?.type || '').toLowerCase();
  if (ACCEPTED_MIME.includes(declared)) return declared;
  const name = String(file?.name || '').toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot >= 0 && EXT_TO_MIME[name.slice(dot)]) return EXT_TO_MIME[name.slice(dot)];
  return null;
}

function readToken() {
  try {
    return localStorage.getItem('reliefgov_token');
  } catch {
    return null;
  }
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new ApiError(0, 'Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads one document to the server.
 * @param {object} options
 * @param {File} options.file
 * @param {string} options.beneficiaryId — the caller's own application record id
 * @param {string} options.purpose — one of DOCUMENT_PURPOSES
 * @param {(percent:number)=>void} [options.onProgress] 0–100
 */
export async function uploadDocument({ file, beneficiaryId, purpose, onProgress }) {
  const mime = await sniffFileMime(file);
  if (!mime) {
    throw new ApiError(
      400,
      'Only PDF, JPEG, or PNG files are supported. If your photo is HEIC/WEBP, ' +
        'save or convert it as JPG first, then upload it again.'
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new ApiError(400, 'The file is too large. Maximum size is 5 MB.');
  }

  const raw = await fileToDataUrl(file);
  // Re-declare the type from the sniffed bytes (the browser's prefix may be
  // `image/jfif` or `application/octet-stream`, which the server rejects).
  const base64 = raw.slice(raw.indexOf(',') + 1);
  const data = `data:${mime};base64,${base64}`;
  const body = JSON.stringify({
    file: { name: file.name, data },
    beneficiary_id: beneficiaryId,
    purpose
  });

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/documents`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    const token = readToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'Cannot reach the ReliefGov server to upload the file.'));
    xhr.ontimeout = () => reject(new ApiError(0, 'The upload timed out. Please try again.'));
    xhr.onload = () => {
      let payload = null;
      try {
        payload = JSON.parse(xhr.responseText || 'null');
      } catch {
        payload = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onProgress) onProgress(100);
        resolve(payload?.document);
      } else {
        const err = payload?.error || {};
        reject(new ApiError(xhr.status, err.message || `Upload failed (${xhr.status}).`, err.details));
      }
    };
    xhr.send(body);
  });
}

/** Returns a short-lived signed URL for a document the caller may read. */
export function getDocumentUrl(documentId, { inline = false } = {}) {
  const query = inline ? '?inline=true' : '';
  return api(`/documents/${documentId}/download${query}`);
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
