import axios from 'axios';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { secureStorage } from '../storage/secureStorage';

const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined;
const configUrl = (Constants.expoConfig?.extra as any)?.apiBaseUrl as string | undefined;

// On web, default to a relative /api so the same-origin backend serves requests
// (the web bundle is served from the same subdomain as the API).
const webDefault = '/api';
const nativeDefault = 'https://intervie-ai-arabia.barmagly.tech/api';
export const API_BASE = envUrl || configUrl || (Platform.OS === 'web' ? webDefault : nativeDefault);

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
