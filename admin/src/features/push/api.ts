import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { qk } from '../../lib/queryKeys';
import { emitToast } from '../../lib/toastBus';
import { countAr, type CountForms } from '../../lib/format';

/**
 * The admin half of push — /api/admin/push/*, super_admin only.
 *
 * Why this file rather than axios calls inside the page: a broadcast is the one
 * action in this panel whose blast radius is every install of the app and which
 * cannot be recalled once FCM has it. So the two things that decide whether the
 * operator is allowed to press send — whether push is configured at all, and
 * how many devices the chosen audience resolves to — are derived here, next to
 * the response shape they come from, instead of being re-guessed on each
 * surface. A count that disagrees with the page that sent it is worse than no
 * count.
 */

/** Mirrors AUDIENCES in backend/src/services/push/audience.js. */
export type PushAudience = 'all' | 'user' | 'subscribers' | 'trial' | 'recent';

/**
 * deviceCounts() from services/push/audience.js. `total` counts every row ever
 * registered; `live` excludes the tokens FCM has since declared dead. Only
 * `live` is a delivery estimate — `total` flatters the reach of a broadcast by
 * counting handsets that were uninstalled months ago.
 */
export interface DeviceCounts {
  total: number;
  live: number;
  byPlatform: Record<string, number>;
  signedIn: number;
  anonymous: number;
}

/**
 * A `notifications` row (migration 006). BigInt ids arrive stringified, like
 * every other id in this panel — a JS number would silently round them.
 */
export interface PushNotification {
  id: string;
  titleAr: string;
  bodyAr: string;
  titleEn: string | null;
  bodyEn: string | null;
  route: string | null;
  audience: string;
  userId: string | null;
  kind: string;
  sentCount: number;
  failedCount: number;
  createdBy: string | null;
  createdAt: string;
}

/**
 * GET /admin/push/overview.
 *
 * `configured` and `enabled` are two different refusals and are reported
 * separately on purpose: no service account means nothing can be sent by
 * anybody, while PUSH_ENABLED=false means an operator switched sending off. The
 * page has to say which one it is, because they need opposite fixes.
 */
export interface PushOverview {
  configured: boolean;
  enabled: boolean;
  projectId: string | null;
  devices: DeviceCounts;
  recent: PushNotification[];
}

/** What sendNotification() returns: one notifications row plus the FCM tally. */
export interface SendResult {
  id: string;
  total: number;
  sent: number;
  failed: number;
  dead: number;
}

export interface NotificationHistory {
  notifications: PushNotification[];
  /**
   * Cursor for the next (older) page. Absent or null means the history ends
   * here, and the pager hides its "older" control rather than offering a button
   * that re-serves the rows already on screen.
   */
  nextCursor?: string | null;
}

export interface BroadcastBody {
  titleAr: string;
  bodyAr: string;
  titleEn?: string;
  bodyEn?: string;
  route?: string;
  audience: PushAudience;
  /** Required by the server when audience === 'user'; ignored otherwise. */
  userId?: string;
  /**
   * The operator's own password, re-typed at the moment of sending.
   *
   * The route ends in requireStepUp(req), which reads this key straight off
   * req.body and answers 422 REAUTH_FAILED when it is missing — so a body
   * without it is refused after the copy has been written and reviewed, and
   * the operator reads "Password confirmation failed" beside a form that has
   * no password in it. Required rather than optional on purpose: a borrowed
   * session must not be enough to reach every install of the app, and an
   * optional field is the one a caller forgets.
   *
   * It does not survive the request. broadcastSchema in routes/admin.js is a
   * non-strict z.object, so the key is dropped before anything is sent and
   * never lands in `notifications`; SECRET_KEY in middleware/auditLog.js
   * matches /password/, so it cannot reach `admin_audit_logs` either.
   */
  currentPassword: string;
}

export interface TestPushBody {
  titleAr?: string;
  bodyAr?: string;
  /** Omitted: the server sends to every token of the admin's own linked user. */
  token?: string;
}

/* ------------------------------- queries ------------------------------- */

