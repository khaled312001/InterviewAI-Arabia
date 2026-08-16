import axios from 'axios';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { secureStorage } from '../storage/secureStorage';

const envUrl = (process.env as Record<string, string | undefined>).EXPO_PUBLIC_API_BASE_URL;
const configUrl = (Constants.expoConfig?.extra as any)?.apiBaseUrl as string | undefined;

// Two-repo architecture:
//   - Frontend (this) → Vercel project A: interview-ai-arabia.vercel.app
//   - Backend (sibling repo InterviewAI-Arabia-Backend)
//                       → Vercel project B: interviewai-arabia-backend.vercel.app
// Override the absolute URL via EXPO_PUBLIC_API_BASE_URL at build time, OR
// via Constants.expoConfig.extra.apiBaseUrl in app.json. Hostinger fallback
// stays available for the legacy single-domain deployment.
const BACKEND_VERCEL  = 'https://interview-ai-arabia-backend.vercel.app/api';
const HOSTINGER_API   = 'https://interview.khaledahmed.net/api';

// Single-domain hosts where the backend serves the web bundle AND the API
// from the same origin — there we always want the relative `/api`.
const SAME_ORIGIN_HOSTS = [
  'interview.khaledahmed.net',
  'intervie-ai-arabia.barmagly.tech',
];

let resolved: string;
if (envUrl) {
  resolved = envUrl;
} else if (Platform.OS !== 'web' && configUrl) {
  // configUrl from app.json is the native fallback (since native apps have
  // no current origin). On web we ignore it so same-origin/BACKEND_VERCEL win.
  resolved = configUrl;
} else if (
  Platform.OS === 'web'
  && typeof window !== 'undefined'
  && SAME_ORIGIN_HOSTS.includes(window.location?.hostname)
) {
  resolved = '/api';
} else {
  resolved = BACKEND_VERCEL;
}
export const API_BASE = resolved;

export const api = axios.create({ baseURL: API_BASE, timeout: 30000 });

api.interceptors.request.use(async (config) => {
  const token = await secureStorage.getItem('access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
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
