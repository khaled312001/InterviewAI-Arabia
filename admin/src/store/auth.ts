import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AdminRole = 'super_admin' | 'moderator' | 'content_editor';

export interface Admin {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
}

interface AuthState {
  token: string | null;
  admin: Admin | null;
  login: (token: string, admin: Admin) => void;
  /** Re-seed from GET /admin/auth/me so a role change lands on reload. */
  setAdmin: (admin: Admin) => void;
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
      setAdmin: (admin) => set({ admin }),
      logout: () => {
        localStorage.removeItem('admin_token');
        set({ token: null, admin: null });
      },
    }),
    { name: 'admin_auth' },
  ),
);
