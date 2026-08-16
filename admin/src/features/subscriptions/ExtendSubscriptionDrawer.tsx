import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';

import { FormDrawer } from '../../components/common/FormDrawer';
import { StatusChip } from '../../components/common/StatusChip';
import { useConfirm } from '../../components/common/ConfirmDialog';
import { useToast } from '../../components/common/ToastProvider';
import { formatAbsolute } from '../../lib/format';
import { useUpdateSubscription } from './api';
import { subscriptionFieldErrors } from './formErrors';
import { MAX_GRANT_DAYS, PLAN_PRESETS, dateInputToIso, previewExpiry, toDateInput, todayPlus } from './duration';
import { ExpiryPreview } from './ExpiryPreview';
import type { Subscription, SubscriptionPatch } from './types';

type Mode = 'days' | 'date';

/**
 * Durations, not plans — an extension adds days to a row that already has its
 * own plan code, so nothing here labels anything. A year stays offered even
 * though the yearly PLAN is retired: adding 365 days to a subscription is a
 * duration, while selling a yearly plan is a product decision that was undone.
 */
const EXTEND_PRESETS = [
  { days: 7, labelAr: 'أسبوع' },
  ...PLAN_PRESETS.map((p) => ({ days: p.days, labelAr: p.labelAr })),
  { days: 365, labelAr: 'سنة' },
] as const;

export interface ExtendSubscriptionDrawerProps {
  open: boolean;
  subscription: Subscription | null;
  onClose: () => void;
}

/**
 * Extend or correct one subscription — PATCH /admin/subscriptions/:id.
 *
 * The provider is deliberately not editable: an EasyKash row extended as
 * goodwill stays EasyKash, because rewriting it to 'manual' would erase where
 * the money came from. Only a fresh grant creates a manual row.
 */
