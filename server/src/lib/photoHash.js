import crypto from 'node:crypto';

/**
 * Duplicate-photo fingerprinting helpers (zero-schema-change design).
 *
 * Fingerprints are embedded inside `documents.storage_path` as:
 *   `<user-id>/<uuid>-fp_<sha16>[_<dhash16>]-<safe-name>.<ext>`
 *
 * - `sha16`:   First 16 hex chars (64 bits) of SHA-256 over the uploaded bytes.
 *              Catches exact file duplicates instantly.
 * - `dhash16`: 16 hex chars (64 bits) of perceptual difference hash (dHash)
 *              computed client-side over a 9x8 grayscale canvas. Catches
 *              cropped, resized, compressed, or screenshotted copies of the
 *              same damaged-house photo (Hamming distance <= 6 bits).
 */

const FP_REGEX = /-fp_([0-9a-f]{16})(?:_([0-9a-f]{16}))?-/i;

export function sha256Short(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
}

export function sanitizePhash(phash) {
  if (typeof phash !== 'string') return null;
  const trimmed = phash.trim().toLowerCase();
  return /^[0-9a-f]{16}$/.test(trimmed) ? trimmed : null;
}

export function buildFingerprintTag(sha16, phash) {
  const cleanPhash = sanitizePhash(phash);
  return cleanPhash ? `fp_${sha16}_${cleanPhash}` : `fp_${sha16}`;
}

export function parseFingerprintFromPath(storagePath) {
  if (typeof storagePath !== 'string') return null;
  const match = FP_REGEX.exec(storagePath);
  if (!match) return null;
  return {
    sha16: match[1].toLowerCase(),
    phash: match[2] ? match[2].toLowerCase() : null
  };
}

/**
 * Counts differing bits between two 16-char (64-bit) hexadecimal hashes.
 * Returns 64 if either input is invalid.
 */
export function hammingDistanceHex(hexA, hexB) {
  if (!hexA || !hexB || hexA.length !== 16 || hexB.length !== 16) return 64;
  let dist = 0;
  for (let i = 0; i < 16; i += 1) {
    let x = parseInt(hexA[i], 16) ^ parseInt(hexB[i], 16);
    while (x > 0) {
      dist += x & 1;
      x >>= 1;
    }
  }
  return dist;
}

/**
 * Compares two photo fingerprints and returns a match assessment.
 * Threshold: Hamming distance <= 6 bits out of 64 (>= 90.6% visual similarity).
 */
export function comparePhotoFingerprints(fpA, fpB) {
  if (!fpA || !fpB) return { matched: false, exact: false, similarity: 0, confidence: null, evidence: null };

  if (fpA.sha16 && fpB.sha16 && fpA.sha16 === fpB.sha16) {
    return {
      matched: true,
      exact: true,
      similarity: 1.0,
      confidence: 'high',
      evidence: 'Exact duplicate damage photo uploaded (identical image file fingerprint)'
    };
  }

  if (fpA.phash && fpB.phash) {
    const distance = hammingDistanceHex(fpA.phash, fpB.phash);
    if (distance <= 6) {
      const similarity = Number(((64 - distance) / 64).toFixed(4));
      const pct = Math.round(similarity * 100);
      return {
        matched: true,
        exact: false,
        similarity,
        confidence: distance <= 3 ? 'high' : 'medium',
        evidence: `Visually matching damage photo detected (${pct}% visual similarity via perceptual hash)`
      };
    }
  }

  return { matched: false, exact: false, similarity: 0, confidence: null, evidence: null };
}
