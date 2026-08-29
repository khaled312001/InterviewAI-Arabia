import axios from 'axios';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { secureStorage } from '../storage/secureStorage';

const envUrl = (process.env as Record<string, string | undefined>).EXPO_PUBLIC_API_BASE_URL;
const configUrl = (Constants.expoConfig?.extra as any)?.apiBaseUrl as string | undefined;

// Native builds have no origin to be relative to, so they need an absolute
// URL and this is the last-resort one. Web does NOT use it: every deployment
// this repo produces serves the API at `/api` on the page's own origin — the
// Hostinger box serves it directly, and the Vercel frontend project rewrites
// `/api/*` to the backend deployment (vercel.json at the repo root).
const BACKEND_FALLBACK = 'https://interprova.com/api';

let resolved: string;
if (envUrl) {
  resolved = envUrl;
} else if (Platform.OS === 'web') {
  // Relative, unconditionally. The previous version kept an allow-list of
  // "same-origin hosts" and sent every host that was not on it cross-origin to
  // a hardcoded backend URL — so a preview deploy, a renamed project or a new
  // custom domain silently left the origin and died in CORS, which on screen
  // is indistinguishable from the backend being down.
  resolved = '/api';
} else {
  // configUrl comes from app.json (extra.apiBaseUrl) and is how a native build
  // points at a specific backend without a rebuild-time env var.
  resolved = configUrl || BACKEND_FALLBACK;
}
export const API_BASE = resolved;

export const api = axios.create({ baseURL: API_BASE, timeout: 30000 });

/**
 * A per-install identifier, sent as `X-Install-Id`.
 *
 * The server claims the ten free trial minutes against it
 * (`trial_claims.claim_type = 'install'`), so a second account created on the
 * same install cannot collect a second trial. It is NOT a security control and
 * must not be described as one: reinstalling the app, clearing browser storage
 * or opening a private window produces a fresh id. It stops casual
 * double-dipping and nothing more.
 *
 * Deliberately not a device fingerprint — no hardware, network or advertising
 * identifier is read. It is a random value we generated ourselves, so it
 * carries nothing about the user beyond "this install".
 */
const INSTALL_ID_KEY = 'install_id';

function randomInstallId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  // Hermes ships without randomUUID on some builds. Uniqueness is all this
  // needs — it is a de-duplication key, never a secret.
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `iid_${Date.now().toString(36)}_${rand()}${rand()}`;
}

let installIdPromise: Promise<string | null> | null = null;

function installId(): Promise<string | null> {
  if (!installIdPromise) {
    installIdPromise = (async () => {
      try {
        const existing = await secureStorage.getItem(INSTALL_ID_KEY);
        if (existing) return existing;
        const fresh = randomInstallId();
        await secureStorage.setItem(INSTALL_ID_KEY, fresh);
        return fresh;
      } catch {
        // Storage unavailable (a locked keychain, a browser with storage
        // disabled). The header is simply omitted; the server treats a missing
        // install id as "no claim to record" and still grants the trial.
        return null;
      }
    })();
  }
  return installIdPromise;
}

api.interceptors.request.use(async (config) => {
  const token = await secureStorage.getItem('access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const iid = await installId();
  if (iid) config.headers['X-Install-Id'] = iid;
  return config;
});

/**
 * Session events the auth store listens for.
 *
 * `on401` means "this session is over" — the store clears it and the navigator
 * returns to the signed-out stack. `onTokens` is the opposite: a silent
 * renewal, so the store can keep its copy in step without anyone signing in
 * again.
 */
export const AuthEvents = {
  on401: () => {},
  onTokens: (_token: string, _refreshToken: string) => {},
};

/**
 * Endpoints where 401 is an ANSWER, not an expiry.
 *
 * `POST /auth/login` returns 401 for a wrong password, and `/auth/refresh`
 * returns 401 for a spent refresh token. Treating either as "the session
 * ended" is wrong in opposite directions: the first signs out a user who was
 * never signed in, and the second turns the renewal attempt into the very
 * logout it exists to prevent.
 */
const PRE_SESSION = /\/auth\/(login|register|google|refresh|forgot-password|reset-password)\b/;

/**
 * Renew the access token, at most once at a time.
 *
 * Why the single flight matters: a screen that fires three requests at once
 * gets three 401s at once, and without this each would refresh independently.
 * The server issues a NEW refresh token every time, so the second and third
 * would present one that the first had already replaced — and the last writer
 * would leave a token pair that does not match. They share one call instead.
 *
 * Returns the new access token, or null when the session is genuinely over.
 */
let refreshInFlight: Promise<string | null> | null = null;

function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const refreshToken = await secureStorage.getItem('refresh_token');
      if (!refreshToken) return null;
      // A bare axios call, NOT `api`: our own request interceptor would attach
      // the access token that just expired, and our response interceptor would
      // catch the resulting 401 and call this function again.
      const { data } = await axios.post(
        `${API_BASE}/auth/refresh`,
        { refreshToken },
        { timeout: 20000 },
      );
      if (!data?.token || !data?.refreshToken) return null;
      await secureStorage.setItem('access_token', data.token);
      await secureStorage.setItem('refresh_token', data.refreshToken);
      AuthEvents.onTokens(data.token, data.refreshToken);
      return data.token as string;
    } catch {
      // A refused refresh ends the session; a network failure does not, but we
      // cannot tell the caller to retry later, so it reports the same. The
      // caller only signs out on an actual 401 from the original request.
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/*
 * The access token lives fifteen minutes (backend: JWT_EXPIRES_IN=15m) and the
 * refresh token is issued beside it on every sign-in. Until now nothing ever
 * spent one: the app stored it and the client turned the first 401 into a full
 * sign-out. So a session ended a quarter of an hour after it began, and the
 * next launch showed the onboarding slides to someone who had signed in that
 * morning and never signed out.
 */
api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const status = err.response?.status;
    const original = err.config as (typeof err.config & { _retried?: boolean }) | undefined;
    if (status !== 401 || !original) return Promise.reject(err);

    // A 401 from a pre-session endpoint is that endpoint's own answer.
    if (PRE_SESSION.test(String(original.url || ''))) return Promise.reject(err);

    // One attempt per request. Without this a refresh that succeeds against a
    // server which still rejects the call would loop forever.
    if (original._retried) { AuthEvents.on401(); return Promise.reject(err); }
    original._retried = true;

    const fresh = await refreshAccessToken();
    if (!fresh) { AuthEvents.on401(); return Promise.reject(err); }

    original.headers = original.headers ?? {};
    (original.headers as Record<string, string>).Authorization = `Bearer ${fresh}`;
    return api(original);
  },
);
