import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { useAuth, type Admin } from '../../store/auth';
import { AppSkeleton } from '../common/Skeletons';

/**
 * The sole consumer of GET /admin/auth/me. Without it a persisted token
 * renders the whole shell forever, even after the admin was revoked or
 * demoted server-side.
 */
export function SessionBoot({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const token = useAuth((s) => s.token);
  const setAdmin = useAuth((s) => s.setAdmin);
  const logout = useAuth((s) => s.logout);

  const meQ = useQuery({
    queryKey: qk.auth.me(),
    queryFn: async () => (await api.get<{ admin: Admin }>('/admin/auth/me')).data.admin,
    enabled: Boolean(token),
    staleTime: 5 * 60_000,
    retry: false,
  });

  useEffect(() => {
    if (meQ.data) setAdmin(meQ.data);
  }, [meQ.data, setAdmin]);

  useEffect(() => {
    if (meQ.isError) logout();
  }, [meQ.isError, logout]);

  if (!token) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (meQ.isPending) return <AppSkeleton />;
  if (meQ.isError) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
