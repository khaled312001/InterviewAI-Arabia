import axios from 'axios';
import { useAuth } from '../store/auth';
import { emitToast } from './toastBus';
import { parseApiError } from './errors';
import { API_BASE_URL } from './apiBase';

export const api = axios.create({ baseURL: API_BASE_URL });

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
