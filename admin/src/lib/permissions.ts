import type { AdminRole } from '../store/auth';

/**
 * Transcribed from backend/src/routes/admin.js — the requireAdmin(...) role
 * list on each route. Buttons the current role cannot use are hidden, not
 * rendered disabled with no explanation.
 */
export type Action =
  | 'users.read' | 'users.write' | 'users.delete'
  | 'questions.read' | 'questions.write' | 'questions.delete'
  | 'categories.read' | 'categories.write' | 'categories.delete'
  | 'subscriptions.read' | 'subscriptions.cancel'
  | 'payments.read'
  | 'aiUsage.read'
  | 'reports.read' | 'reports.resolve'
  | 'settings.read' | 'settings.write'
  | 'integrations.read' | 'integrations.write'
  | 'admins.read' | 'admins.write'
  | 'audit.read'
  | 'analytics.read';

const ALL: AdminRole[] = ['super_admin', 'moderator', 'content_editor'];

const MATRIX: Record<Action, AdminRole[]> = {
  'analytics.read': ALL,
  'users.read': ALL,
  'users.write': ['super_admin', 'moderator'],
  'users.delete': ['super_admin'],
  'questions.read': ALL,
  'questions.write': ['super_admin', 'content_editor'],
  'questions.delete': ['super_admin', 'content_editor'],
  'categories.read': ALL,
  'categories.write': ['super_admin', 'content_editor'],
  'categories.delete': ['super_admin'],
  'subscriptions.read': ['super_admin'],
  'subscriptions.cancel': ['super_admin'],
  'payments.read': ['super_admin'],
  'aiUsage.read': ALL,
  'reports.read': ['super_admin', 'moderator'],
  'reports.resolve': ['super_admin', 'moderator'],
  'settings.read': ALL,
  'settings.write': ['super_admin'],
  'integrations.read': ['super_admin'],
  'integrations.write': ['super_admin'],
  'admins.read': ['super_admin'],
  'admins.write': ['super_admin'],
  'audit.read': ['super_admin'],
};

export function can(role: AdminRole | undefined | null, action: Action): boolean {
  if (!role) return false;
  return MATRIX[action].includes(role);
}

export const ROLE_LABEL_AR: Record<AdminRole, string> = {
  super_admin: 'مدير عام',
  moderator: 'مُشرف',
  content_editor: 'محرّر محتوى',
};

export interface PlanBearer {
  plan?: string | null;
  premiumUntil?: string | Date | null;
}

/**
 * Mirrors backend/src/services/quota.js: a `premium` row whose premiumUntil is
 * null or in the past is still rate-limited as free. The UI is never allowed
 * to assert a subscription state the server-side gate contradicts.
 */
export function effectivePlan(user: PlanBearer | null | undefined): 'free' | 'premium' | 'premium_expired' {
  if (!user || user.plan !== 'premium') return 'free';
  const until = user.premiumUntil ? new Date(user.premiumUntil) : null;
  if (until && !Number.isNaN(until.getTime()) && until.getTime() > Date.now()) return 'premium';
  return 'premium_expired';
}
