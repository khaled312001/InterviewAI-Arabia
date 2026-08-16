import axios from 'axios';
import { API_BASE_URL, IS_CROSS_ORIGIN_API } from './apiBase';

export interface ParsedApiError {
  status?: number;
  messageAr: string;
  code?: string;
}

const BY_STATUS: Record<number, string> = {
  400: 'بيانات غير صالحة',
  401: 'انتهت الجلسة',
  403: 'ليس لديك صلاحية لهذا الإجراء',
  404: 'العنصر غير موجود',
  409: 'هذا العنصر موجود بالفعل',
  422: 'بيانات غير صالحة',
  429: 'محاولات كثيرة، حاول لاحقًا',
};

/**
 * Stable `code`s from backend HttpError. A code is more specific than its
 * status, so it wins: a 400 for "premium needs an expiry date" must not read
 * as the generic "بيانات غير صالحة".
 */
const BY_CODE: Record<string, string> = {
  PREMIUM_UNTIL_REQUIRED: 'منح الاشتراك المميز يتطلب تاريخ انتهاء في المستقبل',
  USER_HAS_REPORTS: 'لا يمكن حذف هذا المستخدم لأنه قدّم بلاغات — عطّل الحساب بدلًا من ذلك',
  // Deleting a user cascades to payments, subscriptions and the minute ledger,
  // so the server refuses it: revenue must not vanish from the payments page
  // with no reversing entry.
  USER_HAS_FINANCIAL_HISTORY:
    'لهذا الحساب سجل مالي (مدفوعات أو اشتراكات أو حركات رصيد) لا يجوز حذفه — أوقف الحساب بدلًا من ذلك',
  ENTITLEMENT_SUPER_ADMIN_ONLY: 'منح الاشتراك المميز أو إلغاؤه من صلاحيات المدير العام وحده',
  REASON_REQUIRED: 'اكتب سبب التغيير — يُحفظ في سجل التدقيق',
  UNKNOWN_PLAN_CODE: 'كود خطة غير معروف أو متوقف — اتركه فارغًا ليُسجَّل «يدوي»',
  // Deleting an admin cascades to admin_audit_logs, so an account that ever
  // acted can only be deactivated.
  ADMIN_HAS_AUDIT_TRAIL:
    'لهذا المدير سجل عمليات لا يجوز حذفه — عطّل الحساب بدلًا من حذفه',
  // Subscriptions. The server messages are bilingual ("عربي / English") because
  // they are also read by API clients; the operator sees the Arabic half only.
  USER_NOT_FOUND: 'المستخدم غير موجود',
  USER_DISABLED: 'الحساب موقوف — أعِد تفعيله قبل منح اشتراك',
  SUBSCRIPTION_NOT_FOUND: 'الاشتراك غير موجود — ربما حُدّث من جلسة أخرى',
  GRANT_DURATION_REQUIRED: 'حدّد المدة بالأيام أو تاريخ انتهاء — وليس كليهما',
  EXPIRY_CONFLICT: 'حدّد التمديد بالأيام أو تاريخ انتهاء جديدًا — وليس كليهما',
  EXPIRY_IN_PAST: 'تاريخ الانتهاء يجب أن يكون في المستقبل',
  GRANT_SHORTENS_ACCESS: 'التاريخ المطلوب أقصر من الاشتراك الحالي — استخدم تمديد الاشتراك أو إلغاءه',
  NOTHING_TO_UPDATE: 'لا يوجد أي تغيير لحفظه',
  UNKNOWN_PROVIDER: 'مزوّد غير معروف',
  ACTIVE_SUBSCRIPTION_EXISTS: 'لهذا المستخدم اشتراك فعّال — ألغِ الاشتراك من صفحة الاشتراكات بدلًا من تصفير الصلاحية هنا',
  SUBSCRIPTION_SHORTENING_BLOCKED: 'هذا سيقصّر اشتراكًا فعّالًا — استخدم تعديل الاشتراك أو إلغاءه',
  // POST /admin/users. The 409 also carries details.userId, which the create
  // drawer turns into a link to the account that already owns the address.
  EMAIL_TAKEN: 'هذا البريد الإلكتروني مسجّل بالفعل لحساب آخر',
  ADMIN_SELF_ACTION: 'لا يمكنك تعديل دورك أو حالتك أو حذف حسابك بنفسك',
  LAST_SUPER_ADMIN: 'لا يمكن خفض أو تعطيل أو حذف آخر مدير عام نشط',
  // Credential step-up: the backend answers 422 so the session interceptor does
  // not log the operator out mid-form. Without this entry it would read
  // "بيانات غير صالحة" and send them looking at the wrong field.
  REAUTH_FAILED: 'كلمة المرور غير صحيحة',
  UNKNOWN_CREDENTIAL: 'هذا المفتاح غير معروف',
  INVALID_CREDENTIAL_VALUE: 'القيمة غير صالحة لهذا الحقل',
  CRYPTO_UNAVAILABLE: 'التشفير غير مهيّأ على الخادم — لا يمكن حفظ الأسرار',
  NOT_STORED: 'لا توجد قيمة محفوظة لهذا المفتاح',
};

