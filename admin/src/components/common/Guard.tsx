import { useAuth } from '../../store/auth';
import type { AdminRole } from '../../store/auth';
import { can, ROLE_LABEL_AR, type Action } from '../../lib/permissions';
import { ErrorState } from './ErrorState';

/** Hides a control the current role cannot use — never a disabled ghost. */
export function Can({ action, children }: { action: Action; children: React.ReactNode }) {
  const role = useAuth((s) => s.admin?.role);
  return can(role, action) ? <>{children}</> : null;
}

/** Whole-page gate: a forbidden route renders an explanation, never a blank grid. */
export function RequireRole({ roles, children }: { roles: AdminRole[]; children: React.ReactNode }) {
  const role = useAuth((s) => s.admin?.role);
  if (role && roles.includes(role)) return <>{children}</>;
  return (
    <ErrorState
      forbidden
      variant="page"
      requiredRole={roles.map((r) => ROLE_LABEL_AR[r]).join(' أو ')}
      currentRole={role ? ROLE_LABEL_AR[role] : undefined}
    />
  );
}
