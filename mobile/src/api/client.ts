import axios from 'axios';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { secureStorage } from '../storage/secureStorage';

const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined;
const configUrl = (Constants.expoConfig?.extra as any)?.apiBaseUrl as string | undefined;

// On web, ALWAYS hit the same origin (`/api`) — whether the bundle is served
// from Vercel, Hostinger, or localhost. This keeps the deployment portable
// and avoids cross-origin traffic. Native apps still use the configured URL
// from app.json (or the env override) since they have no "current origin".
let resolved: string;
if (envUrl) {
  resolved = envUrl;
} else if (Platform.OS === 'web') {
  resolved = '/api';
} else {
  resolved = configUrl || 'https://intervie-ai-arabia.barmagly.tech/api';
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
