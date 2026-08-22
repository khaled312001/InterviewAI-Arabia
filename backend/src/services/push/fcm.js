/**
 * Firebase Cloud Messaging, over the HTTP v1 API.
 *
 * Why not `firebase-admin`
 *   Because we need exactly one verb — send a message — and `firebase-admin`
 *   brings `@google-cloud/firestore` and `@google-cloud/storage` with it. On a
 *   shared-hosting box where `npm install` already fights for CPU and the whole
 *   backend is deployed as a tarball, that is tens of megabytes of dependency
 *   for one POST. FCM v1 is a documented, stable, versioned REST API and the
 *   only hard part is minting the access token, which is forty lines below.
 *
 *   This is a different judgement from the Edge-TTS case, which is an
 *   undocumented endpoint with a token that ages out. This one is contractual.
 *
 * Auth
 *   A service-account JWT (RS256, scoped to firebase.messaging) exchanged at
 *   Google's token endpoint for a one-hour access token, cached until shortly
 *   before it expires. The private key never leaves this process and is never
 *   logged.
 *
 * Timeouts
 *   Node's `fetch` will wait a very long time on a connection that opens and
 *   then goes quiet, and a broadcast here is a SEQUENTIAL walk: one hung TLS
 *   connection does not fail one token, it stalls every token behind it — on
 *   the single worker thread that is also serving live interviews. So every
 *   call in this file is bounded by REQUEST_TIMEOUT_MS. A send that times out
 *   is reported as `TIMEOUT` and never as dead: we did not hear back about
 *   that address, which is not the same as FCM disowning it.
 *
 * The one thing every push system gets wrong
 *   Tokens die — the app is uninstalled, data is cleared, the token is rotated.
 *   FCM answers `UNREGISTERED` or `INVALID_ARGUMENT`, and a sender that ignores
 *   that keeps a table full of addresses that can never be delivered to, quietly
 *   inflating every "sent to N users" number it reports. `send()` reports those
 *   codes back so the caller can retire the row; `sendToTokens()` does it.
 */

import crypto from 'node:crypto';

import { logger } from '../../utils/logger.js';
import { cfg } from '../secrets/store.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const JWT_LIFETIME_SECONDS = 3600;
/** Refresh this long before expiry, so an in-flight send never straddles it. */
const TOKEN_SKEW_SECONDS = 120;

/**
 * How long one HTTP call to Google may take before it is abandoned.
 *
 * Both calls here are a small POST to a Google endpoint that normally answers
 * in well under a second, so this is generous, not tight. It exists to put a
 * ceiling on a stall, not to police latency.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/** FCM's own ceiling for a multicast send. */
export const MAX_TOKENS_PER_BATCH = 500;

/** Codes that mean "this token will never work again — delete the row". */
const DEAD_TOKEN_CODES = new Set([
  'UNREGISTERED',
  'INVALID_ARGUMENT',
  'SENDER_ID_MISMATCH',
]);

let cachedToken = null; // { accessToken, expiresAt }

const b64url = (buf) => Buffer.from(buf)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');

/**
 * The service account, as three fields.
 *
 * Stored base64-encoded because the private key is multi-line PEM and a `.env`
 * file has no way to express that. Read through `cfg()` so it can also come
 * from the encrypted credential store and be rotated without a deploy.
 */
export function serviceAccount() {
  const raw = cfg('FIREBASE_SERVICE_ACCOUNT_B64');
  if (!raw) return null;
  try {
    const json = JSON.parse(Buffer.from(String(raw), 'base64').toString('utf8'));
    if (!json.project_id || !json.client_email || !json.private_key) return null;
    return {
      projectId: json.project_id,
      clientEmail: json.client_email,
      privateKey: json.private_key,
    };
  } catch {
    // A malformed value must not throw on every request. It means "push is not
    // configured", which is a state the whole system already handles.
    logger.warn('FIREBASE_SERVICE_ACCOUNT_B64 is set but is not valid base64 JSON');
    return null;
  }
}

/** Whether push can be sent at all. Callers render nothing when false. */
export function isConfigured() {
  return serviceAccount() !== null;
}

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt - TOKEN_SKEW_SECONDS * 1000 > Date.now()) {
    return cachedToken.accessToken;
  }

  const sa = serviceAccount();
  if (!sa) throw new Error('firebase service account is not configured');

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + JWT_LIFETIME_SECONDS,
  }));
  const signature = b64url(
    crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), sa.privateKey),
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  let body;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${header}.${claims}.${signature}`,
      }),
      signal: controller.signal,
    });
    body = await res.json().catch(() => ({}));
  } catch (err) {
    // Named apart from a rejected JWT on purpose: probe() shows this string to
    // the operator, and "the key is wrong" and "we could not reach Google" are
    // two different things to go and do something about.
    throw new Error(
      err.name === 'AbortError'
        ? `FCM token exchange timed out after ${REQUEST_TIMEOUT_MS}ms`
        : `FCM token exchange could not reach ${TOKEN_URL}: ${err.message}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok || !body.access_token) {
    // `error_description` is Google's, and it names the actual fault ("Invalid
    // JWT Signature", "account not found"). Worth surfacing — it is the
    // difference between a wrong key and a disabled service account.
    throw new Error(`FCM token exchange ${res.status}: ${body.error_description || body.error || 'unknown'}`);
  }

  cachedToken = {
    accessToken: body.access_token,
    expiresAt: Date.now() + (Number(body.expires_in) || JWT_LIFETIME_SECONDS) * 1000,
  };
  return cachedToken.accessToken;
}