/**
 * Reads `data.error` first — that is the shape backend/src/middleware/errorHandler.js
 * actually returns; `data.message` is only a fallback for upstream proxies.
 */
export function parseApiError(err: unknown): ParsedApiError {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data as { error?: unknown; message?: unknown; code?: unknown } | undefined;
    const serverMessage =
      typeof data?.error === 'string' ? data.error
      : typeof data?.message === 'string' ? data.message
      : undefined;
    const code = typeof data?.code === 'string' ? data.code : undefined;

    if (!err.response) {
      // No response at all: DNS, TLS, a blocked CORS preflight, or the API
      // base pointing somewhere that is not the API. When the base is
      // cross-origin it is the most likely cause and also the one the generic
      // message hides completely, so name it — an operator seeing the host
      // they configured can tell "backend is down" from "backend is not here".
      return {
        messageAr: IS_CROSS_ORIGIN_API
          ? `تعذّر الاتصال بالخادم (${API_BASE_URL})`
          : 'تعذّر الاتصال بالخادم',
        code,
      };
    }
    // A known code has a translation here; codes whose backend message is
    // already Arabic fall through to it verbatim — e.g. CATEGORY_IN_USE says
    // why the delete was refused, which the generic 409 copy would erase.
    if (code && BY_CODE[code]) return { status, messageAr: BY_CODE[code], code };
    if (code && serverMessage) return { status, messageAr: serverMessage, code };
    if (status && BY_STATUS[status]) return { status, messageAr: BY_STATUS[status], code };
    if (status && status >= 500) return { status, messageAr: 'خطأ في الخادم', code };
    return { status, messageAr: serverMessage || 'حدث خطأ غير متوقع', code };
  }

  if (err instanceof Error && err.message) return { messageAr: err.message };
  return { messageAr: 'حدث خطأ غير متوقع' };
}

/**
 * The `details` object an HttpError carried (errorHandler.js re-emits it
 * verbatim). Used by the bulk importer to render per-row failures instead of a
 * single "validation failed".
 */
export function apiErrorPayload<T>(err: unknown): T | undefined {
  if (!axios.isAxiosError(err)) return undefined;
  const data = err.response?.data as { details?: unknown } | undefined;
  return (data?.details as T) ?? undefined;
}

/** The untranslated server detail, for the dev-only ErrorState disclosure. */
export function apiErrorDetails(err: unknown): string | undefined {
  if (!axios.isAxiosError(err)) return undefined;
  const data = err.response?.data;
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  return [err.response?.status, err.config?.method?.toUpperCase(), err.config?.url, body]
    .filter(Boolean)
    .join(' · ');
}
