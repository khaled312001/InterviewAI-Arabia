/**
 * Google Calendar, Meet and Tasks over OAuth 2.0 — the server-side web flow.
 *
 * Plain `fetch` against Google's REST endpoints, deliberately not the
 * `googleapis` package: that is ~100 MB of generated clients for the five
 * calls made here, on a host where install size and cold start both matter.
 *
 * Token handling, in one place:
 *   • The REFRESH token is the only long-lived credential. It is stored
 *     encrypted (services/secrets/crypto.js, AES-256-GCM) with the AAD bound to
 *     the user id, so a ciphertext moved onto another user's row is useless.
 *   • ACCESS tokens live for an hour and are kept in process memory only.
 *   • No token, code or PKCE verifier is ever logged. Errors from Google are
 *     reduced to their `error` code before they reach the logger.
 *
 * The OAuth `state` is a short-lived JWT (10 min) that binds the flow to the
 * user who started it and carries the return target — chosen server-side from
 * a fixed list, so the callback can never be turned into an open redirect. It
 * also carries the PKCE verifier, encrypted, so the flow is stateless across
 * processes and the verifier is never visible in the browser.
 */

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { HttpError } from '../../utils/asyncHandler.js';
import { query, queryOne } from '../../db/mysql.js';
import { cfg } from '../secrets/store.js';
import { setting } from '../appSettings.js';
import { encryptSecret, decryptSecret, isCryptoAvailable } from '../secrets/crypto.js';

export const SCOPE_CALENDAR = 'https://www.googleapis.com/auth/calendar.events';
export const SCOPE_TASKS = 'https://www.googleapis.com/auth/tasks';
export const SCOPES = ['openid', 'email', SCOPE_CALENDAR, SCOPE_TASKS];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';

/** The native app's deep link (app.json → expo.scheme). */
export const NATIVE_RETURN = 'interprova://calendar';

const STATE_TTL_SECONDS = 600;
const STATE_AUDIENCE = 'interprova:calendar-oauth';
const HTTP_TIMEOUT_MS = 15_000;

/* =============================================================== config */

/** The OAuth client id: its own setting, else the web sign-in client. */
export function clientId() {
  const own = cfg('GOOGLE_OAUTH_CLIENT_ID');
  if (own && String(own).trim()) return String(own).trim();
  const web = setting('google_client_id_web');
  return web ? String(web).split(',')[0].trim() : '';
}

function clientSecret() {
  const v = cfg('GOOGLE_OAUTH_CLIENT_SECRET');
  return v ? String(v).trim() : '';
}

export function redirectUri() {
  return env.GOOGLE_OAUTH_REDIRECT_URI;
}

/** The public origin links in event descriptions point at. */
export function publicOrigin() {
  try { return new URL(redirectUri()).origin; } catch { return 'https://interprova.com'; }
}

export function isConfigured() {
  return Boolean(clientId() && clientSecret() && isCryptoAvailable());
}

export function requireConfigured() {
  if (!isConfigured()) {
    throw new HttpError(503, 'calendar_not_configured', undefined, 'CALENDAR_NOT_CONFIGURED');
  }
}

/* ============================================================ return-to */

/**
 * Origins a web flow may return to: this deployment and the CORS allow-list.
 * Anything else falls back to the default — never echoed back.
 */
function allowedWebOrigins() {
  const set = new Set();
  for (const u of [redirectUri(), env.APP_URL, ...(env.corsOrigins || [])]) {
    try { set.add(new URL(u).origin); } catch { /* skip malformed */ }
  }
  return set;
}

/**
 * Pick the URL the callback will send the browser back to.
 * `target` is 'web' or 'native'; `webOrigin` is the page's own origin, honoured
 * only when it is on the allow-list. The SPA lives under /app on this
 * deployment's own origin and at the root of any other (Expo dev server).
 */