/**
 * Send one message to one token.
 *
 * @returns {Promise<{ok: true} | {ok: false, dead: boolean, code: string, detail: string}>}
 *   Never throws for a per-token failure — a bad token in a broadcast must not
 *   abort the other 499.
 */
export async function send(token, message) {
  const sa = serviceAccount();
  if (!sa) return { ok: false, dead: false, code: 'NOT_CONFIGURED', detail: 'no service account' };

  let bearer;
  try {
    bearer = await accessToken();
  } catch (err) {
    return { ok: false, dead: false, code: 'AUTH_FAILED', detail: err.message };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${sa.projectId}/messages:send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { ...message, token } }),
        signal: controller.signal,
      },
    );

    if (res.ok) return { ok: true };

    const body = await res.json().catch(() => ({}));
    // The machine-readable code lives in the error details, not in `status`.
    const code = body?.error?.details?.find(
      (d) => d['@type']?.endsWith('FcmError'),
    )?.errorCode || body?.error?.status || `HTTP_${res.status}`;

    return {
      ok: false,
      dead: DEAD_TOKEN_CODES.has(code),
      code,
      detail: body?.error?.message || `HTTP ${res.status}`,
    };
  } catch (err) {
    // `dead: false` on both of these, and that is the whole point of catching
    // them separately: a token we never got an answer about has not been
    // disowned by FCM. Retiring it would soft-delete a live device because the
    // network blinked, and nothing ever un-retires a row.
    if (err.name === 'AbortError') {
      return { ok: false, dead: false, code: 'TIMEOUT', detail: `no answer in ${REQUEST_TIMEOUT_MS}ms` };
    }
    return { ok: false, dead: false, code: 'HTTP_0', detail: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the FCM message body.
 *
 * `data` values must be strings — FCM rejects numbers and objects — and the
 * client reads `data.route` to decide where a tap should land, so every caller
 * gets the coercion rather than remembering it.
 *
 * Android specifics that are not cosmetic:
 *   • `priority: high` is what wakes a dozing device. Without it a "your
 *     evaluation is ready" push can arrive an hour later, batched.
 *   • `channelId` must match a channel the app created, or Android 8+ drops the
 *     notification silently.
 */
export function buildMessage({ title, body, data = {}, channelId = 'default', imageUrl }) {
  const stringData = Object.fromEntries(
    Object.entries(data)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, String(v)]),
  );

  return {
    notification: { title, body, ...(imageUrl ? { image: imageUrl } : {}) },
    data: stringData,
    android: {
      priority: 'high',
      notification: {
        channelId,
        sound: 'default',
        // Arabic is right-to-left; Android handles that from the text itself,
        // but a long body is truncated to one line unless it is told otherwise.
        defaultSound: true,
      },
    },
    apns: {
      headers: { 'apns-priority': '10' },
      payload: { aps: { sound: 'default', 'content-available': 1 } },
    },
  };
}

/**
 * Fan a message out to many tokens.
 *
 * Sequential in batches rather than one giant Promise.all: this runs on a
 * shared-hosting box with one worker thread, and five hundred simultaneous TLS
 * handshakes is how the interview requests sharing that process start timing
 * out. Delivery latency of a broadcast is nobody's SLA; the live interview is.
 *
 * DO NOT AWAIT THIS INSIDE A REQUEST HANDLER
 *   Batching bounds CONCURRENCY. It does nothing about TOTAL TIME, and the two
 *   are separate problems — the paragraph above only answers the first. At the
 *   audience.js ceiling of 100,000 addresses this is 4,000 sequential round
 *   trips, plus one UPDATE per dead address in the retirement pass below —
 *   minutes at best, and REQUEST_TIMEOUT_MS only makes that bounded, not
 *   short. No HTTP client waits that long. Whatever gives up first — the
 *   admin panel, LiteSpeed's LSAPI timeout, a proxy — leaves the fan-out still
 *   running while the operator sees a failure and sends the whole broadcast a
 *   second time.
 *
 *   The `notifications` row is written BEFORE the send (notify.js), so its id
 *   and the history already survive answering the operator immediately: a
 *   caller on a request path should hand back that id and let the panel poll
 *   `sent_count`, rather than holding the response open for the walk.
 *
 * @param {string[]} tokens
 * @param {object} message from buildMessage()
 * @param {(token: string, code: string) => Promise<void>} [onDeadToken]
 */
export async function sendToTokens(tokens, message, onDeadToken) {
  const unique = [...new Set(tokens.filter(Boolean))];
  let sent = 0;
  let failed = 0;
  const dead = [];
  const errors = new Map();

  for (let i = 0; i < unique.length; i += 25) {
    const slice = unique.slice(i, i + 25);
    const results = await Promise.all(slice.map((t) => send(t, message)));
    for (let j = 0; j < results.length; j += 1) {
      const r = results[j];
      if (r.ok) { sent += 1; continue; }
      failed += 1;
      errors.set(r.code, (errors.get(r.code) || 0) + 1);
      if (r.dead) dead.push(slice[j]);
    }
  }

  if (dead.length && onDeadToken) {
    for (const token of dead) {
      await onDeadToken(token, 'dead').catch(() => {});
    }
  }

  return { total: unique.length, sent, failed, dead: dead.length, errors: Object.fromEntries(errors) };
}

/** Reachability check for the admin health panel. */
export async function probe() {
  const sa = serviceAccount();
  if (!sa) return { ok: false, error: 'not configured' };
  try {
    await accessToken();
    return { ok: true, projectId: sa.projectId, clientEmail: sa.clientEmail };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