export function ExtendSubscriptionDrawer({ open, subscription, onClose }: ExtendSubscriptionDrawerProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const update = useUpdateSubscription();

  const [mode, setMode] = useState<Mode>('days');
  const [presetDays, setPresetDays] = useState<number | 'custom'>(30);
  const [customDays, setCustomDays] = useState('30');
  const [until, setUntil] = useState('');
  const [planCode, setPlanCode] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode('days');
    setPresetDays(30);
    setCustomDays('30');
    setUntil(toDateInput(subscription?.expiresAt) || todayPlus(30));
    setPlanCode(subscription?.planCode ?? '');
    setReason('');
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subscription?.id]);

  const days = presetDays === 'custom' ? Number(customDays) : presetDays;
  const daysValid = Number.isInteger(days) && days >= 1 && days <= MAX_GRANT_DAYS;

  const untilIso = dateInputToIso(until);
  const untilDate = untilIso ? new Date(untilIso) : null;
  // The row stays 'active', and the server refuses an active row that expires
  // in the past (EXPIRY_IN_PAST) — so the form refuses it first.
  const untilInPast = Boolean(untilDate && untilDate.getTime() <= Date.now());

  const nextExpiresAt = useMemo<Date | null>(() => {
    if (!subscription) return null;
    if (mode === 'days') return daysValid ? previewExpiry(subscription.expiresAt, days) : null;
    return untilDate && !untilInPast ? untilDate : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, daysValid, days, subscription?.expiresAt, untilDate, untilInPast]);

  const reasonInvalid = reason.trim().length < 3;
  const serverErrors = subscriptionFieldErrors(update.error);
  const planCodeChanged = (planCode || null) !== (subscription?.planCode ?? null);

  const blocked =
    !subscription || reasonInvalid || (mode === 'days' ? !daysValid : !untilDate || untilInPast);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subscription || blocked) return;

    const ok = await confirm({
      title: 'تأكيد تمديد الاشتراك؟',
      description: `سيمتد وصول ${subscription.user?.email ?? 'المستخدم'} حتى ${
        nextExpiresAt ? formatAbsolute(nextExpiresAt) : '—'
      }.`,
      confirmLabel: 'تمديد',
      cancelLabel: 'تراجع',
      consequences: [
        'لا تُسجَّل أي عملية دفع — التمديد لا يحرّك أموالًا ولا يظهر في الإيرادات.',
        `يبقى مزوّد الاشتراك كما هو (${subscription.provider}) حتى لا يضيع مصدر المبلغ الأصلي.`,
        'يُسجَّل الإجراء في سجل التدقيق باسمك وبالسبب الذي كتبته.',
      ],
      onConfirm: () => {},
    });
    if (!ok) return;

    const body: SubscriptionPatch = {
      reason: reason.trim(),
      ...(mode === 'days' ? { extendDays: days } : { expiresAt: untilIso as string }),
      ...(planCodeChanged && planCode ? { planCode } : null),
    };

    update.mutate(
      { id: subscription.id, ...body },
      {
        onSuccess: (result) => {
          toast.success(
            result.user.premiumUntil
              ? `تم التمديد — الوصول المميز حتى ${formatAbsolute(new Date(result.user.premiumUntil))}`
              : 'تم تحديث الاشتراك',
          );
          onClose();
        },
      },
    );
  }

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title="تمديد الاشتراك"
      subtitle={subscription?.user?.email ?? undefined}
      mode="edit"
      onSubmit={handleSubmit}
      submitting={update.isPending}
      submitLabel="تمديد"
      disabled={blocked}
      error={update.error}
      dirty={Boolean(reason) && !update.isPending}
      noValidate
    >
      <Stack direction="row" gap={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
        <StatusChip kind="subscription" value={subscription?.status} />
        <StatusChip
          kind="paymentProvider"
          value={subscription?.provider}
          tooltip={
            subscription?.provider === 'manual'
              ? 'منحة يدوية — لا توجد عملية دفع خلفها'
              : 'اشتراك مدفوع عبر البوابة — لن يتغيّر المزوّد بالتمديد'
          }
        />
        <StatusChip kind="planCode" value={subscription?.planCode} />
      </Stack>

      <Stack gap={1}>
        <Typography variant="caption" color="text.secondary">
          طريقة التمديد
        </Typography>
        <ToggleButtonGroup
          value={mode}
          exclusive
          size="small"
          onChange={(_e, value: Mode | null) => value && setMode(value)}
        >
          <ToggleButton value="days">إضافة أيام</ToggleButton>
          <ToggleButton value="date">تاريخ انتهاء جديد</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {mode === 'days' ? (
        <Stack gap={2}>
          <TextField
            select
            label="المدة المضافة"
            value={String(presetDays)}
            onChange={(e) =>
              setPresetDays(e.target.value === 'custom' ? 'custom' : Number(e.target.value))
            }
          >
            {EXTEND_PRESETS.map((p) => (
              <MenuItem key={p.days} value={String(p.days)}>
                {p.labelAr} — {p.days} يومًا
              </MenuItem>
            ))}
            <MenuItem value="custom">مدة مخصصة</MenuItem>
          </TextField>

          {presetDays === 'custom' && (
            <TextField
              label="عدد الأيام"
              type="number"
              value={customDays}
              onChange={(e) => setCustomDays(e.target.value)}
              inputProps={{ min: 1, max: MAX_GRANT_DAYS, step: 1 }}
              error={!daysValid || Boolean(serverErrors.duration)}
              helperText={
                serverErrors.duration ??
                (daysValid ? `الحد الأقصى ${MAX_GRANT_DAYS} يومًا` : `أدخل عددًا بين ١ و${MAX_GRANT_DAYS}`)
              }
            />
          )}
        </Stack>
      ) : (
        <TextField
          label="تاريخ الانتهاء الجديد"
          type="date"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          InputLabelProps={{ shrink: true }}
          inputProps={{ min: todayPlus(1) }}
          error={untilInPast || Boolean(serverErrors.expiresAt)}
          helperText={
            serverErrors.expiresAt ??
            (untilInPast
              ? 'اشتراك فعّال يجب أن ينتهي في المستقبل'
              : 'يمكن أن يكون أقصر من التاريخ الحالي — استخدمه لتصحيح خطأ، لا لإنهاء الوصول')
          }
        />
      )}

      <ExpiryPreview
        currentExpiresAt={subscription?.expiresAt}
        nextExpiresAt={nextExpiresAt}
        title="أثر التمديد"
        note={
          mode === 'days'
            ? 'الأيام تُضاف إلى تاريخ الانتهاء الحالي إن كان في المستقبل، وإلا فمن اليوم.'
            : undefined
        }
      />

      <TextField
        select
        label="كود الخطة"
        value={planCode}
        onChange={(e) => setPlanCode(e.target.value)}
        error={Boolean(serverErrors.planCode)}
        helperText={serverErrors.planCode ?? 'اتركه كما هو إن لم تكن تصحّح خطة مسجّلة بالخطأ'}
      >
        {subscription?.planCode &&
          subscription.planCode !== 'manual' &&
          !PLAN_PRESETS.some((p) => p.code === subscription.planCode) && (
          <MenuItem value={subscription.planCode}>{subscription.planCode}</MenuItem>
        )}
        {PLAN_PRESETS.map((p) => (
          <MenuItem key={p.code} value={p.code}>
            {p.labelAr}
          </MenuItem>
        ))}
        <MenuItem value="manual">يدوي</MenuItem>
      </TextField>

      <TextField
        label="سبب التمديد"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
        multiline
        minRows={2}
        inputProps={{ maxLength: 300 }}
        error={Boolean(serverErrors.reason) || (reason.length > 0 && reasonInvalid)}
        helperText={serverErrors.reason ?? 'إلزامي — يُحفظ في سجل التدقيق (٣ أحرف على الأقل)'}
      />

      <Alert severity="info">
        التمديد يعدّل هذا الاشتراك في مكانه ولا ينشئ اشتراكًا جديدًا. لإنهاء الوصول استخدم «إلغاء
        الاشتراك».
      </Alert>
    </FormDrawer>
  );
}