export function resolveReturnTo(target, webOrigin) {
  if (target === 'native') return NATIVE_RETURN;
  const own = new Set([publicOrigin()]);
  try { own.add(new URL(env.APP_URL).origin); } catch { /* ignore */ }
  if (webOrigin) {
    let origin = null;
    try { origin = new URL(webOrigin).origin; } catch { origin = null; }
    if (origin && origin !== 'null' && allowedWebOrigins().has(origin)) {
      return own.has(origin) ? `${origin}/app/` : `${origin}/`;
    }
  }
  return `${publicOrigin()}/app/`;
}

/** Re-checked on the way out, so even a forged-but-signed value cannot escape. */
function isAllowedReturn(url) {
  if (url === NATIVE_RETURN) return true;
  try {
    const u = new URL(url);
    return allowedWebOrigins().has(u.origin) && (u.pathname === '/' || u.pathname === '/app/');
  } catch {
    return false;
  }
}

export function defaultReturn() {
  return `${publicOrigin()}/app/`;
}

/** `returnTo` with `?calendar=<status>[&reason=<reason>]`. */
export function returnUrl(returnTo, status, reason) {
  const base = isAllowedReturn(returnTo) ? returnTo : defaultReturn();
  const u = new URL(base);
  u.searchParams.set('calendar', status);
  if (reason) u.searchParams.set('reason', reason);
  return u.toString();
}

/* ================================================================ state */

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Nonces already spent, until their state would have expired anyway. */
const usedNonces = new Map();

function spendNonce(nonce) {
  const now = Date.now();
  for (const [n, exp] of usedNonces) if (exp < now) usedNonces.delete(n);
  if (usedNonces.has(nonce)) return false;
  usedNonces.set(nonce, now + STATE_TTL_SECONDS * 1000);
  return true;
}

/** The Google consent URL for this user. */
export function buildAuthUrl(userId, returnTo) {
  requireConfigured();
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const nonce = b64url(crypto.randomBytes(12));

  const state = jwt.sign(
    {
      typ: 'gcal_oauth',
      sub: String(userId),
      rt: returnTo,
      n: nonce,
      v: encryptSecret(verifier, `gcal-pkce:${nonce}`),
    },
    env.JWT_SECRET,
    { expiresIn: STATE_TTL_SECONDS, audience: STATE_AUDIENCE },
  );

  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/**
 * @returns {{ userId: string, returnTo: string, verifier: string }}
 * @throws when the state is missing, forged, expired or already used
 */
export function verifyState(state) {
  if (typeof state !== 'string' || !state) throw new Error('missing state');
  const payload = jwt.verify(state, env.JWT_SECRET, { audience: STATE_AUDIENCE });
  if (payload.typ !== 'gcal_oauth' || !payload.sub || !payload.n || !payload.v) {
    throw new Error('wrong state type');
  }
  if (!spendNonce(payload.n)) throw new Error('state already used');
  return {
    userId: String(payload.sub),
    returnTo: String(payload.rt || ''),
    verifier: decryptSecret(payload.v, `gcal-pkce:${payload.n}`),
  };
}

/* =============================================================== tokens */

async function postForm(url, form) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
}

/** Google's error code only — the body of a token response is never logged. */
async function oauthError(res) {
  try {
    const body = await res.json();
    return String(body?.error || `http_${res.status}`);
  } catch {
    return `http_${res.status}`;
  }
}

/** The email claim of an ID token received directly from Google's token endpoint over TLS. */
function emailFromIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.email === 'string' ? payload.email.slice(0, 191) : null;
  } catch {
    return null;
  }
}

