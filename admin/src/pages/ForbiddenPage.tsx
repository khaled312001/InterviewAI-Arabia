import { useAuth } from '../store/auth';
import { ROLE_LABEL_AR } from '../lib/permissions';
import { ErrorState } from '../components/common/ErrorState';

export function ForbiddenPage() {
  const role = useAuth((s) => s.admin?.role);
  return <ErrorState forbidden variant="page" currentRole={role ? ROLE_LABEL_AR[role] : undefined} />;
}
