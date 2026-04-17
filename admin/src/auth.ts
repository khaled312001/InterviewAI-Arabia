import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Admin {
  id: string;
  email: string;
  name: string;
  role: 'super_admin' | 'moderator' | 'content_editor';
}

interface AuthState {
  token: string | null;
  admin: Admin | null;
  login: (token: string, admin: Admin) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      admin: null,
      login: (token, admin) => {
        localStorage.setItem('admin_token', token);
        set({ token, admin });
      },
      logout: () => {
        localStorage.removeItem('admin_token');
        set({ token: null, admin: null });
      },
    }),
    { name: 'admin_auth' },
  ),
);
