import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Grid from '@mui/material/Grid2';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CampaignRounded from '@mui/icons-material/CampaignRounded';
import DevicesRounded from '@mui/icons-material/DevicesRounded';
import NotificationsActiveRounded from '@mui/icons-material/NotificationsActiveRounded';
import NotificationsOffRounded from '@mui/icons-material/NotificationsOffRounded';
import PersonRounded from '@mui/icons-material/PersonRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import type { GridColDef } from '@mui/x-data-grid';

import { DataTable } from '../components/common/DataTable';
import { Mono } from '../components/common/Mono';
import { Num } from '../components/common/Num';
import { PageHeader } from '../components/common/PageHeader';
import { RelativeTime } from '../components/common/RelativeTime';
import { SectionCard } from '../components/common/SectionCard';
import { StatCard } from '../components/common/StatCard';
import { StatusChip } from '../components/common/StatusChip';
import { chipCol, dateCol, numCol, textCol } from '../lib/columns';
import { parseApiError } from '../lib/errors';
import { can } from '../lib/permissions';
import { useAuth } from '../store/auth';
import { BroadcastDrawer } from '../features/push/BroadcastDrawer';
import {
  audienceLabel,
  kindLabel,
  usePushHistory,
  usePushOverview,
  useSendTestPush,
  type PushNotification,
} from '../features/push/api';

/**
 * Push: what can be sent, what was sent, and to how many devices.
 *
 * The page is built to fail loudly rather than quietly. If GET /push/overview
 * says `configured: false` there is no service account on the server and NOTHING
 * can be delivered, so compose is disabled and the page points at the credential
 * screen instead — an enabled compose form that cannot possibly send is a dead
 * button with a form attached, and the operator finds out after writing the
 * announcement. The same applies to `enabled: false`, which is a different
 * problem (someone switched sending off) with a different fix, so it gets its
 * own message rather than being folded into the first.
 */

/** One page of history. Small: this is a read-and-scan surface, not a report. */
const PAGE_SIZE = 25;

