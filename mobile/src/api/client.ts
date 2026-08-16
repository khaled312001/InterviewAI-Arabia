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
const BACKEND_FALLBACK = 'https://interview.khaledahmed.net/api';

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

// Simple 401 handler — the auth store listens for this event and resets.
export const AuthEvents = { on401: () => {} };
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) AuthEvents.on401();
    return Promise.reject(err);
  },
);
