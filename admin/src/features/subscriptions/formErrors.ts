import { apiErrorPayload, parseApiError } from '../../lib/errors';
import { formatAbsolute, toDate } from '../../lib/format';

/** The form controls a subscription error can point at. */
export type SubscriptionField = 'user' | 'duration' | 'expiresAt' | 'planCode' | 'reason';

export type FieldErrors = Partial<Record<SubscriptionField, string>>;

/**
 * Which control each server error belongs to. Errors that describe the whole
 * request (SUBSCRIPTION_NOT_FOUND, NOTHING_TO_UPDATE) are deliberately absent:
 * they stay in FormDrawer's ApiErrorAlert, because pinning them to a field
 * would send the operator to correct the wrong thing.
 */
const CODE_FIELD: Record<string, SubscriptionField> = {
  USER_NOT_FOUND: 'user',
  USER_DISABLED: 'user',
  GRANT_DURATION_REQUIRED: 'duration',
  EXPIRY_CONFLICT: 'duration',
  EXPIRY_IN_PAST: 'expiresAt',
  GRANT_SHORTENS_ACCESS: 'expiresAt',
  // A code the catalogue retired ('yearly') or never had. The server refuses to
  // stamp it on a row rather than storing a product that cannot be bought.
  UNKNOWN_PLAN_CODE: 'planCode',
};

/**
 * zod field names (backend/src/routes/admin.js grantSchema /
 * subscriptionPatchSchema) mapped onto controls. The zod message itself is
 * English — errorHandler.js returns `err.flatten()` verbatim — so the Arabic
 * copy lives here rather than being passed through.
 */
const ZOD_FIELD: Record<string, { field: SubscriptionField; messageAr: string }> = {
  userId: { field: 'user', messageAr: 'اختر مستخدمًا' },
  days: { field: 'duration', messageAr: 'المدة يجب أن تكون بين يوم و٧٣٠ يومًا' },
  extendDays: { field: 'duration', messageAr: 'التمديد يجب أن يكون بين يوم و٧٣٠ يومًا' },
  expiresAt: { field: 'expiresAt', messageAr: 'تاريخ الانتهاء غير صالح' },
  planCode: { field: 'planCode', messageAr: 'كود خطة غير صالح' },
  reason: { field: 'reason', messageAr: 'اكتب سببًا من ٣ أحرف على الأقل — يُحفظ في سجل التدقيق' },
};

interface ShortensDetails {
  subscriptionId?: string;
  currentExpiresAt?: string;
}

/**
 * Turns a failed subscription write into per-field Arabic messages. Whatever it
 * does not claim stays visible in the drawer's error alert, so no failure is
 * ever swallowed by returning an empty map.
 */
export function subscriptionFieldErrors(err: unknown): FieldErrors {
  if (!err) return {};
  const out: FieldErrors = {};

  const zod = apiErrorPayload<{ fieldErrors?: Record<string, string[]> }>(err);
  for (const key of Object.keys(zod?.fieldErrors ?? {})) {
    const mapped = ZOD_FIELD[key];
    if (mapped && !out[mapped.field]) out[mapped.field] = mapped.messageAr;
  }

  const { code, messageAr } = parseApiError(err);
  const field = code ? CODE_FIELD[code] : undefined;
  if (field) {
    let text = messageAr;
    if (code === 'GRANT_SHORTENS_ACCESS') {
      const details = apiErrorPayload<ShortensDetails>(err);
      const current = toDate(details?.currentExpiresAt);
      if (current) text = `${messageAr} (ينتهي حاليًا ${formatAbsolute(current)})`;
    }
    out[field] = text;
  }

  return out;
}
