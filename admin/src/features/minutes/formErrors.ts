import { apiErrorPayload } from '../../lib/errors';

/** The controls a failed minute adjustment can point at. */
export type MinutesField = 'minutes' | 'reason' | 'amountEgp';

export type MinutesFieldErrors = Partial<Record<MinutesField, string>>;

/**
 * zod field names from `minutesAdjustSchema` in backend/src/routes/admin.js.
 * The zod message is English — errorHandler.js returns `err.flatten()` verbatim
 * — so the Arabic copy lives here rather than being passed through.
 */
const ZOD_FIELD: Record<string, { field: MinutesField; messageAr: string }> = {
  minutes: {
    field: 'minutes',
    messageAr: 'أدخل عددًا صحيحًا من الدقائق بين ١ و٦٠٠٠',
  },
  reason: {
    field: 'reason',
    messageAr: 'اكتب سببًا من ٣ أحرف على الأقل — يُحفظ في سجل التدقيق',
  },
  amountEgp: {
    field: 'amountEgp',
    messageAr: 'مبلغ غير صالح',
  },
};

/**
 * Turns a failed adjustment into per-field Arabic messages. Anything it does
 * not claim stays visible in the drawer's error alert, so no failure is
 * swallowed by returning an empty map.
 *
 * USER_DISABLED is deliberately not mapped to a field: it is a fact about the
 * account, not about anything the operator typed, and pinning it under the
 * minutes box would send them to change the wrong thing. The drawer states it
 * inline next to the account instead.
 */
export function minutesFieldErrors(err: unknown): MinutesFieldErrors {
  if (!err) return {};
  const out: MinutesFieldErrors = {};

  const zod = apiErrorPayload<{ fieldErrors?: Record<string, string[]> }>(err);
  for (const key of Object.keys(zod?.fieldErrors ?? {})) {
    const mapped = ZOD_FIELD[key];
    if (mapped && !out[mapped.field]) out[mapped.field] = mapped.messageAr;
  }

  return out;
}
