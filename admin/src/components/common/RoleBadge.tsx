import type { AdminRole } from '../../store/auth';
import { StatusChip } from './StatusChip';

export interface RoleBadgeProps {
  role: AdminRole | null | undefined;
  size?: 'small' | 'medium';
}

export function RoleBadge({ role, size = 'small' }: RoleBadgeProps) {
  if (!role) return null;
  return <StatusChip kind="role" value={role} size={size} />;
}
