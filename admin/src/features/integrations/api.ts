import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';

/** The `group` field of backend/src/services/secrets/registry.js. */
export type CredentialGroup = 'payments' | 'ai' | 'push';
export type CredentialType = 'secret' | 'text' | 'url' | 'path' | 'boolean' | 'select' | 'csv';

/**
 * Where the running backend reads this value from.
 * `error` means a row exists but could not be decrypted — reported as its own
 * state rather than collapsed into `unset`, because the two need opposite
 * responses from the operator.
 */
export type CredentialSource = 'db' | 'env' | 'unset' | 'error';

/**
 * Note what is NOT here: the value of a secret. GET /admin/integrations
 * returns `isSet`, `last4` and `source` for secrets and nothing else, so this
 * type cannot be widened into a leak by accident.
 */
export interface Credential {
  key: string;
  group: CredentialGroup;
  type: CredentialType;
  secret: boolean;
  options: string[] | null;
  testable: boolean;
  isSet: boolean;
  source: CredentialSource;
  /** Secrets only — the last four characters. */
  last4: string | null;
  /** Non-secret config only; always null for a secret. */
  value: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  updatedByName: string | null;
  updatedByEmail: string | null;
}

export interface IntegrationsResponse {
  credentials: Credential[];
  /** False when the server cannot derive its encryption key at all. */
  cryptoAvailable: boolean;
}

export interface ProbeResult {
  key: string;
  checkedAt: string;
  supported: boolean;
  ok: boolean;
  /** True only when the provider itself authenticated the value. */
  verified: boolean;
  code: string;
  status: number | null;
  /** The stored value was tested rather than a value typed into the form. */
  testedStored: boolean;
}

export function useIntegrationsQuery() {
  return useQuery({
    queryKey: qk.integrations.all(),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<IntegrationsResponse>('/admin/integrations', { signal });
      return data;
    },
    // Credentials are not polled: every read is a super_admin action and the
    // page is refreshed explicitly after a write.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * The body field is `credentialValue`, not `value`, on purpose: the admin audit
 * middleware redacts any body key matching /credential|secret|password|token/,
 * so even if the route stopped writing its own audit row the plaintext could
 * not reach `admin_audit_logs`.
 */
export function useSetCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { key: string; value: string; currentPassword: string }) => {
      const { data } = await api.put<IntegrationsResponse>(`/admin/integrations/${vars.key}`, {
        credentialValue: vars.value,
        currentPassword: vars.currentPassword,
      });
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(qk.integrations.all(), data);
    },
  });
}

export function useClearCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { key: string; currentPassword: string }) => {
      const { data } = await api.delete<IntegrationsResponse>(`/admin/integrations/${vars.key}`, {
        data: { currentPassword: vars.currentPassword },
      });
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(qk.integrations.all(), data);
    },
  });
}

/** Tests a value without saving it. The response never echoes what was sent. */
export function useTestCredential() {
  return useMutation({
    mutationFn: async (vars: { key: string; value?: string }) => {
      const { data } = await api.post<ProbeResult>(`/admin/integrations/${vars.key}/test`, {
        credentialValue: vars.value || undefined,
      });
      return data;
    },
  });
}

/** Arabic for a probe outcome. Derived from the code alone — never from a value. */
export function probeMessage(result: ProbeResult): { severity: 'success' | 'warning' | 'error'; text: string } {
  switch (result.code) {
    case 'ok':
      return { severity: 'success', text: 'تم التحقق من المفتاح لدى المزوّد بنجاح.' };
    case 'unauthorized':
      return { severity: 'error', text: 'رفض المزوّد هذا المفتاح — غير صالح أو تم إبطاله.' };
    case 'rate_limited':
      return {
        severity: 'warning',
        text: 'المفتاح صالح لكن المزوّد يطبّق حدًا للطلبات حاليًا.',
      };
    case 'reachable_only':
      return {
        severity: 'warning',
        text: 'الخادم يستجيب، لكن EasyKash لا توفّر وسيلة للتحقق من المفتاح دون إنشاء عملية دفع فعلية. لم يتم التحقق من صحة المفتاح.',
      };
    case 'unreachable':
      return { severity: 'error', text: 'تعذّر الوصول إلى خادم المزوّد.' };
    case 'no_base_url':
      return { severity: 'error', text: 'اضبط رابط الخادم الأساسي أولًا.' };
    case 'no_value':
      return { severity: 'error', text: 'لا توجد قيمة لاختبارها.' };
    case 'timeout':
      return { severity: 'error', text: 'انتهت مهلة الاتصال بالمزوّد.' };
    case 'network_error':
      return { severity: 'error', text: 'فشل الاتصال بالمزوّد.' };
    case 'provider_error':
      return { severity: 'warning', text: 'المزوّد يرد بخطأ داخلي — أعد المحاولة لاحقًا.' };
    case 'unsupported':
      return { severity: 'warning', text: 'لا يمكن اختبار هذا المفتاح تلقائيًا.' };
    default:
      return { severity: 'warning', text: 'رد غير متوقع من المزوّد.' };
  }
}
