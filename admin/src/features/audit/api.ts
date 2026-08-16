import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import type { AdminRole } from '../../store/auth';

export interface AuditAdmin {
  id: string;
  name: string | null;
  email: string | null;
  role: AdminRole | null;
}

export interface AuditLogEntry {
  id: string;
  adminId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  /** JSON string of the sanitised request body; secrets are stripped server-side. */
  metadata: string | null;
  ip: string | null;
  createdAt: string;
  /** null when the admin account has since been deleted. */
  admin: AuditAdmin | null;
}

export interface AuditResponse {
  logs: AuditLogEntry[];
  page: number;
  limit: number;
  total: number;
  facets: {
    actions: string[];
    entityTypes: string[];
    admins: Array<{ id: string; name: string | null; email: string | null }>;
  };
}

export interface AuditParams {
  page: number;
  limit: number;
  action: string;
  entityType: string;
  adminId: string;
  q: string;
}

export function useAuditQuery(params: AuditParams) {
  return useQuery({
    queryKey: qk.audit.list(params as unknown as Record<string, unknown>),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<AuditResponse>('/admin/audit', {
        signal,
        params: {
          page: params.page,
          limit: params.limit,
          action: params.action || undefined,
          entityType: params.entityType || undefined,
          adminId: params.adminId || undefined,
          q: params.q || undefined,
        },
      });
      return data;
    },
    placeholderData: (previous) => previous,
  });
}

/**
 * Actions are `resource.verb` strings written by middleware/auditLog.js. The
 * resource half is translated; an unknown verb falls through untranslated
 * rather than being dropped, so a newly added route is still readable.
 */
const RESOURCE_AR: Record<string, string> = {
  users: 'المستخدمون',
  questions: 'الأسئلة',
  categories: 'الأقسام',
  subscriptions: 'الاشتراكات',
  reports: 'البلاغات',
  admins: 'المدراء',
  settings: 'الإعدادات',
  integrations: 'التكاملات',
  payments: 'المدفوعات',
  auth: 'الدخول',
};

const VERB_AR: Record<string, string> = {
  create: 'إنشاء',
  update: 'تعديل',
  delete: 'حذف',
  resolve: 'معالجة',
  refund: 'إلغاء/استرداد',
  bulk: 'استيراد دفعة',
  login: 'تسجيل دخول',
  test: 'اختبار',
  // Written by hand rather than by the auto-audit middleware — the routes that
  // move entitlement or balance write their own row inside the transaction.
  grant: 'منح',
  revoke: 'إلغاء',
  clear: 'حذف الاعتماد',
  grant_minutes: 'منح دقائق',
  deduct_minutes: 'خصم دقائق',
};

export const ENTITY_TYPE_AR: Record<string, string> = {
  user: 'مستخدم',
  question: 'سؤال',
  category: 'قسم',
  subscription: 'اشتراك',
  report: 'بلاغ',
  admin: 'مدير',
  setting: 'إعداد',
  integration: 'تكامل',
  payment: 'دفعة',
  auth: 'دخول',
};

export function actionLabel(action: string): string {
  const [resource, ...verbParts] = action.split('.');
  const verb = verbParts.join('.');
  const resourceAr = RESOURCE_AR[resource] ?? resource;
  const verbAr = VERB_AR[verb] ?? verb;
  return `${verbAr} · ${resourceAr}`;
}

export type ActionTone = 'success' | 'error' | 'info' | 'warning' | 'neutral' | 'brand';

/** Destructive actions must be visually separable at a glance. */
export function actionTone(action: string): ActionTone {
  const verb = action.split('.').slice(1).join('.');
  if (verb === 'delete') return 'error';
  // Taking balance off a customer is not a routine edit, and it is the one
  // minute action nobody can undo from the panel.
  if (verb === 'deduct_minutes') return 'error';
  if (verb === 'refund' || verb === 'revoke') return 'warning';
  if (verb === 'grant' || verb === 'grant_minutes') return 'success';
  if (verb === 'create' || verb === 'bulk') return 'success';
  if (verb === 'resolve') return 'info';
  if (verb === 'login') return 'neutral';
  return 'brand';
}

export function prettyMetadata(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    return JSON.stringify(JSON.parse(metadata), null, 2);
  } catch {
    // Truncated payloads are stored with a trailing ellipsis and will not parse.
    return metadata;
  }
}
