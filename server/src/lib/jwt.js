import crypto from 'node:crypto';
import env from '../config/env.js';

/**
 * Minimal, dependency-free HS256 JWT implementation used only for
 * ReliefGov API sessions issued by this server.
 *
 * When Supabase Auth is configured, Supabase access tokens are verified
 * directly by Supabase instead of through this module.
 */

const b64url = (input) =>
  Buffer.from(input).toString('base64url');

const sign = (data, secret) =>
  crypto.createHmac('sha256', secret).update(data).digest('base64url');

export function issueToken(payload, { expiresInSec = 60 * 60 * 12 } = {}) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSec };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
  return `${data}.${sign(data, env.sessionSecret)}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string' || token.split('.').length !== 3) return null;
  const [h, p, s] = token.split('.');
  const data = `${h}.${p}`;
  const expected = sign(data, env.sessionSecret);
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (typeof claims.exp === 'number' && claims.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

/**
 * Reads a bearer token from the Authorization header.
 */
export function readBearer(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

export default { issueToken, verifyToken, readBearer };