export function NotificationsPage() {
  const role = useAuth((s) => s.admin?.role);
  const canSend = can(role, 'push.send');

  const overview = usePushOverview();
  const [composing, setComposing] = useState(false);
  const [testing, setTesting] = useState(false);

  /**
   * Cursor paging, kept as a stack rather than a page number: the endpoint is
   * cursor-based, so "page 4" is not addressable — the only way back is the
   * cursor that produced each page.
   */
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.length > 0 ? cursors[cursors.length - 1] : null;
  const history = usePushHistory({ limit: PAGE_SIZE, cursor });

  const configured = overview.data?.configured ?? false;
  const enabled = overview.data?.enabled ?? false;
  const devices = overview.data?.devices;
  const rows = history.data?.notifications ?? [];
  const nextCursor = history.data?.nextCursor ?? null;

  // Retired tokens: registered once, then reported dead by FCM. Derived rather
  // than returned, and worth showing — a live count that keeps falling while
  // this one climbs is the shape of an app that stopped refreshing its tokens.
  const retired = devices ? Math.max(0, devices.total - devices.live) : undefined;

  const platforms = useMemo(
    () => Object.entries(devices?.byPlatform ?? {}).sort((a, b) => b[1] - a[1]),
    [devices],
  );

  const blockReason = !configured
    ? 'الإشعارات غير مهيّأة — اضبط مفتاح Firebase أولًا'
    : !enabled
      ? 'الإرسال موقوف من إعداد PUSH_ENABLED'
      : !canSend
        ? 'إرسال الإشعارات من صلاحيات المدير العام وحده'
        : null;
  const sendBlocked = Boolean(blockReason) || overview.isLoading || overview.isError;

  const columns = useMemo<GridColDef<PushNotification>[]>(
    () => [
      dateCol<PushNotification>({ field: 'createdAt', headerName: 'أُرسل', width: 165, mode: 'both' }),
      textCol<PushNotification>({
        field: 'titleAr',
        headerName: 'العنوان',
        flex: 1,
        minWidth: 220,
      }),
      chipCol<PushNotification>({
        field: 'audience',
        headerName: 'الفئة',
        kind: 'custom',
        tone: 'info',
        width: 140,
        getLabel: (row) => audienceLabel(row.audience),
        // A per-user row without the account it went to is unauditable.
        tooltip: (row) => (row.userId ? `المستخدم #${row.userId}` : undefined),
      }),
      chipCol<PushNotification>({
        field: 'kind',
        headerName: 'النوع',
        kind: 'custom',
        tone: 'neutral',
        width: 130,
        getLabel: (row) => kindLabel(row.kind),
        tooltip: (row) => row.kind,
      }),
      numCol<PushNotification>({ field: 'sentCount', headerName: 'وصل', width: 90 }),
      {
        field: 'failedCount',
        headerName: 'فشل',
        width: 90,
        type: 'number',
        align: 'left',
        headerAlign: 'left',
        // Not numCol: a failure count printed in the same ink as the success
        // count is a number nobody reads. Zero stays quiet, anything else does
        // not.
        renderCell: ({ value }) => (
          <Num
            value={value as number}
            variant="body2"
            color={(value as number) > 0 ? 'error.main' : 'text.disabled'}
          />
        ),
      },
      textCol<PushNotification>({ field: 'route', headerName: 'الشاشة', width: 140, mono: true }),
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="الإشعارات"
        description="إرسال إشعارات فورية إلى أجهزة المستخدمين، وسجل كل ما أُرسل."
        icon={<NotificationsActiveRounded />}
        meta={
          overview.data ? (
            <>
              <StatusChip
                kind="custom"
                value="state"
                label={configured ? (enabled ? 'الإرسال مفعّل' : 'الإرسال موقوف') : 'غير مهيّأ'}
                tone={configured ? (enabled ? 'success' : 'warning') : 'error'}
              />
              {overview.data.projectId && (
                <StatusChip
                  kind="custom"
                  value="project"
                  label={`مشروع Firebase: ${overview.data.projectId}`}
                  tone="neutral"
                />
              )}
            </>
          ) : undefined
        }
        actions={
          <>
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<RefreshRounded />}
              onClick={() => {
                void overview.refetch();
                void history.refetch();
              }}
              disabled={overview.isFetching || history.isFetching}
            >
              تحديث
            </Button>
            {canSend && (
              <Tooltip title={blockReason ?? ''}>
                <span>
                  <Button
                    variant="outlined"
                    color="inherit"
                    startIcon={<SendRounded />}
                    onClick={() => setTesting(true)}
                    disabled={sendBlocked}
                  >
                    إرسال تجريبي
                  </Button>
                </span>
              </Tooltip>
            )}
            {canSend && (
              <Tooltip title={blockReason ?? ''}>
                <span>
                  <Button
                    startIcon={<CampaignRounded />}
                    onClick={() => setComposing(true)}
                    disabled={sendBlocked}
                  >
                    إشعار جديد
                  </Button>
                </span>
              </Tooltip>
            )}
          </>
        }
      />

      {overview.isError && (
        <Alert severity="error">
          تعذّر قراءة حالة الإشعارات من الخادم — لا يمكن تأكيد أن الإرسال يعمل، ولذلك يبقى الإنشاء
          موقوفًا حتى ينجح التحديث.
        </Alert>
      )}

      {overview.data && !configured && (
        <Alert
          severity="warning"
          action={
            <Button component={RouterLink} to="/integrations/push" color="inherit" size="small">
              فتح صفحة التكامل
            </Button>
          }
        >
          <AlertTitle>الإشعارات غير مهيّأة بعد</AlertTitle>
          لا يوجد حساب خدمة Firebase على الخادم، فلا يمكن إرسال أي إشعار — ولا تصل الإشعارات
          التلقائية (انخفاض الرصيد، جاهزية التقييم) كذلك. اضبط المفتاح
          FIREBASE_SERVICE_ACCOUNT_B64 من صفحة «تكامل الإشعارات».
        </Alert>
      )}

      {overview.data && configured && !enabled && (
        <Alert
          severity="warning"
          action={
            <Button component={RouterLink} to="/integrations/push" color="inherit" size="small">
              تعديل الإعداد
            </Button>
          }
        >
          <AlertTitle>الإرسال موقوف</AlertTitle>
          المفتاح مضبوط لكن الإعداد PUSH_ENABLED موقوف، فيرفض الخادم كل إرسال — يدويًا كان أو
          تلقائيًا. فعّله من صفحة «تكامل الإشعارات» عندما تريد استئناف الإرسال.
        </Alert>
      )}

      <Grid container spacing={{ xs: 2, md: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            index={0}
            label="أجهزة يمكن الوصول إليها"
            value={devices?.live}
            icon={<DevicesRounded />}
            tone="brand"
            hint="الأجهزة الحيّة — وهي مدى أي إشعار عام"
            loading={overview.isLoading}
            error={overview.isError}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            index={1}
            label="مرتبطة بحساب"
            value={devices?.signedIn}
            icon={<PersonRounded />}
            tone="info"
            hint="وحدها تصلها الإشعارات المرتبطة بالاشتراك"
            loading={overview.isLoading}
            error={overview.isError}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            index={2}
            label="بدون تسجيل دخول"
            value={devices?.anonymous}
            icon={<NotificationsActiveRounded />}
            tone="neutral"
            hint="تصلها إشعارات «كل الأجهزة» فقط"
            loading={overview.isLoading}
            error={overview.isError}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            index={3}
            label="أجهزة متوقفة"
            value={retired}
            icon={<NotificationsOffRounded />}
            tone="warning"
            hint="أبلغ Firebase أن رمزها لم يعد صالحًا — حُذف التطبيق أو أُعيد ضبط الجهاز"
            loading={overview.isLoading}
            error={overview.isError}
          />
        </Grid>
      </Grid>

      {platforms.length > 0 && (
        <SectionCard
          title="الأجهزة حسب المنصّة"
          description="توزيع الأجهزة المسجّلة — بما فيها المتوقفة."
          dense
        >
          <Stack direction="row" gap={1} sx={{ flexWrap: 'wrap' }}>
            {platforms.map(([platform, count]) => (
              <StatusChip
                key={platform}
                kind="custom"
                value={platform}
                label={`${platform}: ${count}`}
                tone="neutral"
              />
            ))}
          </Stack>
        </SectionCard>
      )}

      <DataTable<PushNotification>
        rows={rows}
        columns={columns}
        query={history}
        // Cursor pagination: the grid never owns the page, so its footer would
        // be an inert control offering page numbers the endpoint cannot serve.
        paginationMode="none"
        errorTitle="تعذّر تحميل سجل الإشعارات"
        toolbar={
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            gap={1.5}
            alignItems={{ sm: 'center' }}
            justifyContent="space-between"
          >
            <Typography variant="subtitle2">
              سجل الإشعارات — الصفحة <Num value={cursors.length + 1} variant="subtitle2" />
            </Typography>
            <Stack direction="row" gap={1} alignItems="center">
              <Button
                variant="text"
                color="inherit"
                onClick={() => setCursors([])}
                disabled={cursors.length === 0 || history.isFetching}
              >
                الأحدث
              </Button>
              <Button
                variant="text"
                color="inherit"
                onClick={() => setCursors((c) => c.slice(0, -1))}
                disabled={cursors.length === 0 || history.isFetching}
              >
                السابق
              </Button>
              <Button
                variant="text"
                color="inherit"
                onClick={() => nextCursor && setCursors((c) => [...c, nextCursor])}
                disabled={!nextCursor || history.isFetching}
              >
                الأقدم
              </Button>
              {history.isFetching && <CircularProgress size={16} />}
            </Stack>
          </Stack>
        }
        empty={
          cursors.length > 0
            ? {
                variant: 'filtered',
                title: 'لا مزيد من الإشعارات',
                description: 'وصلت إلى نهاية السجل.',
                action: (
                  <Button variant="text" onClick={() => setCursors([])}>
                    العودة إلى الأحدث
                  </Button>
                ),
              }
            : {
                title: 'لم يُرسَل أي إشعار بعد',
                description:
                  'سيظهر هنا كل إشعار — سواء أرسلته يدويًا أو أرسله الخادم تلقائيًا — مع عدد الأجهزة التي وصله.',
                icon: <NotificationsActiveRounded />,
              }
        }
        renderMobileCard={(row) => (
          <Box sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
            <Stack gap={1}>
              <Typography variant="subtitle2">{row.titleAr}</Typography>
              <Typography variant="body2" color="text.secondary">
                {row.bodyAr}
              </Typography>
              <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
                <StatusChip
                  kind="custom"
                  value={row.audience}
                  label={audienceLabel(row.audience)}
                  tone="info"
                />
                <StatusChip kind="custom" value={row.kind} label={kindLabel(row.kind)} tone="neutral" />
                {row.route && <Mono value={row.route} variant="caption" />}
              </Stack>
              <Stack direction="row" gap={2} alignItems="center">
                <Typography variant="caption" color="text.secondary">
                  وصل <Num value={row.sentCount} variant="caption" />
                </Typography>
                <Typography
                  variant="caption"
                  color={row.failedCount > 0 ? 'error.main' : 'text.disabled'}
                >
                  فشل <Num value={row.failedCount} variant="caption" />
                </Typography>
              </Stack>
              <RelativeTime value={row.createdAt} mode="both" variant="caption" />
            </Stack>
          </Box>
        )}
      />

      <BroadcastDrawer open={composing} onClose={() => setComposing(false)} devices={devices} />
      <TestPushDialog open={testing} onClose={() => setTesting(false)} />
    </>
  );
}

/* ------------------------------- test send ------------------------------- */

/**
 * Why a refused test is rendered here instead of left to the global toast:
 * useSendTestPush declares its own `onError`, and lib/queryClient.ts stays
 * quiet whenever a mutation does that. Without this alert every refusal — no
 * service account, sending switched off, no linked device, rate limit — is a
 * dialog that just sits there after the spinner stops.
 *
 * The Arabic copy lives here because these codes carry English server messages
 * (admin.js) and lib/errors.ts has no entry for them; anything not listed falls
 * through to parseApiError, which is the right answer for a 429 or a dead
 * connection.
 */
const TEST_ERROR_AR: Record<string, string> = {
  PUSH_NOT_CONFIGURED:
    'لا يوجد حساب خدمة Firebase على الخادم — اضبط المفتاح من صفحة «تكامل الإشعارات» قبل الاختبار.',
  PUSH_DISABLED: 'الإرسال موقوف من الإعداد PUSH_ENABLED — فعّله من صفحة «تكامل الإشعارات».',
  NO_TEST_TARGET:
    'لا يوجد حساب مستخدم بالبريد الإداري نفسه — سجّل الدخول في التطبيق بهذا البريد، أو أدخِل رمز جهاز يدويًا.',
  NO_DEVICE_TOKEN:
    'الحساب المرتبط ببريدك لا يملك جهازًا حيًّا مسجّلًا — افتح التطبيق على الجهاز مرة واحدة ليسجّل رمزه، أو أدخِل رمز جهاز يدويًا.',
};

/**
 * Prove delivery without touching a customer.
 *
 * The token field is optional and exists for the case the panel cannot solve
 * otherwise: an admin account that is not linked to an app account has no
 * device of its own, so "send to me" has nothing to send to. Pasting the token
 * printed by the app is then the only way to test the pipeline at all.
 *
 * POST /push/test does NOT go through sendNotification(): it calls FCM directly
 * and writes no `notifications` row, deliberately, so a smoke test never lands
 * in the table that feeds every user's in-app inbox (see admin.js). Nothing
 * about a test therefore appears in the history on this page, and the copy must
 * not promise otherwise — an operator told the test is logged goes looking for
 * a row that will never exist and concludes the history is broken.
 */
function TestPushDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const test = useSendTestPush();
  const [token, setToken] = useState('');

  useEffect(() => {
    // A refusal left over from the previous attempt would greet the operator on
    // the next open as though this one had already failed.
    if (open) test.reset();
    // test.reset is stable; depending on it would wipe the error being read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const failure = test.error ? parseApiError(test.error) : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (test.isPending) return;
    // The delivery tally toast is raised by useSendTestPush; a refusal never
    // reaches a toast at all and is rendered in the dialog instead.
    test.mutate(
      { ...(token.trim() ? { token: token.trim() } : null) },
      {
        onSuccess: () => {
          setToken('');
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open={open} onClose={() => !test.isPending && onClose()} fullWidth maxWidth="sm">
      <Box component="form" onSubmit={submit}>
        <DialogTitle>إرسال تجريبي</DialogTitle>
        <DialogContent>
          <Stack gap={2} sx={{ pt: 1 }}>
            {failure && (
              <Alert severity="error">
                {(failure.code && TEST_ERROR_AR[failure.code]) || failure.messageAr}
              </Alert>
            )}
            <Typography variant="body2" color="text.secondary">
              يصل الإشعار إلى أجهزتك أنت فقط، ولا يراه أي مستخدم. ولا يظهر في سجل الإشعارات
              أدناه — الإرسال التجريبي لا يُكتب في السجل حتى لا يختلط بما أُرسل فعلًا إلى
              المستخدمين، ويبقى أثره في سجل التدقيق باسمك.
            </Typography>
            <TextField
              label="رمز الجهاز (اختياري)"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              inputProps={{ dir: 'ltr' }}
              placeholder="اتركه فارغًا للإرسال إلى أجهزة حسابك"
              helperText="رمز FCM الذي يطبعه التطبيق. استخدمه إذا لم يكن لحسابك الإداري حساب مستخدم مرتبط."
              autoComplete="off"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="inherit" onClick={onClose} disabled={test.isPending}>
            إلغاء
          </Button>
          <Button type="submit" disabled={test.isPending} sx={{ minWidth: 120 }}>
            {test.isPending ? <CircularProgress size={18} color="inherit" /> : 'إرسال تجريبي'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