export function usePushOverview() {
  return useQuery({
    queryKey: qk.push.overview(),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<PushOverview>('/admin/push/overview', { signal });
      return data;
    },
    // Device counts move with every app launch. Short enough that the compose
    // form is not quoting yesterday's reach, long enough not to poll.
    staleTime: 60_000,
  });
}

export function usePushHistory(params: { limit: number; cursor: string | null }) {
  return useQuery({
    queryKey: qk.push.notifications(params),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<NotificationHistory>('/admin/push/notifications', {
        signal,
        params: { limit: params.limit, cursor: params.cursor || undefined },
      });
      return data;
    },
    // Rows stay on screen while the next cursor loads, so paging never blanks.
    placeholderData: keepPreviousData,
  });
}

/* ------------------------------ mutations ------------------------------ */

/** Arabic agreement for "جهاز" — see countAr in lib/format.ts. */
export const DEVICE_FORMS: CountForms = {
  one: 'جهاز واحد',
  two: 'جهازان',
  few: 'أجهزة',
  many: 'جهازًا',
};

/**
 * The outcome toast for a send.
 *
 * sent=0 is NOT a success, and this is the whole reason the helper exists:
 * POST /push/broadcast answers 200 whenever the row was written, even when
 * every token in the audience was dead. A green "تم الإرسال" over a delivery
 * count of zero is how an operator concludes the announcement went out.
 */
function reportSendResult(result: SendResult, emptyMessageAr: string) {
  const dead = result.dead > 0 ? ` — أُوقفت ${countAr(result.dead, DEVICE_FORMS)} متوقّفة` : '';

  if (result.total === 0) {
    emitToast({ severity: 'warning', message: emptyMessageAr });
    return;
  }
  if (result.sent === 0) {
    emitToast({
      severity: 'error',
      message: `لم يصل الإشعار إلى أي جهاز من ${countAr(result.total, DEVICE_FORMS)}${dead}`,
    });
    return;
  }
  if (result.failed > 0) {
    emitToast({
      severity: 'warning',
      message: `وصل إلى ${countAr(result.sent, DEVICE_FORMS)} وفشل مع ${countAr(result.failed, DEVICE_FORMS)}${dead}`,
    });
    return;
  }
  emitToast({
    severity: 'success',
    message: `تم إرسال الإشعار إلى ${countAr(result.sent, DEVICE_FORMS)}${dead}`,
  });
}

/**
 * POST /admin/push/broadcast.
 *
 * The body goes out verbatim, `currentPassword` included: the route re-checks
 * the operator's password against req.body itself, so filtering the field down
 * to the message fields here would turn every send into a 422.
 *
 * `onError` is declared so the global mutationCache toast stays quiet: the
 * compose drawer renders the failure inline, next to the copy that was refused,
 * and a toast on top of it would be the same message twice.
 */
export function useBroadcast() {
  const qc = useQueryClient();
  return useMutation<SendResult, unknown, BroadcastBody>({
    mutationFn: async (body) => (await api.post('/admin/push/broadcast', body)).data,
    onSuccess: (result) => {
      reportSendResult(
        result,
        'لا توجد أجهزة مطابقة لهذه الفئة — لم يُرسَل الإشعار إلى أحد.',
      );
      // A send writes a notifications row and may retire dead tokens, so both
      // the history and the device counts on the overview are stale.
      void qc.invalidateQueries({ queryKey: qk.push.all() });
    },
    onError: () => {},
  });
}

/**
 * POST /admin/push/test — one token, or every token of the admin's own linked
 * user. It exists so an operator can prove delivery works without sending
 * anything to customers; it still writes a notifications row, so the history
 * shows exactly what was sent and by whom.
 */
export function useSendTestPush() {
  const qc = useQueryClient();
  return useMutation<SendResult, unknown, TestPushBody>({
    mutationFn: async (body) => (await api.post('/admin/push/test', body)).data,
    onSuccess: (result) => {
      // A different empty case from a broadcast's: nothing was targeted because
      // the admin has no device of their own, which is a setup problem with a
      // fix, not an empty audience.
      reportSendResult(
        result,
        'لا يوجد جهاز مرتبط بحسابك — سجّل الدخول في التطبيق بالبريد نفسه، أو أدخِل رمز جهاز يدويًا.',
      );
      void qc.invalidateQueries({ queryKey: qk.push.all() });
    },
    onError: () => {},
  });
}

