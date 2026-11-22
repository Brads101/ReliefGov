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

const MAX_IMAGE_DIM = 1600;
const JPEG_QUALITY = 0.8;

/**
 * Computes a 64-bit perceptual difference hash (dHash, 16 hex chars) from a
 * loaded HTMLImageElement using a 9x8 grayscale canvas. Resilient to resizing,
 * re-compression, screenshots, and minor cropping.
 */
function computeDHash(img) {
  const canvas = document.createElement('canvas');
  canvas.width = 9;
  canvas.height = 8;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, 9, 8);
  const { data } = ctx.getImageData(0, 0, 9, 8);

  const gray = new Float32Array(72);
  for (let i = 0; i < 72; i += 1) {
    const idx = i * 4;
    gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  let hex = '';
  for (let row = 0; row < 8; row += 1) {
    let byte = 0;
    for (let col = 0; col < 8; col += 1) {
      const left = gray[row * 9 + col];
      const right = gray[row * 9 + col + 1];
      byte = (byte << 1) | (left > right ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Compresses JPEG/PNG photos client-side via HTML5 Canvas (max 1600px, 80% JPEG)
 * and computes their 64-bit perceptual hash for duplicate photo detection.
 */
function processImageForUpload(file, mime) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      try {
        const phash = computeDHash(img);

        let { naturalWidth: w, naturalHeight: h } = img;
        if (w > MAX_IMAGE_DIM || h > MAX_IMAGE_DIM) {
          const scale = MAX_IMAGE_DIM / Math.max(w, h);
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const compressedUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);

        // Estimate compressed byte size from base64 length.
        const compressedB64 = compressedUrl.slice(compressedUrl.indexOf(',') + 1);
        const compressedBytes = Math.floor((compressedB64.length * 3) / 4);

        // Use compressed JPEG whenever it shrinks the file or brings an oversized photo under 5 MB.
        if (compressedBytes < file.size || file.size > MAX_FILE_BYTES) {
          resolve({ data: compressedUrl, sizeBytes: compressedBytes, phash });
        } else {
          const raw = await fileToDataUrl(file);
          const base64 = raw.slice(raw.indexOf(',') + 1);
          resolve({ data: `data:${mime};base64,${base64}`, sizeBytes: file.size, phash });
        }
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ApiError(400, 'Could not decode the selected image. Please try another JPG or PNG file.'));
    };
    img.src = url;
  });
}

/**
 * Uploads one document to the server.
 * Images are automatically compressed client-side and perceptually hashed (dHash)
 * to improve upload speed on mobile data and detect duplicate damage photos.
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

  let data;
  let phash = null;

  if (mime === 'image/jpeg' || mime === 'image/png') {
    const processed = await processImageForUpload(file, mime);
    if (processed.sizeBytes > MAX_FILE_BYTES) {
      throw new ApiError(400, 'The image is still too large after compression. Maximum size is 5 MB.');
    }
    data = processed.data;
    phash = processed.phash;
  } else {
    if (file.size > MAX_FILE_BYTES) {
      throw new ApiError(400, 'The file is too large. Maximum size is 5 MB.');
    }
    const raw = await fileToDataUrl(file);
    // Re-declare the type from the sniffed bytes (the browser's prefix may be
    // `image/jfif` or `application/octet-stream`, which the server rejects).
    const base64 = raw.slice(raw.indexOf(',') + 1);
    data = `data:${mime};base64,${base64}`;
  }

  const body = JSON.stringify({
    file: { name: file.name, data },
    beneficiary_id: beneficiaryId,
    purpose,
    ...(phash ? { phash } : {})
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
        const doc = payload?.document || null;
        if (doc && payload?.duplicate_photo_warning) {
          resolve({ ...doc, duplicate_photo_warning: payload.duplicate_photo_warning });
        } else {
          resolve(doc);
        }
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
