import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { FormDrawer } from '../../components/common/FormDrawer';
import { Num } from '../../components/common/Num';
import { StatusChip } from '../../components/common/StatusChip';
import { useConfirm } from '../../components/common/ConfirmDialog';
import { useDebouncedValue } from '../../lib/hooks/useDebouncedValue';
import { countAr } from '../../lib/format';
import { effectivePlan } from '../../lib/permissions';
import { useUserSearch } from '../subscriptions/api';
import type { AdminUser } from '../users/types';
import {
  AUDIENCE_OPTIONS,
  DEVICE_FORMS,
  audienceEstimate,
  useBroadcast,
  type BroadcastBody,
  type DeviceCounts,
  type PushAudience,
} from './api';

/**
 * Compose and send a push broadcast.
 *
 * This is the most dangerous form in the panel: one submit reaches every
 * install of the app at once, arrives on a lock screen, and cannot be recalled,
 * edited or deleted afterwards. Three things follow from that and are not
 * cosmetic:
 *
 *  1. Sending is a SECOND step. The compose fields never sit next to a live
 *     "send" button, so no single click can start a broadcast.
 *  2. The review step states the resolved recipient count, and says plainly
 *     when that number is an upper bound rather than the delivery count —
 *     see audienceEstimate() for why 'all' is the only exact one.
 *  3. The confirmation makes the operator type the audience code. A dialog you
 *     can dismiss with the Enter key is not a confirmation.
 *
 * The field limits below are the column widths in migration 006. Typing past
 * them would be refused by MySQL, so the fields stop instead — a broadcast that
 * fails on the round trip after the operator has already confirmed it is the
 * worst possible place to discover a length limit.
 */

const TITLE_MAX = 200;
const BODY_MAX = 500;

/* --------------------------- deep-link screens --------------------------- */

/**
 * The screens a tap may open, and why this list is shorter than the backend's.
 *
 * services/push/notify.js accepts thirteen route names and DROPS anything it
 * does not recognise: the message still goes out, it just opens the app on its
 * default screen. Nothing reports that. The server writes one log line, the
 * device shows a notification that looks entirely normal, and the mistake is
 * visible only to the user who taps it and gets nothing. A free-text box in
 * front of a silent allow-list is a trap, so this is a closed list.
 *
 * Five of the backend's thirteen are dead when they come from THIS form and are
 * deliberately absent:
 *   - Interview, Feedback and Meeting are refused by the client itself
 *     (PUSH_STACK_ROUTES in mobile/src/push/usePushNotifications.ts). They take
 *     a live session and its first question as params and cannot be rebuilt
 *     from a data payload.
 *   - SessionSummary and CategoryDetails need data.sessionId / data.categoryId,
 *     and pushParams() returns null — meaning do not navigate at all — when
 *     they are missing. broadcastSchema carries no `data` field, so an operator
 *     has no way to attach either.
 * What is left is the eight screens that open unaccompanied.
 *
 * The labels are the screens' own Arabic titles in the app (mobile/src/i18n/
 * ar.ts) rather than paraphrases: the operator is choosing a screen a user will
 * recognise. Every value fits notifications.route — VARCHAR(64) in migration
 * 006 — so the column width is not a limit any choice here can reach.
 */
const ROUTE_OPTIONS: { value: string; labelAr: string }[] = [
  { value: 'Home', labelAr: 'الرئيسية' },
  { value: 'History', labelAr: 'السجل' },
  { value: 'Stats', labelAr: 'الإحصائيات' },
  { value: 'Profile', labelAr: 'الملف الشخصي' },
  { value: 'Subscription', labelAr: 'الرصيد والباقات' },
  { value: 'Ledger', labelAr: 'كشف حساب الدقائق' },
  { value: 'Settings', labelAr: 'الإعدادات' },
  { value: 'MeetingSetup', labelAr: 'إعداد المقابلة' },
];

type Step = 'compose' | 'review';

export interface BroadcastDrawerProps {
  open: boolean;
  onClose: () => void;
  /** From GET /push/overview — the only source of a recipient count. */
  devices: DeviceCounts | undefined;
}

