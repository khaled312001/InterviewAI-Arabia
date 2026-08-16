import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
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
import { useDebouncedValue } from '../../lib/hooks/useDebouncedValue';
import { effectivePlan } from '../../lib/permissions';
import { formatAbsolute } from '../../lib/format';
import type { AdminUser } from '../users/types';
import { useGrantSubscription, useUserSearch } from './api';
import { subscriptionFieldErrors } from './formErrors';
import {
  MAX_GRANT_DAYS,
  PLAN_PRESETS,
  dateInputToIso,
  previewExpiry,
  todayPlus,
} from './duration';
import { ExpiryPreview } from './ExpiryPreview';
import type { GrantBody } from './types';

type Mode = 'days' | 'date';
type Preset = (typeof PLAN_PRESETS)[number]['code'] | 'custom';

export interface GrantSubscriptionDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Pre-selects the account when the drawer is opened from a user's row. */
  presetUser?: AdminUser | null;
}

/**
 * Grant premium by hand — POST /admin/subscriptions.
 *
 * This creates a real `provider='manual'` subscription and no Payment row, so
 * the grant is visible on this page, survives the expiry sweep, and never
 * appears as revenue. It replaces the old lever (PATCH /users writing the
 * mirror with nothing behind it), which the hourly sweep erased.
 */
