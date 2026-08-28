/**
 * Connection tests for provider credentials.
 *
 * Contract, and the reason this file is separate: a probe result NEVER
 * contains the value it tested. Everything returned is derived from the HTTP
 * status alone. An admin panel that echoes back "we tried key sk-ant-…" turns
 * a read-only XSS into credential exfiltration.
 *
 * Each probe hits the cheapest authenticated read the provider offers — a
 * model list — so a test costs nothing and creates nothing.
 */

import crypto from 'node:crypto';

import { cfg, peekValue } from './store.js';
import { checkOutboundUrl, credentialDef } from './registry.js';
import { logger } from '../../utils/logger.js';

const TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Maps an HTTP status to a stable, value-free outcome. */
function fromStatus(status) {
  if (status >= 200 && status < 300) return { ok: true, verified: true, code: 'ok' };
  if (status === 401 || status === 403) return { ok: false, verified: true, code: 'unauthorized' };
  if (status === 429) return { ok: false, verified: true, code: 'rate_limited' };
  if (status >= 500) return { ok: false, verified: false, code: 'provider_error' };
  return { ok: false, verified: false, code: 'unexpected_status' };
}

const PROBES = {
  async ANTHROPIC_API_KEY(value) {
    const res = await fetchWithTimeout('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': value, 'anthropic-version': '2023-06-01' },
    });
    return { ...fromStatus(res.status), status: res.status };
  },

  async GEMINI_API_KEY(value) {
    const res = await fetchWithTimeout(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
      { headers: { 'x-goog-api-key': value } },
    );
    return { ...fromStatus(res.status), status: res.status };
  },

  async GROQ_API_KEY(value) {
    const res = await fetchWithTimeout('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${value}` },
    });
    return { ...fromStatus(res.status), status: res.status };
  },

  /**
   * reCAPTCHA has no "is this secret valid" endpoint, but siteverify answers
   * the question for free: it always returns HTTP 200, and distinguishes a bad
   * SECRET from a bad RESPONSE in `error-codes`. So a deliberately junk
   * response earns `invalid-input-response` from a working secret and
   * `invalid-input-secret` from a broken one — a real verification, with no
   * side effect and no browser needed.
   */
  async RECAPTCHA_SECRET(value) {
    const res = await fetchWithTimeout('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: value, response: 'probe' }).toString(),
    });
    if (!res.ok) return { ...fromStatus(res.status), status: res.status };
    const data = await res.json().catch(() => null);
    const codes = Array.isArray(data?.['error-codes']) ? data['error-codes'] : [];
    if (codes.includes('invalid-input-secret')) {
      return { ok: false, verified: true, code: 'unauthorized', status: res.status };
    }
    // Anything else means Google recognised the secret and objected only to
    // the response we deliberately made up.
    return { ok: true, verified: true, code: 'ok', status: res.status };
  },

  /**
   * EasyKash publishes no key-verification endpoint, and the only authenticated
   * call available (Direct Pay) CREATES a payment. Probing it would put junk
   * orders in the merchant dashboard, so this checks reachability of the
   * configured host only and says so: `verified: false` is what makes the UI
   * stop claiming the key is good.
   */
  async EASYKASH_API_KEY() {
    const base = String(cfg('EASYKASH_BASE_URL') || '').replace(/\/$/, '');
    if (!base) return { ok: false, verified: false, code: 'no_base_url', status: null };
    // Same pin the checkout path enforces. Without it this endpoint is a
    // super_admin-driven "make the server request any host" primitive, and it
    // would report an off-list base as healthy.
    if (!checkOutboundUrl('EASYKASH_BASE_URL', base).ok) {
      return { ok: false, verified: false, code: 'base_url_not_allowed', status: null };
    }
    try {
      const res = await fetchWithTimeout(base, { method: 'GET' });
      return { ok: res.status < 500, verified: false, code: 'reachable_only', status: res.status };
    } catch {
      return { ok: false, verified: false, code: 'unreachable', status: null };
    }
  },

  /**
   * The Firebase service account, base64-encoded.
   *
   * Two failures, and the order they are checked in is the point. The
   * overwhelmingly likely one is a truncated paste: the JSON is a couple of
   * kilobytes with an embedded multi-line PEM inside it, and a text field drops
   * the tail with nothing on screen to say so. That is caught locally, before
   * the value can be saved, and answered `malformed` with `verified: true` —
   * the value is definitively bad and no network call was needed to know it.
   * Reported as a connection problem instead, it sends the operator to check
   * Firebase's status page for a mistake they made in the clipboard.
   *
   * Only a structurally sound account is exchanged at Google's token endpoint,
   * which is the same call services/push/fcm.js makes before every send.
   *
   * The minting is written out here rather than imported from fcm.js on
   * purpose. fcm.js mints from the SAVED credential via cfg() and caches the
   * resulting access token at module scope; reusing it would either test a
   * value other than the candidate — testing an unsaved candidate is the whole
   * reason this endpoint exists — or overwrite the live send path's cached
   * token with one minted from a value nobody has committed to yet.
   */
  async FIREBASE_SERVICE_ACCOUNT_B64(value) {
    const TOKEN_URL = 'https://oauth2.googleapis.com/token';
    const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
    const b64url = (buf) => Buffer.from(buf)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const malformed = { ok: false, verified: true, code: 'malformed', status: null };

    let sa;
    try {
      const json = JSON.parse(Buffer.from(String(value), 'base64').toString('utf8'));
      // Present-and-usable, not merely parseable: a JSON object missing the
      // private key decodes cleanly and then fails at send time instead.
      if (!json.project_id || !json.client_email || !json.private_key) return malformed;
      sa = json;
    } catch {
      // The thrown error is neither logged nor returned. JSON.parse quotes the
      // input in its message, and the input is a private key.
      return malformed;
    }

    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }));

    let assertion;
    try {
      const signature = b64url(
        crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), sa.private_key),
      );
      assertion = `${header}.${claims}.${signature}`;
    } catch {
      // A private key that survived JSON.parse but will not sign is the same
      // operator mistake with the same repair — download the file again — so it
      // gets the same answer rather than a code nobody can act on.
      return malformed;
    }

    const res = await fetchWithTimeout(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });

    // A 200 body carries a real, usable access token for the project. It is
    // drained and discarded without ever being parsed, so there is no path by
    // which any of it reaches the caller.
    await res.arrayBuffer().catch(() => {});

    // One correction on top of fromStatus(): Google's token endpoint answers a
    // rejected assertion with 400 invalid_grant, not 401. Left to the generic
    // mapping, the commonest failure after a bad paste — a service account that
    // was deleted or had its key revoked in the Firebase console — would come
    // back `unexpected_status` with `verified: false`, which is the panel
    // shrugging at a definitive rejection.
    const outcome = res.status === 400
      ? { ok: false, verified: true, code: 'unauthorized' }
      : fromStatus(res.status);
    return { ...outcome, status: res.status };
  },
};

/**
 * @param {string} key
 * @param {string|null} candidate  A value being entered but not yet saved.
 *                                 When null, the stored/env value is tested.
 * @returns {Promise<{supported:boolean, ok:boolean, verified:boolean, code:string, status:number|null, testedStored:boolean}>}
 */
export async function probeCredential(key, candidate) {
  const def = credentialDef(key);
  if (!def?.testable || !PROBES[key]) {
    return { supported: false, ok: false, verified: false, code: 'unsupported', status: null, testedStored: false };
  }

  const value = candidate || peekValue(key);
  if (!value) {
    return { supported: true, ok: false, verified: false, code: 'no_value', status: null, testedStored: !candidate };
  }

  try {
    const result = await PROBES[key](value);
    return { supported: true, testedStored: !candidate, ...result };
  } catch (err) {
    // The message is logged, never returned: provider SDKs have been known to
    // include the request headers in it.
    logger.warn('[credentials] probe failed', { key, message: err.message });
    const aborted = err?.name === 'AbortError';
    return {
      supported: true,
      ok: false,
      verified: false,
      code: aborted ? 'timeout' : 'network_error',
      status: null,
      testedStored: !candidate,
    };
  }
}