export function BroadcastDrawer({ open, onClose, devices }: BroadcastDrawerProps) {
  const confirm = useConfirm();
  const broadcast = useBroadcast();

  const [step, setStep] = useState<Step>('compose');
  const [audience, setAudience] = useState<PushAudience>('all');
  const [user, setUser] = useState<AdminUser | null>(null);
  const [search, setSearch] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [bodyAr, setBodyAr] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [route, setRoute] = useState('');
  /**
   * Re-typed at the moment of sending, never stored. The route ends in
   * requireStepUp(), so a body without it is refused 422 REAUTH_FAILED after
   * the copy has been written and reviewed. It is asked for on the review step
   * rather than the compose step on purpose: it is the last thing you do before
   * an unrecallable action, not a field you fill in and forget while writing.
   */
  const [password, setPassword] = useState('');

  const debouncedSearch = useDebouncedValue(search, 300);
  const userQuery = useUserSearch(debouncedSearch, open && audience === 'user');

  useEffect(() => {
    if (!open) return;
    setStep('compose');
    setAudience('all');
    setUser(null);
    setSearch('');
    setTitleAr('');
    setBodyAr('');
    setTitleEn('');
    setBodyEn('');
    setRoute('');
    setPassword('');
    broadcast.reset();
    // broadcast.reset is stable; re-running on every render would wipe the
    // server error the operator is reading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const estimate = audienceEstimate(audience, devices);
  const option = AUDIENCE_OPTIONS.find((o) => o.value === audience);

  /**
   * The English copy is all-or-nothing. notify.js falls back to the Arabic
   * copy field by field, so a title in English over a body in Arabic is a real
   * deliverable outcome — and it lands on the device of the one reader who
   * cannot read half of it.
   */
  const englishHalfDone =
    (titleEn.trim().length > 0) !== (bodyEn.trim().length > 0);

  const missingUser = audience === 'user' && !user;
  const noRecipients = estimate.count === 0;

  const blocked =
    titleAr.trim().length === 0 ||
    bodyAr.trim().length === 0 ||
    englishHalfDone ||
    missingUser ||
    noRecipients ||
    // Only on the review step: the password field does not exist while
    // composing, and disabling "مراجعة" for a field the operator cannot see is
    // the dead-button failure this drawer already avoids elsewhere.
    (step === 'review' && password.length === 0);

  const dirty = Boolean(titleAr || bodyAr || titleEn || bodyEn || route || user);

  function buildBody(): BroadcastBody {
    return {
      titleAr: titleAr.trim(),
      bodyAr: bodyAr.trim(),
      audience,
      ...(titleEn.trim() ? { titleEn: titleEn.trim() } : null),
      ...(bodyEn.trim() ? { bodyEn: bodyEn.trim() } : null),
      ...(route.trim() ? { route: route.trim() } : null),
      ...(audience === 'user' && user ? { userId: user.id } : null),
      currentPassword: password,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (blocked || broadcast.isPending) return;

    if (step === 'compose') {
      setStep('review');
      return;
    }

    const recipients =
      estimate.count === null
        ? 'أجهزة هذا الحساب'
        : estimate.exact
          ? countAr(estimate.count, DEVICE_FORMS)
          : `ما يصل إلى ${countAr(estimate.count, DEVICE_FORMS)}`;

    const ok = await confirm({
      title: 'إرسال الإشعار الآن؟',
      description: `سيصل «${titleAr.trim()}» إلى ${recipients} ضمن فئة «${option?.labelAr ?? audience}».`,
      confirmLabel: 'إرسال',
      cancelLabel: 'تراجع',
      tone: 'danger',
      consequences: [
        'لا يمكن التراجع عن الإرسال ولا سحب الإشعار بعد وصوله إلى الأجهزة.',
        'يظهر الإشعار على شاشة القفل فورًا — لا يوجد جدولة ولا إرسال لاحق.',
        estimate.exact
          ? 'العدد أعلاه هو عدد الأجهزة الحيّة الآن؛ قد يتغيّر بجهاز أو اثنين حتى لحظة الإرسال.'
          : 'العدد أعلاه حدّ أعلى — الخادم يحسب المستقبِلين فعليًا عند الإرسال.',
        'يُسجَّل الإشعار في السجل باسمك مع عدد ما وصل وما فشل.',
      ],
      // Typing the audience code — not the count. For كل الفئات عدا «الكل» the
      // number is a ceiling, and asking an operator to type a figure that is
      // not the real recipient count teaches them to ignore it. One account is
      // exempt: it is not a broadcast.
      requireTypedConfirmation: audience === 'user' ? undefined : audience,
      // The mutation runs after the dialog closes, so a server refusal lands in
      // the drawer beside the copy that was refused instead of as a toast.
      onConfirm: () => {},
    });
    if (!ok) return;

    // The result toast (including "sent to zero devices") is raised by
    // useBroadcast — it is the same sentence wherever a send happens.
    broadcast.mutate(buildBody(), { onSuccess: () => onClose() });
  }

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title={step === 'compose' ? 'إشعار جديد' : 'مراجعة قبل الإرسال'}
      subtitle={
        step === 'compose'
          ? 'يُرسَل فورًا إلى أجهزة الفئة المختارة'
          : 'اقرأ العدد والنص كما سيصل إلى الأجهزة'
      }
      mode="create"
      onSubmit={handleSubmit}
      submitting={broadcast.isPending}
      submitLabel={step === 'compose' ? 'مراجعة' : 'إرسال الآن'}
      disabled={blocked}
      error={broadcast.error}
      dirty={dirty && !broadcast.isPending}
      closeConfirm={{
        title: 'تجاهل الإشعار؟',
        description: 'لم يُرسَل شيء بعد، وسيُفقد النص الذي كتبته.',
      }}
      footerStart={
        step === 'review' ? (
          <Button variant="text" color="inherit" onClick={() => setStep('compose')} disabled={broadcast.isPending}>
            تعديل النص
          </Button>
        ) : undefined
      }
      noValidate
    >
      {step === 'review' ? (
        <ReviewStep
          audienceLabelAr={option?.labelAr ?? audience}
          audienceHelp={option?.help ?? ''}
          estimateCount={estimate.count}
          estimateExact={estimate.exact}
          estimateNote={estimate.noteAr}
          userEmail={user?.email ?? null}
          titleAr={titleAr.trim()}
          bodyAr={bodyAr.trim()}
          titleEn={titleEn.trim()}
          bodyEn={bodyEn.trim()}
          route={route.trim()}
        />
      ) : null}

      {step === 'review' && (
        <TextField
          type="password"
          label="أكّد كلمة مرورك"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          disabled={broadcast.isPending}
          required
          helperText="مطلوبة لأن هذا الإشعار يصل إلى أجهزة المستخدمين ولا يمكن سحبه."
          inputProps={{ dir: 'ltr', style: { textAlign: 'start' } }}
        />
      )}

      {step === 'compose' && (
        <>
          <TextField
            select
            label="الفئة المستهدفة"
            value={audience}
            onChange={(e) => {
              setAudience(e.target.value as PushAudience);
              setUser(null);
            }}
            helperText={option?.help}
          >
            {AUDIENCE_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.labelAr}
              </MenuItem>
            ))}
          </TextField>

          {audience === 'user' && (
            <Autocomplete<AdminUser>
              options={userQuery.data?.users ?? []}
              value={user}
              onChange={(_e, value) => setUser(value)}
              onInputChange={(_e, value, changeReason) => {
                if (changeReason !== 'reset') setSearch(value);
              }}
              filterOptions={(options) => options}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              getOptionLabel={(o) => o.email}
              loading={userQuery.isFetching}
              noOptionsText={search ? 'لا مستخدم مطابق' : 'اكتب بريدًا أو اسمًا للبحث'}
              renderOption={(props, o) => {
                const { key, ...rest } = props as React.HTMLAttributes<HTMLLIElement> & { key: string };
                return (
                  <Box component="li" key={key} {...rest}>
                    <Stack gap={0.25} sx={{ minWidth: 0 }}>
                      <Stack direction="row" gap={1} alignItems="center">
                        <Typography variant="body2" noWrap>
                          {o.email}
                        </Typography>
                        <StatusChip kind="plan" value={effectivePlan(o)} />
                      </Stack>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {o.name}
                      </Typography>
                    </Stack>
                  </Box>
                );
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="المستخدم"
                  placeholder="ابحث بالبريد أو الاسم…"
                  required
                  helperText="يصل الإشعار إلى كل أجهزة هذا الحساب المسجّلة"
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {userQuery.isFetching ? <CircularProgress size={16} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />
          )}

          <RecipientSummary
            labelAr={option?.labelAr ?? audience}
            count={estimate.count}
            exact={estimate.exact}
            note={estimate.noteAr}
          />

          <GroupLabel>النص العربي — إلزامي</GroupLabel>

          <TextField
            label="العنوان"
            value={titleAr}
            onChange={(e) => setTitleAr(e.target.value)}
            required
            inputProps={{ maxLength: TITLE_MAX }}
            helperText={<Remaining used={titleAr.length} max={TITLE_MAX} />}
          />

          <TextField
            label="النص"
            value={bodyAr}
            onChange={(e) => setBodyAr(e.target.value)}
            required
            multiline
            minRows={3}
            inputProps={{ maxLength: BODY_MAX }}
            helperText={<Remaining used={bodyAr.length} max={BODY_MAX} />}
          />

          <GroupLabel>النص الإنجليزي — اختياري</GroupLabel>

          <TextField
            label="Title (English)"
            value={titleEn}
            onChange={(e) => setTitleEn(e.target.value)}
            inputProps={{ maxLength: TITLE_MAX, dir: 'ltr' }}
            error={englishHalfDone}
            helperText={
              englishHalfDone ? (
                'اكتب العنوان والنص الإنجليزيين معًا أو اتركهما فارغين'
              ) : (
                <Remaining used={titleEn.length} max={TITLE_MAX} />
              )
            }
          />

          <TextField
            label="Body (English)"
            value={bodyEn}
            onChange={(e) => setBodyEn(e.target.value)}
            multiline
            minRows={2}
            inputProps={{ maxLength: BODY_MAX, dir: 'ltr' }}
            error={englishHalfDone}
            helperText={
              englishHalfDone ? (
                'اكتب العنوان والنص الإنجليزيين معًا أو اتركهما فارغين'
              ) : (
                <Remaining used={bodyEn.length} max={BODY_MAX} />
              )
            }
          />

          <Alert severity="info">
            الأجهزة تُجمَّع حسب لغتها ويُرسَل لكل مجموعة نسختها. الجهاز الذي لغته الإنجليزية يتلقّى
            النص العربي إن تركت النسخة الإنجليزية فارغة.
          </Alert>

          <TextField
            select
            label="الشاشة التي يفتحها الضغط (اختياري)"
            value={route}
            onChange={(e) => setRoute(e.target.value)}
            helperText="القائمة تقتصر على الشاشات التي تُفتح وحدها. شاشات مثل المقابلة أو ملخّص الجلسة تحتاج بيانات جلسة لا يحملها الإشعار العام، فالضغط عليها لا يفعل شيئًا."
          >
            <MenuItem value="">بدون — يفتح الإشعار التطبيق فقط</MenuItem>
            {ROUTE_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.labelAr}
              </MenuItem>
            ))}
          </TextField>
        </>
      )}
    </FormDrawer>
  );
}