export function GrantSubscriptionDrawer({ open, onClose, presetUser }: GrantSubscriptionDrawerProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const grant = useGrantSubscription();

  const [user, setUser] = useState<AdminUser | null>(null);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<Mode>('days');
  const [preset, setPreset] = useState<Preset>('monthly');
  const [customDays, setCustomDays] = useState('30');
  const [until, setUntil] = useState(todayPlus(30));
  const [reason, setReason] = useState('');

  const debouncedSearch = useDebouncedValue(search, 300);
  const userQuery = useUserSearch(debouncedSearch, open && !presetUser);

  useEffect(() => {
    if (!open) return;
    setUser(presetUser ?? null);
    setSearch('');
    setMode('days');
    setPreset('monthly');
    setCustomDays('30');
    setUntil(todayPlus(30));
    setReason('');
    grant.reset();
    // grant.reset is stable; re-running on every render would clear the error
    // the operator is reading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetUser]);

  const presetDays = PLAN_PRESETS.find((p) => p.code === preset)?.days ?? null;
  const days = preset === 'custom' ? Number(customDays) : presetDays;
  const daysValid = Number.isInteger(days) && (days as number) >= 1 && (days as number) <= MAX_GRANT_DAYS;

  // The mirror is what the server derives coverage from, and the picker row
  // already carries it — so the preview costs no extra request.
  const currentExpiresAt = effectivePlan(user) === 'premium' ? user?.premiumUntil ?? null : null;

  const untilIso = dateInputToIso(until);
  const untilDate = untilIso ? new Date(untilIso) : null;
  const untilInPast = Boolean(untilDate && untilDate.getTime() <= Date.now());
  // Mirrors the server's GRANT_SHORTENS_ACCESS refusal rather than discovering
  // it: an absolute date behind the current expiry is a shortening, not a grant.
  const untilShortens = Boolean(
    untilDate && currentExpiresAt && untilDate.getTime() < new Date(currentExpiresAt).getTime(),
  );

  const nextExpiresAt = useMemo<Date | null>(() => {
    if (mode === 'days') return daysValid ? previewExpiry(currentExpiresAt, days as number) : null;
    return untilDate && !untilInPast && !untilShortens ? untilDate : null;
  }, [mode, daysValid, days, currentExpiresAt, untilDate, untilInPast, untilShortens]);

  const reasonInvalid = reason.trim().length < 3;
  const serverErrors = subscriptionFieldErrors(grant.error);

  const blocked =
    !user ||
    reasonInvalid ||
    (mode === 'days' ? !daysValid : !untilDate || untilInPast || untilShortens);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || blocked) return;

    // The plan code labels a NEW row. When a subscription already covers the
    // user the server extends that row in place — keeping its provider and its
    // plan code, so a paid quarterly is never relabelled by a goodwill grant —
    // and a planCode here would claim otherwise.
    const planCode =
      mode === 'days' && preset !== 'custom' && !currentExpiresAt ? preset : undefined;

    const ok = await confirm({
      title: 'تأكيد منح الاشتراك؟',
      description: `سيحصل ${user.email} على وصول مميز حتى ${
        nextExpiresAt ? formatAbsolute(nextExpiresAt) : '—'
      }.`,
      confirmLabel: 'منح الاشتراك',
      cancelLabel: 'تراجع',
      consequences: [
        currentExpiresAt
          ? 'الأيام تُضاف إلى الاشتراك الحالي نفسه — يبقى مزوّده وخطته كما هما، ولا يُنشأ اشتراك بديل.'
          : 'يُنشأ اشتراك يدوي (provider=manual) — لا تُسجَّل أي عملية دفع ولا تتأثر الإيرادات.',
        'المنح يعطي الوصول المميز فقط ولا يضيف دقائق مقابلات — امنح الدقائق من صفحة المستخدم إن لزم.',
        'يُسجَّل الإجراء في سجل التدقيق باسمك وبالسبب الذي كتبته.',
      ],
      // The mutation runs after the dialog closes, so a server refusal lands
      // in the drawer next to the field it belongs to instead of as a toast.
      onConfirm: () => {},
    });
    if (!ok) return;

    const body: GrantBody = {
      userId: user.id,
      reason: reason.trim(),
      ...(mode === 'days' ? { days: days as number } : { expiresAt: untilIso as string }),
      ...(planCode ? { planCode } : null),
    };

    grant.mutate(body, {
      onSuccess: (result) => {
        toast.success(
          result.user.premiumUntil
            ? `تم منح ${user.email} وصولًا مميزًا حتى ${formatAbsolute(new Date(result.user.premiumUntil))}`
            : `تم إنشاء الاشتراك لـ ${user.email}`,
        );
        onClose();
      },
    });
  }

  const dirty = Boolean(user || reason);

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title="منح اشتراك"
      subtitle="اشتراك يدوي بدون عملية دفع"
      mode="create"
      onSubmit={handleSubmit}
      submitting={grant.isPending}
      submitLabel="منح الاشتراك"
      disabled={blocked}
      error={grant.error}
      dirty={dirty && !grant.isPending}
      noValidate
    >
      {presetUser ? (
        <Stack gap={0.5}>
          <Typography variant="caption" color="text.secondary">
            المستخدم
          </Typography>
          <Typography variant="body2">{presetUser.email}</Typography>
        </Stack>
      ) : (
        <Autocomplete<AdminUser>
          options={userQuery.data?.users ?? []}
          value={user}
          onChange={(_e, value) => setUser(value)}
          onInputChange={(_e, value, changeReason) => {
            if (changeReason !== 'reset') setSearch(value);
          }}
          filterOptions={(options) => options}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          getOptionLabel={(option) => option.email}
          loading={userQuery.isFetching}
          noOptionsText={search ? 'لا مستخدم مطابق' : 'اكتب بريدًا أو اسمًا للبحث'}
          renderOption={(props, option) => {
            const { key, ...rest } = props as React.HTMLAttributes<HTMLLIElement> & { key: string };
            return (
              <Box component="li" key={key} {...rest}>
                <Stack gap={0.25} sx={{ minWidth: 0 }}>
                  <Stack direction="row" gap={1} alignItems="center">
                    <Typography variant="body2" noWrap>
                      {option.email}
                    </Typography>
                    <StatusChip kind="plan" value={effectivePlan(option)} />
                  </Stack>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {option.name}
                    {option.isDisabled ? ' · حساب موقوف' : ''}
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
              error={Boolean(serverErrors.user)}
              helperText={serverErrors.user ?? 'ابحث ثم اختر الحساب الذي سيحصل على الاشتراك'}
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

      {user?.isDisabled && (
        <Alert severity="warning">
          هذا الحساب موقوف — سيرفض الخادم المنح. أعِد تفعيل الحساب من صفحة المستخدم أولًا.
        </Alert>
      )}

      <Stack gap={1}>
        <Typography variant="caption" color="text.secondary">
          طريقة تحديد المدة
        </Typography>
        <ToggleButtonGroup
          value={mode}
          exclusive
          size="small"
          onChange={(_e, value: Mode | null) => value && setMode(value)}
        >
          <ToggleButton value="days">مدة بالأيام</ToggleButton>
          <ToggleButton value="date">تاريخ انتهاء محدد</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {mode === 'days' ? (
        <Stack gap={2}>
          <TextField
            select
            label="الخطة"
            value={preset}
            onChange={(e) => setPreset(e.target.value as Preset)}
            error={Boolean(serverErrors.planCode)}
            helperText={
              serverErrors.planCode ??
              (currentExpiresAt
                ? 'المستخدم مشترك بالفعل — تُضاف المدة إلى اشتراكه الحالي وتبقى خطته كما هي'
                : 'المدة المطابقة لخطة من الكتالوج تُسجَّل باسمها؛ ما عداها يُسجَّل «يدوي»')
            }
          >
            {PLAN_PRESETS.map((p) => (
              <MenuItem key={p.code} value={p.code}>
                {p.labelAr} — {p.days} يومًا
              </MenuItem>
            ))}
            <MenuItem value="custom">مدة مخصصة</MenuItem>
          </TextField>

          {preset === 'custom' && (
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
          label="ينتهي الاشتراك في"
          type="date"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          InputLabelProps={{ shrink: true }}
          inputProps={{ min: todayPlus(1) }}
          error={untilInPast || untilShortens || Boolean(serverErrors.expiresAt)}
          helperText={
            serverErrors.expiresAt ??
            (untilInPast
              ? 'اختر تاريخًا في المستقبل'
              : untilShortens
                ? 'هذا التاريخ أقصر من وصول المستخدم الحالي — استخدم تمديد الاشتراك أو إلغاءه'
                : 'ينتهي في نهاية اليوم المحدد بتوقيت جهازك')
          }
        />
      )}

      <ExpiryPreview
        currentExpiresAt={currentExpiresAt}
        nextExpiresAt={nextExpiresAt}
        note={
          currentExpiresAt
            ? 'المدة تُضاف إلى الاشتراك الحالي في مكانه، ولا تُلغيه ولا تستبدله.'
            : undefined
        }
      />

      <TextField
        label="سبب المنح"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
        multiline
        minRows={2}
        inputProps={{ maxLength: 300 }}
        error={Boolean(serverErrors.reason) || (reason.length > 0 && reasonInvalid)}
        helperText={
          serverErrors.reason ?? 'إلزامي — يُحفظ في سجل التدقيق (٣ أحرف على الأقل)'
        }
      />

      <Alert severity="info">
        المنح اليدوي لا ينشئ عملية دفع ولا يظهر في تقارير الإيرادات، ويُعلَّم بالمزوّد «يدوي». وهو
        يمنح الوصول المميز فقط — دقائق المقابلات تُمنح بشكل منفصل من صفحة المستخدم.
      </Alert>
    </FormDrawer>
  );
}
