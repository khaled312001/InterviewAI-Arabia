import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import { FormDrawer } from '../../components/common/FormDrawer';
import { Mono } from '../../components/common/Mono';
import { useConfirm } from '../../components/common/ConfirmDialog';
import { useToast } from '../../components/common/ToastProvider';
import { apiErrorPayload, parseApiError } from '../../lib/errors';
import { can } from '../../lib/permissions';
import { toDate } from '../../lib/format';
import { useAuth } from '../../store/auth';
import { useCreateUser, useSaveUser } from './api';
import { disableConfirmCopy, useUserActions } from './actions';
import type {
  AdminUser,
  EmailTakenDetails,
  UserCreateResponse,
  UserPatch,
  UserPlan,
} from './types';

/** yyyy-mm-dd in the operator's own timezone — what <input type="date"> wants. */
function toDateInput(value: string | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The grant runs to the end of the chosen day, not to 00:00 of it. */
function dateInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}T23:59:59`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toDateInput(d.toISOString());
}

const QUICK_GRANTS: Array<{ days: number; label: string }> = [
  { days: 30, label: 'شهر' },
  { days: 90, label: '٣ أشهر' },
  { days: 365, label: 'سنة' },
];

/** Deliberately loose — the server owns the real rule; this only catches typos. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface UserFormDrawerProps {
  open: boolean;
  /** null ⇒ create mode. */
  user: AdminUser | null;
  onClose: () => void;
}

/**
 * The single create/edit surface for an end-user account.
 *
 * In edit mode the plan control writes `premiumUntil` alongside `plan` because
 * services/quota.js gates on the date: setting `plan` on its own grants nothing.
 * The backend now turns that pair into a real manual subscription row, so it can
 * refuse a change that would shorten or erase paid access — those refusals are
 * surfaced here rather than swallowed.
 */
export function UserFormDrawer({ open, user, onClose }: UserFormDrawerProps) {
  return user ? (
    <EditUser key={user.id} user={user} open={open} onClose={onClose} />
  ) : (
    <CreateUser open={open} onClose={onClose} />
  );
}

/* --------------------------------  create  -------------------------------- */

function CreateUser({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<'ar' | 'en'>('ar');
  const [phone, setPhone] = useState('');
  /** Set once the server answers 201; the drawer stops being a form. */
  const [created, setCreated] = useState<UserCreateResponse | null>(null);

  const create = useCreateUser();

  // Reset on every open so a previous account's password can never be shown to
  // whoever opens the drawer next.
  useEffect(() => {
    if (!open) return;
    setEmail('');
    setName('');
    setLanguage('ar');
    setPhone('');
    setCreated(null);
    create.reset();
    // `create` is a stable mutation object; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmedEmail = email.trim().toLowerCase();
  const emailInvalid = email.length > 0 && !EMAIL_RE.test(trimmedEmail);
  const nameInvalid = name.length > 0 && name.trim().length < 2;
  // The backend normalises this to an Egyptian mobile; anything shorter than 8
  // digits cannot be one.
  const phoneInvalid = phone.length > 0 && phone.replace(/\D/g, '').length < 8;
  const incomplete = !trimmedEmail || name.trim().length < 2;

  const parsed = create.error ? parseApiError(create.error) : null;
  const emailTaken = parsed?.code === 'EMAIL_TAKEN';
  const takenUserId = emailTaken
    ? apiErrorPayload<EmailTakenDetails>(create.error)?.userId
    : undefined;

  const dirty = Boolean(email || name || phone) && !created;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (incomplete || emailInvalid || nameInvalid || phoneInvalid) return;
    create.mutate(
      {
        email: trimmedEmail,
        name: name.trim(),
        language,
        ...(phone.trim() ? { phone: phone.trim() } : null),
      },
      { onSuccess: (data) => setCreated(data) },
    );
  }

  if (created) {
    return (
      <FormDrawer
        open={open}
        onClose={onClose}
        title="تم إنشاء الحساب"
        subtitle={created.user.email}
        onSubmit={(e) => e.preventDefault()}
        // Closing loses the password for good, so the drawer stays "dirty" and
        // the guard asks — with copy that says what is actually being lost.
        dirty
        closeConfirm={{
          title: 'إغلاق قبل تسليم كلمة المرور؟',
          description: 'لن تُعرض كلمة المرور المؤقتة مرة أخرى، ولا توجد أي طريقة لاستعادتها.',
          confirmLabel: 'إغلاق على أي حال',
          cancelLabel: 'رجوع',
        }}
        footer={
          <Button onClick={onClose} sx={{ minWidth: 120 }}>
            تم التسليم
          </Button>
        }
      >
        <TemporaryPasswordPanel result={created} />
      </FormDrawer>
    );
  }

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title="مستخدم جديد"
      subtitle="حساب يُنشأ يدويًا بدل التسجيل من التطبيق"
      mode="create"
      submitLabel="إنشاء الحساب"
      onSubmit={handleSubmit}
      submitting={create.isPending}
      disabled={incomplete || emailInvalid || nameInvalid || phoneInvalid}
      // A taken email is shown on the field itself, not twice.
      error={emailTaken ? undefined : create.error}
      dirty={dirty}
      noValidate
    >
      <TextField
        label="البريد الإلكتروني"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="off"
        inputProps={{ dir: 'ltr' }}
        error={emailInvalid || emailTaken}
        helperText={
          emailInvalid ? (
            'أدخل بريدًا إلكترونيًا صحيحًا'
          ) : emailTaken ? (
            <>
              {parsed?.messageAr}
              {takenUserId && (
                <>
                  {' — '}
                  <Link component={RouterLink} to={`/users/${takenUserId}`} onClick={onClose}>
                    افتح الحساب الموجود
                  </Link>
                </>
              )}
            </>
          ) : (
            'يُستخدم لتسجيل الدخول، ولا يمكن تغييره بعد الإنشاء'
          )
        }
      />

      <TextField
        label="الاسم"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        inputProps={{ minLength: 2, maxLength: 120 }}
        error={nameInvalid}
        helperText={nameInvalid ? 'الاسم يجب ألا يقل عن حرفين' : ' '}
      />

      <TextField
        select
        label="لغة الواجهة"
        value={language}
        onChange={(e) => setLanguage(e.target.value as 'ar' | 'en')}
        helperText="يمكن للمستخدم تغييرها من التطبيق لاحقًا"
      >
        <MenuItem value="ar">العربية</MenuItem>
        <MenuItem value="en">الإنجليزية</MenuItem>
      </TextField>

      <TextField
        label="رقم الهاتف (اختياري)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        autoComplete="off"
        inputProps={{ dir: 'ltr', maxLength: 20 }}
        error={phoneInvalid}
        helperText={
          phoneInvalid
            ? 'رقم غير مكتمل'
            : 'رقم موبايل مصري — يُستخدم عند الدفع، ويوفّر خطوة على المستخدم لاحقًا'
        }
      />

      <Alert severity="info">
        لا يرسل النظام أي بريد إلكتروني. ستظهر كلمة مرور مؤقتة مرة واحدة بعد الإنشاء، وعليك تسليمها
        للمستخدم بنفسك. الحساب يُنشأ مجانيًا — امنح الاشتراك المميز بعد ذلك من زر التعديل.
      </Alert>
    </FormDrawer>
  );
}

/** The one-time hand-off. Rendered instead of the form, never beside it. */
function TemporaryPasswordPanel({ result }: { result: UserCreateResponse }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  async function copyBoth() {
    try {
      await navigator.clipboard.writeText(
        `${result.user.email}\n${result.temporaryPassword}`,
      );
      setCopied(true);
      toast.success('تم نسخ البريد وكلمة المرور');
    } catch {
      toast.error('تعذّر النسخ — انسخ الكلمة يدويًا قبل الإغلاق');
    }
  }

  return (
    <>
      <Alert severity="warning">
        <AlertTitle>كلمة المرور المؤقتة تُعرض الآن فقط</AlertTitle>
        لن تظهر مرة أخرى في أي شاشة ولا في سجل العمليات. انسخها وسلّمها للمستخدم قبل إغلاق هذه
        النافذة، ثم اطلب منه تغييرها من التطبيق.
      </Alert>

      <Stack gap={0.5}>
        <Typography variant="caption" color="text.secondary">
          البريد الإلكتروني
        </Typography>
        <Mono value={result.user.email} copyable />
      </Stack>

      <Stack gap={0.5}>
        <Typography variant="caption" color="text.secondary">
          كلمة المرور المؤقتة
        </Typography>
        <Box
          sx={{
            padding: 1.5,
            borderRadius: 1,
            border: 1,
            borderColor: 'warning.main',
            backgroundColor: 'action.hover',
          }}
        >
          <Mono value={result.temporaryPassword} variant="h6" copyable />
        </Box>
      </Stack>

      <Button variant="outlined" onClick={copyBoth} sx={{ alignSelf: 'flex-start' }}>
        {copied ? 'تم النسخ — انسخ مرة أخرى' : 'نسخ البريد وكلمة المرور معًا'}
      </Button>

      <Stack gap={0.5}>
        <Typography variant="caption" color="text.secondary">
          معرّف الحساب
        </Typography>
        <Mono value={result.user.id} copyable />
      </Stack>
    </>
  );
}

/* ---------------------------------  edit  --------------------------------- */

function EditUser({ user, open, onClose }: { user: AdminUser; open: boolean; onClose: () => void }) {
  const role = useAuth((s) => s.admin?.role);
  const canDelete = can(role, 'users.delete');
  // Entitlement is NOT part of users.write. The plan control creates a real
  // provider='manual' subscription server-side, and every subscription route —
  // including the list a grant would show up in — is super_admin only. Offering
  // it to a moderator meant minting access they could then neither see nor
  // revoke; the backend now answers ENTITLEMENT_SUPER_ADMIN_ONLY, and this is
  // the same rule stated in the UI instead of discovered as a 403.
  const canGrant = can(role, 'subscriptions.grant');
  const confirm = useConfirm();
  const { remove } = useUserActions();

  const [name, setName] = useState('');
  const [plan, setPlan] = useState<UserPlan>('free');
  const [until, setUntil] = useState('');
  const [disabled, setDisabled] = useState(false);

  const initial = useMemo(
    () => ({
      name: user.name,
      plan: user.plan,
      until: toDateInput(user.premiumUntil),
      disabled: user.isDisabled,
    }),
    [user],
  );

  useEffect(() => {
    setName(initial.name);
    setPlan(initial.plan);
    setUntil(initial.until);
    setDisabled(initial.disabled);
  }, [initial, open]);

  const save = useSaveUser(onClose);

  const planChanged = canGrant && plan !== initial.plan;
  const untilChanged = canGrant && until !== initial.until;
  const nameChanged = name !== initial.name;
  const disabledChanged = disabled !== initial.disabled;
  const dirty = planChanged || untilChanged || nameChanged || disabledChanged;

  const untilIso = dateInputToIso(until);
  const untilInPast = Boolean(untilIso && new Date(untilIso).getTime() <= Date.now());
  // Only enforced when the plan or the date is actually being touched, so a
  // rename never gets blocked by an already-lapsed expiry.
  const premiumNeedsDate = plan === 'premium' && (planChanged || untilChanged) && (!until || untilInPast);
  const nameInvalid = name.trim().length < 2;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (premiumNeedsDate || nameInvalid) return;

    const body: UserPatch = {};
    if (nameChanged) body.name = name.trim();
    if (disabledChanged) body.isDisabled = disabled;
    if (planChanged || untilChanged) {
      body.plan = plan;
      // The backend clears the date itself on downgrade; sending it makes the
      // intent explicit in the audit row and in the manual subscription.
      body.premiumUntil = plan === 'premium' ? untilIso : null;
      body.reason = 'منح يدوي من نموذج تعديل المستخدم';
    }
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }

    // Suspending an account is a destructive act wherever it is triggered, so
    // it gets the same named confirmation as the row action — and the whole
    // save waits on it, rather than half of it going through.
    if (disabledChanged) {
      const ok = await confirm({
        ...disableConfirmCopy(user, disabled),
        onConfirm: () => {},
      });
      if (!ok) return;
    }

    save.mutate({ id: user.id, ...body });
  }

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title="تعديل المستخدم"
      subtitle={user.email}
      mode="edit"
      onSubmit={handleSubmit}
      submitting={save.isPending}
      disabled={premiumNeedsDate || nameInvalid || !dirty}
      error={save.error}
      dirty={dirty}
      footerStart={
        canDelete ? (
          <Button
            variant="text"
            color="error"
            startIcon={<DeleteOutlineRounded />}
            disabled={save.isPending}
            onClick={() => void remove(user, onClose)}
          >
            حذف نهائي
          </Button>
        ) : undefined
      }
    >
      <Stack gap={0.5}>
        <Typography variant="caption" color="text.secondary">
          معرّف الحساب
        </Typography>
        <Mono value={user.id} copyable />
      </Stack>

      <TextField
        label="الاسم"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        inputProps={{ minLength: 2, maxLength: 120 }}
        error={nameChanged && nameInvalid}
        helperText={nameChanged && nameInvalid ? 'الاسم يجب ألا يقل عن حرفين' : ' '}
      />

      {/* Read-only on purpose: PATCH /admin/users/:id does not accept a
          language field, and zod would drop it silently — an editable control
          here would look like it saved and change nothing. */}
      <Stack gap={0.5}>
        <Typography variant="caption" color="text.secondary">
          لغة الواجهة
        </Typography>
        <Typography variant="body2">{user.language === 'en' ? 'الإنجليزية' : 'العربية'}</Typography>
        <Typography variant="caption" color="text.secondary">
          يغيّرها المستخدم من إعدادات التطبيق — لا تُعدَّل من هنا.
        </Typography>
      </Stack>

      {canGrant ? (
        <>
          <TextField
            select
            label="الخطة"
            value={plan}
            onChange={(e) => setPlan(e.target.value as UserPlan)}
            helperText="الوصول المميز يعتمد على تاريخ الانتهاء، وليس على الخطة وحدها"
          >
            <MenuItem value="free">مجاني</MenuItem>
            <MenuItem value="premium">مميز</MenuItem>
          </TextField>

          {plan === 'premium' ? (
            <Stack gap={1.5}>
              <TextField
                label="ينتهي الاشتراك المميز في"
                type="date"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                InputLabelProps={{ shrink: true }}
                inputProps={{ min: todayPlus(1) }}
                error={premiumNeedsDate}
                helperText={
                  premiumNeedsDate
                    ? 'اختر تاريخًا في المستقبل — بدونه لا يحصل المستخدم على أي مزايا'
                    : 'ينتهي في نهاية اليوم المحدد بتوقيت جهازك'
                }
              />
              <Stack direction="row" gap={1} sx={{ flexWrap: 'wrap' }}>
                {QUICK_GRANTS.map((g) => (
                  <Button
                    key={g.days}
                    size="small"
                    variant="outlined"
                    onClick={() => setUntil(todayPlus(g.days))}
                  >
                    {g.label}
                  </Button>
                ))}
              </Stack>
            </Stack>
          ) : (
            initial.plan === 'premium' && (
              <Alert severity="warning">
                سيتم إلغاء الوصول المميز فورًا ومسح تاريخ الانتهاء. إذا كان للمستخدم اشتراك مدفوع
                فعّال فسيرفض الخادم ذلك، ويجب إلغاء الاشتراك نفسه من صفحة الاشتراكات.
              </Alert>
            )
          )}
        </>
      ) : (
        /* Read-only for a moderator: the state is useful, the lever is not
           theirs. Hidden rather than disabled, with the reason stated. */
        <Stack gap={0.5}>
          <Typography variant="caption" color="text.secondary">
            الخطة
          </Typography>
          <Typography variant="body2">
            {initial.plan === 'premium' ? 'مميز' : 'مجاني'}
            {initial.plan === 'premium' && initial.until ? ` — حتى ${initial.until}` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            منح الاشتراك المميز أو إلغاؤه من صلاحيات المدير العام وحده، لأنه ينشئ اشتراكًا فعليًا لا
            يظهر في صفحة الاشتراكات إلا له.
          </Typography>
        </Stack>
      )}

      <Stack gap={0.5}>
        <FormControlLabel
          control={
            <Switch
              checked={disabled}
              onChange={(e) => setDisabled(e.target.checked)}
              color="warning"
            />
          }
          label="إيقاف الحساب"
        />
        <Typography variant="caption" color="text.secondary">
          {disabled
            ? 'لن يتمكن المستخدم من تسجيل الدخول. سيُطلب تأكيد قبل الحفظ.'
            : 'الحساب يعمل بشكل طبيعي.'}
        </Typography>
      </Stack>

      <Alert severity="info">
        منح الاشتراك من هنا ينشئ اشتراكًا يدويًا (بدون عملية دفع) ويُسجَّل في سجل العمليات.
      </Alert>
    </FormDrawer>
  );
}