/* ------------------------------ review step ------------------------------ */

/**
 * A section rule inside the form. Divider's own `textAlign` takes physical
 * 'left'/'right' values that stylis-plugin-rtl then flips again, so the label
 * is a sibling rather than a child — direction-neutral by construction.
 */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <Stack gap={1}>
      <Divider />
      <Typography variant="caption" color="text.secondary">
        {children}
      </Typography>
    </Stack>
  );
}

function Remaining({ used, max }: { used: number; max: number }) {
  return (
    <>
      بقي <Num value={max - used} variant="caption" /> حرفًا
    </>
  );
}

interface RecipientSummaryProps {
  labelAr: string;
  count: number | null;
  exact: boolean;
  note: string;
}

/**
 * The recipient count, stated before anything can be sent.
 *
 * `count === 0` is rendered as an error and blocks the form: a broadcast with
 * no live device is not a send that "went out quietly", it is a send that never
 * happened, and the operator must not walk away believing otherwise.
 */
function RecipientSummary({ labelAr, count, exact, note }: RecipientSummaryProps) {
  if (count === 0) {
    return (
      <Alert severity="error">
        <AlertTitle>لا توجد أجهزة لهذه الفئة</AlertTitle>
        لن يصل الإشعار إلى أحد. تحقّق من تسجيل الأجهزة في التطبيق قبل المحاولة.
      </Alert>
    );
  }

  return (
    <Alert severity={exact ? 'info' : 'warning'} icon={false}>
      <Stack gap={0.5}>
        <Stack direction="row" gap={1} alignItems="baseline" sx={{ flexWrap: 'wrap' }}>
          {count === null ? (
            // No number is better than a number that means nothing: for a
            // single account the panel has no device count to quote, and
            // printing '—' next to "حدّ أعلى" would read as a broken field.
            <Typography variant="body2">يُحسب عدد الأجهزة عند الإرسال · {labelAr}</Typography>
          ) : (
            <>
              <Num value={count} variant="h5" />
              <Typography variant="body2">
                {exact ? 'جهاز سيصله الإشعار' : 'حدّ أعلى للأجهزة'} · {labelAr}
              </Typography>
            </>
          )}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {note}
        </Typography>
      </Stack>
    </Alert>
  );
}

