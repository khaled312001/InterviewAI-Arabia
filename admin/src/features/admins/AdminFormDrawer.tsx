import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { FormDrawer } from '../../components/common/FormDrawer';
import { Mono } from '../../components/common/Mono';
import { ROLE_LABEL_AR } from '../../lib/permissions';
import type { AdminRole } from '../../store/auth';
import { useCreateAdmin, useSaveAdmin, type AdminAccount } from './api';

const ROLES: AdminRole[] = ['super_admin', 'moderator', 'content_editor'];

const ROLE_HELP: Record<AdminRole, string> = {
  super_admin: 'صلاحية كاملة: المستخدمون، المحتوى، الاشتراكات، الإعدادات، وإدارة المدراء.',
  moderator: 'يراجع البلاغات ويدير حالة المستخدمين وخططهم. لا يصل إلى الإعدادات ولا المدراء.',
  content_editor: 'يحرّر الأسئلة والأقسام فقط.',
};

export interface AdminFormDrawerProps {
  open: boolean;
  /** null ⇒ create mode. */
  admin: AdminAccount | null;
  /** The signed-in admin's id — an account may not change its own role. */
  currentAdminId: string | undefined;
  onClose: () => void;
}

export function AdminFormDrawer({ open, admin, currentAdminId, onClose }: AdminFormDrawerProps) {
  const mode = admin ? 'edit' : 'create';
  const isSelf = Boolean(admin && admin.id === currentAdminId);

  const initial = useMemo(
    () => ({ email: admin?.email ?? '', name: admin?.name ?? '', role: (admin?.role ?? 'moderator') as AdminRole }),
    [admin],
  );

  const [email, setEmail] = useState(initial.email);
  const [name, setName] = useState(initial.name);
  const [role, setRole] = useState<AdminRole>(initial.role);
  const [password, setPassword] = useState('');

  useEffect(() => {
    setEmail(initial.email);
    setName(initial.name);
    setRole(initial.role);
    setPassword('');
  }, [initial, open]);

  const create = useCreateAdmin(onClose);
  const save = useSaveAdmin(onClose);
  const active = admin ? save : create;

  const dirty =
    mode === 'create'
      ? Boolean(email || name || password)
      : name !== initial.name || role !== initial.role || password.length > 0;

  const passwordInvalid = password.length > 0 && password.length < 8;
  const requiredMissing =
    mode === 'create' ? !email || name.trim().length < 2 || password.length < 8 : name.trim().length < 2;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (passwordInvalid || requiredMissing) return;

    if (!admin) {
      create.mutate({ email: email.trim().toLowerCase(), name: name.trim(), password, role });
      return;
    }
    save.mutate({
      id: admin.id,
      ...(name !== initial.name ? { name: name.trim() } : null),
      ...(role !== initial.role ? { role } : null),
      ...(password ? { password } : null),
    });
  }

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title={mode === 'create' ? 'مدير جديد' : 'تعديل المدير'}
      subtitle={admin?.email}
      mode={mode}
      onSubmit={handleSubmit}
      submitting={active.isPending}
      disabled={passwordInvalid || requiredMissing || !dirty}
      error={active.error}
      dirty={dirty}
    >
      {mode === 'create' ? (
        <TextField
          label="البريد الإلكتروني"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="off"
          inputProps={{ dir: 'ltr' }}
          helperText="يُستخدم لتسجيل الدخول، ولا يمكن تغييره بعد الإنشاء"
        />
      ) : (
        <Stack gap={0.5}>
          <Typography variant="caption" color="text.secondary">
            البريد الإلكتروني
          </Typography>
          <Mono value={admin?.email} copyable />
        </Stack>
      )}

      <TextField
        label="الاسم"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        inputProps={{ minLength: 2, maxLength: 120 }}
      />

      <TextField
        select
        label="الصلاحية"
        value={role}
        onChange={(e) => setRole(e.target.value as AdminRole)}
        disabled={isSelf}
        helperText={isSelf ? 'لا يمكنك تغيير صلاحيتك بنفسك' : ROLE_HELP[role]}
      >
        {ROLES.map((r) => (
          <MenuItem key={r} value={r}>
            {ROLE_LABEL_AR[r]}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        label={mode === 'create' ? 'كلمة المرور المبدئية' : 'كلمة مرور جديدة (اختياري)'}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required={mode === 'create'}
        autoComplete="new-password"
        inputProps={{ minLength: 8, dir: 'ltr' }}
        error={passwordInvalid}
        helperText={
          passwordInvalid
            ? 'كلمة المرور يجب ألا تقل عن ٨ أحرف'
            : mode === 'create'
              ? '٨ أحرف على الأقل — سلّمها للمدير ليغيّرها لاحقًا'
              : 'اتركها فارغة للإبقاء على كلمة المرور الحالية'
        }
      />

      {mode === 'edit' && (
        <Alert severity="info">
          التفعيل والتعطيل والحذف تتم من إجراءات الصف في الجدول، مع تأكيد منفصل.
        </Alert>
      )}
    </FormDrawer>
  );
}
