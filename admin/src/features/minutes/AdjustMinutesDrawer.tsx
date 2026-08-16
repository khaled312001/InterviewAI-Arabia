import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';

import { FormDrawer } from '../../components/common/FormDrawer';
import { useConfirm } from '../../components/common/ConfirmDialog';
import { useToast } from '../../components/common/ToastProvider';
import { MINUTE_FORMS, countAr, formatNumber, formatDurationAr, secondsToMinutes } from '../../lib/format';
import { useAdjustMinutes } from './api';
import { minutesFieldErrors } from './formErrors';
import type { MinuteBalance, MinutesAdjustBody } from './types';

type Direction = 'credit' | 'deduct';

/** Mirrors `minutesAdjustSchema` in backend/src/routes/admin.js. */
const MAX_MINUTES = 6000;

export interface AdjustMinutesDrawerProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  userEmail: string | null;
  userDisabled: boolean;
  /** The current balance, so the preview is the server's figure, not a guess. */
  balance: MinuteBalance | undefined;
}

/**
 * Credit or deduct minutes by hand — POST /admin/users/:id/minutes.
 *
 * Two directions, one form, because they are the same decision with a sign: an
 * operator correcting a mistaken credit should not have to find a different
 * screen than the one that made it.
 *
 * The asymmetries between them are real and are stated on the form rather than
 * discovered from a server refusal:
 *  - a CREDIT writes a `provider='manual'` Payment row, so it can carry the
 *    amount actually collected off-platform and be reconciled against a bank
 *    statement later;
 *  - a DEDUCTION writes no payment (nothing was sold), only ever comes out of
 *    the PERPETUAL bucket, and is clamped at what is left — a balance is never
 *    driven negative, so the amount removed can be smaller than requested.
 */
