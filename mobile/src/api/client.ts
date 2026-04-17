import axios from 'axios';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined;
const configUrl = (Constants.expoConfig?.extra as any)?.apiBaseUrl as string | undefined;
export const API_BASE = envUrl || configUrl || 'https://intervie-ai-arabia.barmagly.tech/api';

export const api = axios.create({ baseURL: API_BASE, timeout: 30000 });

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('access_token');
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
