import axios from 'axios';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { secureStorage } from '../storage/secureStorage';

const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined;
const configUrl = (Constants.expoConfig?.extra as any)?.apiBaseUrl as string | undefined;

// Architecture: frontend (admin + web) deploys to Vercel as static; backend
// (Express API + Prisma + MySQL) lives on Hostinger. The frontend therefore
// always calls the Hostinger origin cross-origin. Same-origin /api is used
// only when we're literally being served from Hostinger itself (legacy).
const HOSTINGER_API = 'https://intervie-ai-arabia.barmagly.tech/api';

let resolved: string;
if (envUrl) {
  resolved = envUrl;
} else if (
  Platform.OS === 'web'
  && typeof window !== 'undefined'
  && window.location?.hostname === 'intervie-ai-arabia.barmagly.tech'
) {
  resolved = '/api';
} else {
  resolved = configUrl || HOSTINGER_API;
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