/* --------------------------------- copy --------------------------------- */

export interface AudienceOption {
  value: PushAudience;
  labelAr: string;
  help: string;
}

/** The five audiences the backend accepts, and what each one actually means. */
export const AUDIENCE_OPTIONS: AudienceOption[] = [
  {
    value: 'all',
    labelAr: 'كل الأجهزة',
    help: 'كل جهاز مسجّل وحيّ، بما في ذلك أجهزة لم يسجّل صاحبها الدخول بعد.',
  },
  {
    value: 'subscribers',
    labelAr: 'المشتركون',
    help: 'أجهزة أصحاب الاشتراك المميز الفعّال فقط.',
  },
  {
    value: 'trial',
    labelAr: 'المستخدمون المجانيون',
    help: 'أجهزة الحسابات التي لا تملك اشتراكًا فعّالًا.',
  },
  {
    value: 'recent',
    labelAr: 'النشطون مؤخرًا',
    help: 'أجهزة استُخدمت خلال المدة الأخيرة التي يحدّدها الخادم.',
  },
  {
    value: 'user',
    labelAr: 'مستخدم واحد',
    help: 'أجهزة حساب واحد تختاره — للاختبار أو للرد على شكوى بعينها.',
  },
];

export function audienceLabel(audience: string): string {
  return AUDIENCE_OPTIONS.find((o) => o.value === audience)?.labelAr ?? audience;
}

/**
 * `kind` on a notifications row: 'manual' for an operator broadcast, or the
 * event name for an automatic one. An unknown kind renders raw rather than as a
 * dash — a new automatic notifier must be visible in the history the day it
 * ships, not the day someone remembers to add it here.
 */
const KIND_LABEL_AR: Record<string, string> = {
  manual: 'يدوي',
  test: 'اختبار',
  low_balance: 'رصيد منخفض',
  evaluation_ready: 'التقييم جاهز',
  trial_reminder: 'تذكير بالتجربة',
};

export function kindLabel(kind: string): string {
  return KIND_LABEL_AR[kind] ?? kind;
}

export interface AudienceEstimate {
  /** null when the overview carries nothing to derive a number from. */
  count: number | null;
  /** False when `count` is an upper bound, not the delivery count. */
  exact: boolean;
  noteAr: string;
}

/**
 * How many devices the chosen audience will reach, from the counts the overview
 * already returns.
 *
 * The push contract has no per-audience count endpoint — only
 * deviceCounts() — so 'all' is the only audience whose number is exact. For the
 * account-filtered audiences the honest answer is the ceiling: they are a
 * subset of the signed-in devices and cannot be larger. This function never
 * dresses a bound up as a count, because the compose form quotes it in a
 * confirmation the operator is being asked to trust.
 */
export function audienceEstimate(
  audience: PushAudience,
  devices: DeviceCounts | undefined,
): AudienceEstimate {
  if (!devices) {
    return { count: null, exact: false, noteAr: 'تعذّر قراءة عدد الأجهزة.' };
  }

  switch (audience) {
    case 'all':
      return {
        count: devices.live,
        exact: true,
        noteAr: 'كل الأجهزة الحيّة المسجّلة، بما فيها أجهزة غير مسجّلي الدخول.',
      };
    case 'user':
      return {
        count: null,
        exact: false,
        noteAr: 'أجهزة الحساب المحدّد وحده — يحسبها الخادم عند الإرسال.',
      };
    default:
      return {
        count: devices.signedIn,
        exact: false,
        noteAr:
          'حدّ أعلى: هذه الفئة جزء من الأجهزة المرتبطة بحسابات، والعدد الفعلي يحسبه الخادم عند الإرسال وقد يكون أقل.',
      };
  }
}
