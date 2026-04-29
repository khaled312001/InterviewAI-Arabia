import axios from 'axios';

// Frontend (this repo) and backend (InterviewAI-Arabia-Backend) deploy as
// separate Vercel projects. By default we hit the backend's Vercel URL
// from the absolute origin; same-origin /api stays available when the
// admin SPA is served from the legacy single-domain Hostinger box.
// Override via VITE_API_BASE_URL at build time.
const BACKEND_VERCEL = 'https://interviewai-arabia-backend.vercel.app/api';
const fallback =
  typeof window !== 'undefined' &&
  window.location?.hostname === 'intervie-ai-arabia.barmagly.tech'
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
    if (err.response?.status === 401) {
      localStorage.removeItem('admin_token');
      if (!window.location.pathname.endsWith('/login')) {
        window.location.href = '/admin/login';
      }
    }
    return Promise.reject(err);
  },
);
