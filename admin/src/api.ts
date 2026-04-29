import axios from 'axios';

// Frontend on Vercel, backend on Hostinger — talk to the absolute API
// origin unless overridden via VITE_API_BASE_URL. Same-origin /api works
// only when the admin SPA is served from Hostinger itself.
const fallback =
  typeof window !== 'undefined' &&
  window.location?.hostname === 'intervie-ai-arabia.barmagly.tech'
    ? '/api'
    : 'https://intervie-ai-arabia.barmagly.tech/api';

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
    if (err.response?.status === 401) {
      localStorage.removeItem('admin_token');
      if (!window.location.pathname.endsWith('/login')) {
        window.location.href = '/admin/login';
      }
    }
    return Promise.reject(err);
  },
);
