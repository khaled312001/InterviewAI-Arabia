/**
 * Verify a Google ID token, locally.
 *
 * The client (browser or Android) completes the Google sign-in itself and
 * hands us the resulting ID token. That token is the ONLY thing we trust from
 * it — never the email, name or `sub` sent alongside, because a client can put
 * anything in a JSON body and "sign in as this email" is the whole attack.
 *
 * Verification is done here rather than by calling Google's `tokeninfo`
 * endpoint, for two reasons: `tokeninfo` is a network round trip on every
 * login (and a rate limit we do not control), and a network failure there
 * would have to be resolved either as "reject a valid user" or "accept an
 * unverified token". Local RS256 verification against the published JWKS has
 * no such fork.
 *
 * What is checked, in order — each of these is a real bypass if skipped:
 *   • RS256 signature against the JWKS key named by the token's `kid`
 *   • `iss` is Google
 *   • `aud` is one of OUR client ids  — otherwise any Google app's token works
 *   • `exp` / `iat` inside a small skew
 *   • `email_verified` — an unverified Google email can be an address the
 *     holder does not own, which would let them take over the account that
 *     already exists under it here
 */

import crypto from 'node:crypto';

import { logger } from '../../utils/logger.js';

/**
 * What goes in `users.password_hash` for an account that has no password.
 *
 * `password_hash` is NOT NULL, and a Google-only account has nothing to put
 * there. The obvious fix — a random unusable bcrypt hash — is wrong for one
 * reason that only shows up later: nothing can then TELL that the account has
 * no password, so `DELETE /user/me` (which asks for the password) becomes
 * impossible to satisfy and the user cannot delete their own account. Google
 * Play requires in-app deletion, so that is a policy failure, not a nuisance.
 *
 * A value that is deliberately NOT a bcrypt hash solves both halves:
 * `bcrypt.compare` returns false for it (verified — it does not throw), so
 * password login can never succeed; and `hasUsablePassword()` can recognise it,
 * so deletion can fall back to the session token as proof of identity.
 */
export const NO_PASSWORD = '!no-password:google';

/** Whether this account can be signed into with a password at all. */
export function hasUsablePassword(passwordHash) {
  return typeof passwordHash === 'string' && passwordHash.startsWith('$2');
}

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/** Tolerance for clock drift between this box and Google, in seconds. */
const SKEW_SECONDS = 120;

/** Fallback lifetime when Google's response carries no usable Cache-Control. */
const DEFAULT_JWKS_TTL_MS = 60 * 60 * 1000;

let jwksCache = { keys: new Map(), expiresAt: 0 };
let inflight = null;

const b64urlToBuffer = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function parseMaxAge(header) {
  const m = /max-age=(\d+)/i.exec(header || '');
  if (!m) return null;
  const seconds = Number.parseInt(m[1], 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

async function fetchJwks() {
  const res = await fetch(JWKS_URL, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`JWKS HTTP ${res.status}`);
  const body = await res.json();

  const keys = new Map();
  for (const jwk of body.keys || []) {
    if (jwk.kty !== 'RSA' || (jwk.alg && jwk.alg !== 'RS256')) continue;
    keys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
  }
  if (!keys.size) throw new Error('JWKS contained no usable RSA keys');

  const ttl = parseMaxAge(res.headers.get('cache-control')) ?? DEFAULT_JWKS_TTL_MS;
  jwksCache = { keys, expiresAt: Date.now() + ttl };
  return keys;
}

/**
 * The current signing keys.
 *
 * `inflight` collapses a thundering herd: without it, a cold cache and ten
 * simultaneous logins would issue ten identical requests to Google.
 */
async function signingKeys({ force = false } = {}) {
  if (!force && jwksCache.keys.size && Date.now() < jwksCache.expiresAt) return jwksCache.keys;
  if (!inflight) {
    inflight = fetchJwks().finally(() => { inflight = null; });
  }
  return inflight;
}

function decodeSegments(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [rawHeader, rawPayload, rawSignature] = parts;

  let header;
  let payload;
  try {
    header = JSON.parse(b64urlToBuffer(rawHeader).toString('utf8'));
    payload = JSON.parse(b64urlToBuffer(rawPayload).toString('utf8'));
  } catch {
    throw new Error('malformed token');
  }
  return {
    header,
    payload,
    signed: `${rawHeader}.${rawPayload}`,
    signature: b64urlToBuffer(rawSignature),
  };
}

/**
 * Verify and decode a Google ID token.
 *
 * @param {string} idToken
 * @param {string[]} audiences Client ids this deployment accepts. An EMPTY
 *   list is treated as "Google sign-in is not configured" and rejects
 *   everything — never as "accept any audience".
 * @returns {Promise<{sub: string, email: string, name: string|null, picture: string|null}>}
 */
export async function verifyGoogleIdToken(idToken, audiences) {
  const allowed = (audiences || []).filter(Boolean);
  if (!allowed.length) throw new Error('google sign-in is not configured');

  const { header, payload, signed, signature } = decodeSegments(idToken);
  if (header.alg !== 'RS256') throw new Error(`unsupported alg ${header.alg}`);

  let keys = await signingKeys();
  let key = keys.get(header.kid);
  if (!key) {
    // Google rotates keys; an unknown `kid` on a warm cache is the expected
    // shape of that, not an attack. One forced refresh, then give up.
    keys = await signingKeys({ force: true });
    key = keys.get(header.kid);
  }
  if (!key) throw new Error('unknown signing key');

  const ok = crypto.verify('RSA-SHA256', Buffer.from(signed), key, signature);
  if (!ok) throw new Error('bad signature');

  if (!ISSUERS.has(payload.iss)) throw new Error(`bad issuer ${payload.iss}`);
  if (!allowed.includes(payload.aud)) throw new Error('token was not issued for this app');

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp + SKEW_SECONDS < now) throw new Error('token expired');
  if (payload.iat && payload.iat - SKEW_SECONDS > now) throw new Error('token issued in the future');

  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) throw new Error('token carries no email');
  // Google sends this as a boolean or the string "true" depending on the flow.
  if (payload.email_verified !== true && payload.email_verified !== 'true') {
    throw new Error('google has not verified this email');
  }
  if (!payload.sub) throw new Error('token carries no subject');

  return {
    sub: String(payload.sub),
    email,
    name: payload.name ? String(payload.name).slice(0, 120) : null,
    picture: payload.picture ? String(payload.picture).slice(0, 512) : null,
  };
}

/** Whether the JWKS is reachable at all — for the admin health panel. */
export async function probeGoogleJwks() {
  try {
    const keys = await signingKeys({ force: true });
    return { ok: true, keys: keys.size };
  } catch (err) {
    logger.warn('google JWKS probe failed', { message: err.message });
    return { ok: false, error: err.message };
  }
}
