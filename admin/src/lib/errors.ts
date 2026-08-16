import axios from 'axios';

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
      return { messageAr: 'تعذّر الاتصال بالخادم', code };
    }
    // A `code` means the backend chose this message deliberately (HttpError's
    // 4th argument) and it is already Arabic — e.g. CATEGORY_IN_USE says why
    // the delete was refused, which the generic 409 copy would erase.
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
