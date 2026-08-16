import axios from 'axios';
import { useAuth } from '../store/auth';
import { emitToast } from './toastBus';
import { parseApiError } from './errors';

// Frontend (this repo) and backend (InterviewAI-Arabia-Backend) deploy as
// separate Vercel projects. By default we hit the backend's Vercel URL
// from the absolute origin; same-origin /api stays available when the
// admin SPA is served from the legacy single-domain Hostinger box.
// Override via VITE_API_BASE_URL at build time.
const BACKEND_VERCEL = 'https://interview-ai-arabia-backend.vercel.app/api';
const SAME_ORIGIN_HOSTS = [
  'interview.khaledahmed.net',
  'intervie-ai-arabia.barmagly.tech',
];
const fallback =
  typeof window !== 'undefined' && SAME_ORIGIN_HOSTS.includes(window.location?.hostname)
    ? '/api'
    : BACKEND_VERCEL;

const baseURL = import.meta.env.VITE_API_BASE_URL || fallback;

export const api = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err.response?.status;

    if (status === 401) {
      // Clear BOTH stores: the persisted zustand copy used to survive the
      // token and keep rendering the whole shell after a revoke.
      useAuth.getState().logout();
      const loginUrl = `${import.meta.env.BASE_URL}login`;
      if (!window.location.pathname.endsWith('/login')) {
        window.location.href = loginUrl;
      }
    }

    // 403 never redirects — it surfaces, so RBAC stops being invisible.
    if (status === 403) {
      emitToast({ message: parseApiError(err).messageAr, severity: 'error' });
    }

    return Promise.reject(err);
  },
);