export function AdjustMinutesDrawer({
  open,
  onClose,
  userId,
  userEmail,
  userDisabled,
  balance,
}: AdjustMinutesDrawerProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const adjust = useAdjustMinutes(userId);

  const [direction, setDirection] = useState<Direction>('credit');
  const [minutes, setMinutes] = useState('60');
  const [amountEgp, setAmountEgp] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setDirection('credit');
    setMinutes('60');
    setAmountEgp('');
    setReason('');
    adjust.reset();
    // adjust.reset is stable; re-running on every render would clear the error
    // the operator is reading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId]);

  const isCredit = direction === 'credit';
  const parsedMinutes = Number(minutes);
  const minutesValid =
    Number.isInteger(parsedMinutes) && parsedMinutes >= 1 && parsedMinutes <= MAX_MINUTES;
  const seconds = minutesValid ? parsedMinutes * 60 : 0;

  const parsedAmount = amountEgp.trim() === '' ? null : Number(amountEgp);
  const amountValid = parsedAmount === null || (Number.isFinite(parsedAmount) && parsedAmount >= 0);

  const reasonInvalid = reason.trim().length < 3;
  const serverErrors = minutesFieldErrors(adjust.error);

  /**
   * The preview, computed from the server's own snapshot.
   *
   * A deduction is clamped at the PERPETUAL balance — not at the available
   * balance — because that is the only bucket clawbackSeconds() touches. Held
   * seconds are a live meeting's reservation and are not ours to take either,
   * so the preview says exactly what will move and how much of the request will
   * be refused, before the operator commits to it.
   */
  const preview = useMemo(() => {
    if (!balance || !minutesValid) return null;
    if (isCredit) {
      return {
        applied: seconds,
        unapplied: 0,
        perpetualAfter: balance.balanceSeconds + seconds,
      };
    }
    const applied = Math.min(seconds, Math.max(0, balance.balanceSeconds));
    return {
      applied,
      unapplied: seconds - applied,
      perpetualAfter: balance.balanceSeconds - applied,
    };
  }, [balance, isCredit, minutesValid, seconds]);

  const blocked =
    !minutesValid || reasonInvalid || !amountValid || (isCredit && userDisabled);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (blocked) return;

    const who = userEmail ?? `الحساب رقم ${userId}`;

    const ok = await confirm({
      title: isCredit ? 'تأكيد إضافة الدقائق؟' : 'تأكيد خصم الدقائق؟',
      description: isCredit
        ? `سيُضاف ${formatDurationAr(seconds)} إلى رصيد ${who}.`
        : `سيُخصم ${formatDurationAr(preview?.applied ?? 0)} من رصيد ${who}.`,
      tone: isCredit ? 'default' : 'danger',
      confirmLabel: isCredit ? 'إضافة الدقائق' : 'خصم الدقائق',
      cancelLabel: 'تراجع',
      consequences: isCredit
        ? [
            'تُضاف إلى الرصيد الدائم — لا تنتهي صلاحيتها ولا تُستهلك قبل رصيد الاشتراك.',
            parsedAmount && parsedAmount > 0
              ? `تُسجَّل عملية دفع يدوية بقيمة ${formatNumber(parsedAmount, 'decimal', 2)} جنيه لمطابقتها لاحقًا مع كشف الحساب.`
              : 'تُسجَّل عملية دفع يدوية بقيمة صفر، فلا تدخل ضمن الإيرادات.',
            'يُسجَّل الإجراء في سجل التدقيق باسمك وبالسبب الذي كتبته.',
          ]
        : [
            'الخصم من الرصيد الدائم فقط — رصيد الاشتراك ينتهي مع دورته ولا يُسحب منه.',
            preview && preview.unapplied > 0
              ? `المتاح للخصم أقل من المطلوب: سيُخصم ${formatDurationAr(preview.applied)} فقط، والباقي مُستهلك بالفعل.`
              : 'لا يمكن أن يصبح الرصيد بالسالب — يتوقف الخصم عند الصفر.',
            'لا يُنشأ أي سجل دفع، ولا يمكن التراجع عن الخصم إلا بإضافة الدقائق من جديد.',
            'يُسجَّل الإجراء في سجل التدقيق باسمك وبالسبب الذي كتبته.',
          ],
      // The mutation runs after the dialog closes, so a server refusal lands in
      // the drawer next to the field it belongs to instead of as a toast.
      onConfirm: () => {},
    });
    if (!ok) return;

    const body: MinutesAdjustBody = {
      minutes: isCredit ? parsedMinutes : -parsedMinutes,
      reason: reason.trim(),
      ...(isCredit && parsedAmount !== null ? { amountEgp: parsedAmount } : null),
    };

    adjust.mutate(body, {
      onSuccess: (result) => {
        // The server's number, never the request: a deduction can be clamped,
        // and reporting the amount asked for would be reporting a change that
        // did not happen.
        const applied = formatDurationAr(result.appliedSeconds);
        // countAr, not `${n} دقيقة`: a bare interpolation prints a Latin
        // numeral in Arabic copy and gets the agreement wrong for 3–10.
        const remaining = countAr(
          secondsToMinutes(result.balance.availableSeconds),
          MINUTE_FORMS,
        );
        if (result.unappliedSeconds > 0) {
          toast.warning(`خُصم ${applied} فقط — الباقي كان مُستهلكًا. المتاح الآن ${remaining}.`);
        } else {
          toast.success(
            result.direction === 'credit'
              ? `أُضيف ${applied} — المتاح الآن ${remaining}`
              : `خُصم ${applied} — المتاح الآن ${remaining}`,
          );
        }
        onClose();
      },
    });
  }

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title="تعديل رصيد الدقائق"
      subtitle={userEmail ?? undefined}
      mode="create"
      onSubmit={handleSubmit}
      submitting={adjust.isPending}
      submitLabel={isCredit ? 'إضافة الدقائق' : 'خصم الدقائق'}
      disabled={blocked}
      error={adjust.error}
      dirty={Boolean(reason) && !adjust.isPending}
      noValidate
    >
      <Stack gap={1}>
        <Typography variant="caption" color="text.secondary">
          نوع الحركة
        </Typography>
        <ToggleButtonGroup
          value={direction}
          exclusive
          size="small"
          onChange={(_e, value: Direction | null) => value && setDirection(value)}
        >
          <ToggleButton value="credit">إضافة رصيد</ToggleButton>
          <ToggleButton value="deduct">خصم رصيد</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {userDisabled && isCredit && (
        <Alert severity="warning">
          هذا الحساب موقوف — سيرفض الخادم الإضافة. أعِد تفعيل الحساب أولًا، أو اخصم الرصيد إن كان هذا
          هو المطلوب.
        </Alert>
      )}

      <TextField
        label="عدد الدقائق"
        type="number"
        value={minutes}
        onChange={(e) => setMinutes(e.target.value)}
        required
        inputProps={{ min: 1, max: MAX_MINUTES, step: 1, inputMode: 'numeric' }}
        error={(minutes !== '' && !minutesValid) || Boolean(serverErrors.minutes)}
        helperText={
          serverErrors.minutes ??
          (minutesValid
            ? `تعادل ${formatDurationAr(seconds)}`
            : `أدخل عددًا صحيحًا بين ١ و${formatNumber(MAX_MINUTES)}`)
        }
      />

      {isCredit && (
        <TextField
          label="المبلغ المحصَّل (اختياري)"
          type="number"
          value={amountEgp}
          onChange={(e) => setAmountEgp(e.target.value)}
          inputProps={{ min: 0, step: '0.01', inputMode: 'decimal' }}
          InputProps={{
            endAdornment: <InputAdornment position="end">ج.م</InputAdornment>,
          }}
          error={!amountValid || Boolean(serverErrors.amountEgp)}
          helperText={
            serverErrors.amountEgp ??
            'املأه فقط إذا استلمت مالًا فعليًا خارج المنصّة (إنستاباي، فودافون كاش). اتركه فارغًا للمنح المجانية حتى لا تدخل ضمن الإيرادات.'
          }
        />
      )}

      <BalancePreview balance={balance} preview={preview} isCredit={isCredit} />

      <TextField
        label={isCredit ? 'سبب الإضافة' : 'سبب الخصم'}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
        multiline
        minRows={2}
        inputProps={{ maxLength: 300 }}
        error={Boolean(serverErrors.reason) || (reason.length > 0 && reasonInvalid)}
        helperText={serverErrors.reason ?? 'إلزامي — يُحفظ في سجل التدقيق (٣ أحرف على الأقل)'}
      />

      {!isCredit && (
        <Alert severity="warning">
          <AlertTitle>الخصم لا يُسترجع تلقائيًا</AlertTitle>
          لا يوجد زر تراجع: لإعادة الدقائق يجب إضافتها من جديد، وستظهر الحركتان في كشف الحساب.
        </Alert>
      )}
    </FormDrawer>
  );
}

