import { create } from 'zustand';
import { secureStorage } from '../storage/secureStorage';
import { api, AuthEvents } from '../api/client';

export interface AppUser {
  id: string;
  email: string;
  name: string;
  language: 'ar' | 'en';
  plan: 'free' | 'premium';
  dailyQuestionsUsed: number;
}

interface AuthState {
  user: AppUser | null;
  token: string | null;
  refreshToken: string | null;
  loading: boolean;
  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, language: 'ar' | 'en') => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

async function persistTokens(token: string | null, refreshToken: string | null) {
  if (token) await secureStorage.setItem('access_token', token);
  else await secureStorage.deleteItem('access_token');
  if (refreshToken) await secureStorage.setItem('refresh_token', refreshToken);
  else await secureStorage.deleteItem('refresh_token');
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  refreshToken: null,
  loading: false,

  hydrate: async () => {
    const token = await secureStorage.getItem('access_token');
    const refreshToken = await secureStorage.getItem('refresh_token');
    if (!token) return;
    set({ token, refreshToken });
    try {
      const { data } = await api.get('/user/me');
      set({ user: data.user });
    } catch {
      // Invalid token — clear it.
      await persistTokens(null, null);
      set({ token: null, refreshToken: null });
    }
  },

  login: async (email, password) => {
    set({ loading: true });
    try {
      const { data } = await api.post('/auth/login', { email, password });
      await persistTokens(data.token, data.refreshToken);
      set({ token: data.token, refreshToken: data.refreshToken, user: data.user });
    } finally {
      set({ loading: false });
    }
  },

  register: async (email, password, name, language) => {
    set({ loading: true });
    try {
      const { data } = await api.post('/auth/register', { email, password, name, language });
      await persistTokens(data.token, data.refreshToken);
      set({ token: data.token, refreshToken: data.refreshToken, user: data.user });
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    await persistTokens(null, null);
    set({ token: null, refreshToken: null, user: null });
  },

  refreshMe: async () => {
    const { token } = get();
    if (!token) return;
    const { data } = await api.get('/user/me');
    set({ user: data.user });
  },
}));

// Wire the 401 interceptor to the store.
AuthEvents.on401 = () => {
  useAuth.getState().logout().catch(() => {});
};