interface ReviewStepProps {
  audienceLabelAr: string;
  audienceHelp: string;
  estimateCount: number | null;
  estimateExact: boolean;
  estimateNote: string;
  userEmail: string | null;
  titleAr: string;
  bodyAr: string;
  titleEn: string;
  bodyEn: string;
  route: string;
}

function ReviewStep({
  audienceLabelAr,
  audienceHelp,
  estimateCount,
  estimateExact,
  estimateNote,
  userEmail,
  titleAr,
  bodyAr,
  titleEn,
  bodyEn,
  route,
}: ReviewStepProps) {
  return (
    <>
      <RecipientSummary
        labelAr={userEmail ? `${audienceLabelAr} · ${userEmail}` : audienceLabelAr}
        count={estimateCount}
        exact={estimateExact}
        note={estimateNote}
      />

      <Typography variant="caption" color="text.secondary">
        {audienceHelp}
      </Typography>

      <NotificationPreview
        languageLabel="الأجهزة العربية"
        dir="rtl"
        title={titleAr}
        body={bodyAr}
        route={route}
      />

      <NotificationPreview
        languageLabel="الأجهزة الإنجليزية"
        dir={titleEn ? 'ltr' : 'rtl'}
        title={titleEn || titleAr}
        body={bodyEn || bodyAr}
        route={route}
        note={titleEn ? undefined : 'لا توجد نسخة إنجليزية — تصل هذه الأجهزة النسخة العربية.'}
      />

      <Alert severity="warning">
        بمجرد الضغط على «إرسال الآن» يخرج الإشعار فورًا ولا يمكن سحبه أو تعديله.
      </Alert>
    </>
  );
}

interface NotificationPreviewProps {
  languageLabel: string;
  dir: 'rtl' | 'ltr';
  title: string;
  body: string;
  route: string;
  note?: string;
}

/** What lands on the lock screen. Reading it once here is the last chance. */
function NotificationPreview({ languageLabel, dir, title, body, route, note }: NotificationPreviewProps) {
  return (
    <Stack gap={0.75}>
      <Typography variant="caption" color="text.secondary">
        {languageLabel}
      </Typography>
      <Box
        dir={dir}
        sx={{
          padding: 1.5,
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'action.hover',
          textAlign: 'start',
        }}
      >
        <Typography variant="subtitle2" sx={{ wordBreak: 'break-word' }}>
          {title || '—'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
          {body || '—'}
        </Typography>
      </Box>
      {route && (
        <Typography variant="caption" color="text.secondary">
          الضغط يفتح شاشة <StatusChip kind="custom" value={route} label={route} tone="neutral" />
        </Typography>
      )}
      {note && (
        <Typography variant="caption" color="warning.main">
          {note}
        </Typography>
      )}
    </Stack>
  );
}