/**
 * "من كذا إلى كذا" for the perpetual bucket.
 *
 * Only the perpetual figure moves, so only it is previewed. Showing the
 * *available* balance changing would be wrong the moment the customer is in a
 * live meeting: held seconds and the subscription allowance both feed that
 * number and neither is touched here.
 */
function BalancePreview({
  balance,
  preview,
  isCredit,
}: {
  balance: MinuteBalance | undefined;
  preview: { applied: number; unapplied: number; perpetualAfter: number } | null;
  isCredit: boolean;
}) {
  if (!balance) {
    return (
      <Alert severity="info">
        لم يُقرأ الرصيد الحالي بعد، فلا يمكن عرض أثر الحركة. سيطبّق الخادم الحركة على الرصيد الفعلي
        وقت التنفيذ.
      </Alert>
    );
  }

  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'action.hover',
      }}
    >
      <Stack gap={1}>
        <Typography variant="caption" color="text.secondary">
          الرصيد الدائم بعد الحركة
        </Typography>
        <Stack direction="row" gap={1.5} alignItems="center" sx={{ flexWrap: 'wrap' }}>
          <Typography variant="body2" className="ltr-island tabular">
            {formatDurationAr(balance.balanceSeconds)}
          </Typography>
          <ArrowBackRounded sx={{ fontSize: 18, color: 'text.disabled' }} />
          <Typography
            variant="body2"
            color={preview ? (isCredit ? 'success.main' : 'warning.main') : 'text.disabled'}
            className="ltr-island tabular"
          >
            {preview ? formatDurationAr(preview.perpetualAfter) : '—'}
          </Typography>
        </Stack>
        {preview && preview.unapplied > 0 && (
          <Typography variant="caption" color="warning.main">
            المطلوب أكبر من الرصيد الدائم — سيُخصم {formatDurationAr(preview.applied)} فقط.
          </Typography>
        )}
        {/* countAr, not `<Num/> دقيقة`: Arabic does not pluralise like English,
            so a fixed noun beside a variable numeral is wrong for 1, 2, and
            every value from 3 to 10 — "٥ دقيقة" instead of "٥ دقائق". */}
        <Typography variant="caption" color="text.secondary">
          رصيد الاشتراك ({countAr(secondsToMinutes(balance.subSeconds), MINUTE_FORMS)}) والمحجوز
          لمقابلة جارية ({countAr(secondsToMinutes(balance.heldSeconds), MINUTE_FORMS)}) لا يتأثران
          بهذه الحركة.
        </Typography>
      </Stack>
    </Box>
  );
}