export async function exchangeCode(code, verifier) {
  const res = await postForm(TOKEN_URL, {
    code: String(code),
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  if (!res.ok) {
    const err = new Error('token exchange failed');
    err.code = await oauthError(res);
    throw err;
  }
  const body = await res.json();
  return {
    accessToken: body.access_token,
    expiresIn: Number(body.expires_in) || 3600,
    refreshToken: body.refresh_token || null,
    scope: String(body.scope || ''),
    email: body.id_token ? emailFromIdToken(body.id_token) : null,
  };
}

const aadFor = (userId) => `calendar:google:${userId}`;

/** In-memory access tokens: userId → { token, exp }. */
const accessCache = new Map();
const refreshing = new Map();

function cacheAccess(userId, token, expiresIn) {
  if (accessCache.size > 5000) {
    const now = Date.now();
    for (const [k, v] of accessCache) if (v.exp < now) accessCache.delete(k);
  }
  accessCache.set(String(userId), { token, exp: Date.now() + Math.max(60, expiresIn - 60) * 1000 });
}

export async function saveConnection(userId, tokens) {
  const uid = String(userId);
  const now = new Date();
  const existing = await queryOne('SELECT id FROM calendar_connections WHERE user_id = ?', [uid]);
  if (!tokens.refreshToken) {
    // prompt=consent should always yield one; without it there is nothing to
    // keep unless an earlier grant is still on file.
    if (!existing) {
      const err = new Error('no refresh token');
      err.code = 'no_refresh_token';
      throw err;
    }
    await query(
      'UPDATE calendar_connections SET scopes = ?, google_email = COALESCE(?, google_email), updated_at = ? WHERE user_id = ?',
      [tokens.scope.slice(0, 1000), tokens.email, now, uid],
    );
  } else {
    const enc = encryptSecret(tokens.refreshToken, aadFor(uid));
    await query(
      `INSERT INTO calendar_connections (user_id, provider, google_email, refresh_token_enc, scopes, created_at, updated_at)
       VALUES (?, 'google', ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE google_email = VALUES(google_email), refresh_token_enc = VALUES(refresh_token_enc),
         scopes = VALUES(scopes), updated_at = VALUES(updated_at)`,
      [uid, tokens.email, enc, tokens.scope.slice(0, 1000), now, now],
    );
  }
  if (tokens.accessToken) cacheAccess(uid, tokens.accessToken, tokens.expiresIn);
}

export async function getConnection(userId) {
  const row = await queryOne(
    'SELECT google_email, scopes, created_at, updated_at FROM calendar_connections WHERE user_id = ?',
    [String(userId)],
  );
  if (!row) return null;
  const scopes = String(row.scopes || '').split(/\s+/).filter(Boolean);
  return {
    email: row.google_email || null,
    scopes: { calendar: scopes.includes(SCOPE_CALENDAR), tasks: scopes.includes(SCOPE_TASKS) },
    connectedAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

async function forget(userId) {
  accessCache.delete(String(userId));
  await query('DELETE FROM calendar_connections WHERE user_id = ?', [String(userId)]);
}

const notConnected = () => new HttpError(409, 'calendar_not_connected', undefined, 'CALENDAR_NOT_CONNECTED');

async function refreshAccess(userId) {
  const uid = String(userId);
  const row = await queryOne('SELECT refresh_token_enc, scopes FROM calendar_connections WHERE user_id = ?', [uid]);
  if (!row) throw notConnected();

  let refreshToken;
  try {
    refreshToken = decryptSecret(row.refresh_token_enc, aadFor(uid));
  } catch {
    // Written under another master key or tampered with: unusable either way.
    logger.warn('calendar refresh token unreadable; dropping connection', { userId: uid });
    await forget(uid);
    throw notConnected();
  }

  const res = await postForm(TOKEN_URL, {
    client_id: clientId(),
    client_secret: clientSecret(),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  if (!res.ok) {
    const code = await oauthError(res);
    if (code === 'invalid_grant') {
      // Revoked at myaccount.google.com, expired, or password changed: the
      // grant is gone and the only fix is to connect again.
      await forget(uid);
      throw notConnected();
    }
    logger.warn('calendar token refresh failed', { userId: uid, error: code });
    throw new HttpError(502, 'calendar_upstream_error', undefined, 'CALENDAR_UPSTREAM');
  }
  const body = await res.json();
  cacheAccess(uid, body.access_token, Number(body.expires_in) || 3600);
  return body.access_token;
}

async function accessToken(userId, { force = false } = {}) {
  const uid = String(userId);
  const hit = accessCache.get(uid);
  if (!force && hit && hit.exp > Date.now()) return hit.token;
  if (!refreshing.has(uid)) {
    refreshing.set(uid, refreshAccess(uid).finally(() => refreshing.delete(uid)));
  }
  return refreshing.get(uid);
}

/** Revoke at Google (best effort) and delete the row. */
export async function disconnect(userId) {
  const uid = String(userId);
  const row = await queryOne('SELECT refresh_token_enc FROM calendar_connections WHERE user_id = ?', [uid]);
  if (!row) return false;
  try {
    const token = decryptSecret(row.refresh_token_enc, aadFor(uid));
    const res = await postForm(REVOKE_URL, { token });
    if (!res.ok && res.status !== 400) {
      logger.warn('calendar revoke failed', { userId: uid, status: res.status });
    }
  } catch (err) {
    logger.warn('calendar revoke skipped', { userId: uid, message: err.message });
  }
  await forget(uid);
  return true;
}

/* ============================================================ API calls */

async function googleFetch(userId, url, init = {}, scope = SCOPE_CALENDAR) {
  const conn = await getConnection(userId);
  if (!conn) throw notConnected();
  if (scope === SCOPE_CALENDAR && !conn.scopes.calendar) {
    throw new HttpError(403, 'calendar_scope_missing', undefined, 'CALENDAR_SCOPE_MISSING');
  }
  if (scope === SCOPE_TASKS && !conn.scopes.tasks) {
    throw new HttpError(403, 'tasks_scope_missing', undefined, 'TASKS_SCOPE_MISSING');
  }

  const send = (token) => fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
      authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });

  let res = await send(await accessToken(userId));
  if (res.status === 401) res = await send(await accessToken(userId, { force: true }));

  if (res.ok) return res.status === 204 ? null : res.json();

  let reason = '';
  try {
    const body = await res.json();
    reason = body?.error?.errors?.[0]?.reason || body?.error?.status || '';
  } catch { /* not JSON */ }
  if (res.status === 403 && /insufficient|scope|PERMISSION_DENIED/i.test(reason)) {
    throw new HttpError(403, 'calendar_scope_missing', undefined, 'CALENDAR_SCOPE_MISSING');
  }
  if (res.status === 403 && /accessNotConfigured|SERVICE_DISABLED/i.test(reason)) {
    logger.error('google api not enabled in the cloud project', { url: url.split('?')[0], reason });
  } else {
    logger.warn('google api call failed', { url: url.split('?')[0], status: res.status, reason });
  }
  if (res.status === 429 || /rateLimit/i.test(reason)) {
    throw new HttpError(429, 'calendar_rate_limited', undefined, 'CALENDAR_RATE_LIMITED');
  }
  throw new HttpError(502, 'calendar_upstream_error', undefined, 'CALENDAR_UPSTREAM');
}

export async function listEvents(userId, { timeMin, timeMax, maxResults = 100 }) {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(maxResults),
    fields: 'items(id,status,summary,description,location,start,end,hangoutLink,conferenceData(entryPoints(entryPointType,uri)),htmlLink,attendees(self,responseStatus),extendedProperties,organizer(email,displayName,self))',
  });
  const body = await googleFetch(userId, `${CALENDAR_API}/calendars/primary/events?${params}`);
  return body?.items || [];
}

export async function insertEvent(userId, resource, { withMeet }) {
  const params = new URLSearchParams({ sendUpdates: 'none' });
  if (withMeet) params.set('conferenceDataVersion', '1');
  return googleFetch(userId, `${CALENDAR_API}/calendars/primary/events?${params}`, {
    method: 'POST',
    body: JSON.stringify(resource),
  });
}

export async function listTasks(userId) {
  const params = new URLSearchParams({
    showCompleted: 'false',
    showHidden: 'false',
    maxResults: '50',
    fields: 'items(id,title,notes,due,status,webViewLink,updated)',
  });
  const body = await googleFetch(userId, `${TASKS_API}/lists/%40default/tasks?${params}`, {}, SCOPE_TASKS);
  return body?.items || [];
}

export async function insertTask(userId, resource) {
  return googleFetch(userId, `${TASKS_API}/lists/%40default/tasks`, {
    method: 'POST',
    body: JSON.stringify(resource),
  }, SCOPE_TASKS);
}
