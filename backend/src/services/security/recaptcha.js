/**
 * reCAPTCHA v3 verification for the public contact form.
 *
 * v3 is invisible and returns a SCORE, not a pass/fail. There is no checkbox to
 * tick and no puzzle to solve; the browser produces a token, and Google tells
 * us how human the surrounding session looked. That shape drives every decision
 * in this file:
 *
 *   - a token is single-use and expires after two minutes, so it cannot be
 *     harvested from the page and replayed later;
 *   - `action` is bound and CHECKED. Without that check, a token minted on any
 *     other page of the site — or on any other form we add later — would be
 *     accepted here, and the whole mechanism reduces to "did this person ever
 *     load our site";
 *   - `hostname` is checked, which is what stops someone hosting a copy of our
 *     form on their own domain and pumping our inbox with valid tokens;
 *   - the score is compared to a threshold that an operator can move without a
 *     deploy, because the correct value is a property of traffic we have not
 *     seen yet.
 *
 * FAIL-OPEN WHEN UNCONFIGURED, FAIL-CLOSED WHEN CONFIGURED. If no secret is
 * set, verification is skipped and the form still works — a missing environment
 * variable must not silently take down the only channel a locked-out user has.
 * Once a secret IS set, every failure mode (network, malformed reply, low
 * score) rejects. The honeypot and the rate limiter run either way, so the
 * unconfigured state is degraded, not defenceless.
 */

import { cfg } from '../secrets/store.js';
import { logger } from '../../utils/logger.js';

const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

/** Google's own suggested starting point. Overridable per deployment. */
const DEFAULT_MIN_SCORE = 0.5;

/**
 * Hostnames a token may claim to come from.
 *
 * `localhost` is included because Google itself returns it for local testing
 * and a developer must be able to exercise the real path. It is not a hole: a
 * token is still signed by Google for OUR site key, so an attacker cannot mint
 * one by claiming to be localhost.
 */
const ALLOWED_HOSTS = new Set([
  'interprova.com',
  'www.interprova.com',
  'localhost',
]);

/** A network call that cannot hang the request forever. */
const TIMEOUT_MS = 6000;

export function isConfigured() {
  return Boolean(String(cfg('RECAPTCHA_SECRET') || '').trim());
}

/** The public half, for the client to render with. Never the secret. */
export function siteKey() {
  return String(cfg('RECAPTCHA_SITE_KEY') || '').trim() || null;
}

function minScore() {
  const raw = Number(String(cfg('RECAPTCHA_MIN_SCORE') || '').trim());
  // NaN, negative and >1 are all operator mistakes; fall back rather than
  // locking everyone out with a threshold nothing can reach.
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : DEFAULT_MIN_SCORE;
}

/**
 * @param {string|null|undefined} token   `g-recaptcha-response` from the page.
 * @param {object}  opts
 * @param {string}  opts.action           The action the page claimed to run.
 * @param {string} [opts.ip]              Remote address, for Google's own signals.
 * @returns {Promise<{ok: boolean, reason?: string, score?: number}>}
 */
export async function verify(token, { action, ip } = {}) {
  const secret = String(cfg('RECAPTCHA_SECRET') || '').trim();
  if (!secret) return { ok: true, reason: 'not-configured' };

  if (!token || typeof token !== 'string' || token.length < 20) {
    return { ok: false, reason: 'missing-token' };
  }

  const body = new URLSearchParams({ secret, response: token });
  // Optional and genuinely optional: Google treats a bad value as a signal, so
  // sending a proxy's address rather than the client's would HURT the score.
  if (ip) body.set('remoteip', ip);

  let data;
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: `http-${res.status}` };
    data = await res.json();
  } catch (err) {
    // Configured but unreachable. Reject: accepting everything the moment
    // Google is slow is precisely the window a flood would use.
    logger.warn('recaptcha verify failed', { message: err.message });
    return { ok: false, reason: 'verify-unreachable' };
  }

  if (!data?.success) {
    const codes = Array.isArray(data?.['error-codes']) ? data['error-codes'].join(',') : 'unknown';
    return { ok: false, reason: `rejected:${codes}` };
  }

  // The token was minted for a different form. Checking this is the difference
  // between "proved they are human ON THIS FORM" and "proved they are human".
  if (action && data.action && data.action !== action) {
    return { ok: false, reason: `action-mismatch:${data.action}` };
  }

  if (data.hostname && !ALLOWED_HOSTS.has(String(data.hostname).toLowerCase())) {
    return { ok: false, reason: `hostname:${data.hostname}` };
  }

  const score = typeof data.score === 'number' ? data.score : 0;
  if (score < minScore()) return { ok: false, reason: 'low-score', score };

  return { ok: true, score };
}

/**
 * Admin "test this credential" hook. Proves the SECRET is one Google knows,
 * without needing a browser token: a deliberately invalid response earns
 * `invalid-input-response` from a good secret and `invalid-input-secret` from
 * a bad one, which is exactly the distinction an operator needs.
 */
export async function selfTest() {
  const secret = String(cfg('RECAPTCHA_SECRET') || '').trim();
  if (!secret) return { ok: false, detail: 'no secret set' };
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: 'selftest' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json();
    const codes = Array.isArray(data?.['error-codes']) ? data['error-codes'] : [];
    if (codes.includes('invalid-input-secret')) return { ok: false, detail: 'secret rejected by Google' };
    return { ok: true, detail: 'secret accepted' };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}
