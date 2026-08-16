import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import BoltRounded from '@mui/icons-material/BoltRounded';

import { FormDrawer } from '../../components/common/FormDrawer';
import { Mono } from '../../components/common/Mono';
import { useToast } from '../../components/common/ToastProvider';
import { parseApiError } from '../../lib/errors';
import {
  probeMessage,
  useClearCredential,
  useSetCredential,
  useTestCredential,
  type Credential,
  type ProbeResult,
} from './api';
import { copyFor } from './registry';

export type CredentialDrawerMode = 'set' | 'clear';

export interface CredentialDrawerProps {
  credential: Credential | null;
  mode: CredentialDrawerMode;
  onClose: () => void;
}

const BOOLEAN_OPTIONS = [
  { value: 'true', label: 'مفعّل' },
  { value: 'false', label: 'موقوف' },
];

/**
 * The single write surface for a provider credential.
 *
 * Three things here are security requirements, not preferences:
 *  1. The value field starts EMPTY and is never seeded from a GET, because no
 *     GET returns a secret. `autoComplete="new-password"` keeps the browser
 *     from filling it with the admin's own login password.
 *  2. Saving requires the admin's password again. A borrowed session must not
 *     be enough to swap the payment gateway key.
 *  3. For a testable key, Save stays disabled until a test has actually
 *     reached the provider — the point of the test is that it gates the write.
 */
export function CredentialDrawer({ credential, mode, onClose }: CredentialDrawerProps) {
  const toast = useToast();
  const setCred = useSetCredential();
  const clearCred = useClearCredential();
  const test = useTestCredential();

  const [value, setValue] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);

  const open = credential !== null;

  // Everything resets whenever the drawer targets a different credential, so a
  // value typed for one key can never be submitted against another.
  useEffect(() => {
    setValue('');
    setPassword('');
    setReveal(false);
    setProbe(null);
    setCred.reset();
    clearCred.reset();
    test.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credential?.key, mode]);

  if (!credential) return null;

  const copy = copyFor(credential.key);
  const isClear = mode === 'clear';
  const submitting = setCred.isPending || clearCred.isPending;

  // A test result describes the value that was tested; the moment the value
  // changes it is stale and the gate closes again.
  function changeValue(next: string) {
    setValue(next);
    if (probe) setProbe(null);
  }

  const needsTest = !isClear && credential.testable;
  const testPassed = probe?.ok === true;

  const canSubmit = isClear
    ? password.length > 0
    : value.trim().length > 0 && password.length > 0 && (!needsTest || testPassed);

  function runTest() {
    if (!value.trim()) {
      toast.error('أدخل القيمة أولًا لاختبارها');
      return;
    }
    test.mutate(
      { key: credential!.key, value: value.trim() },
      {
        onSuccess: (result) => setProbe(result),
        onError: (err) => {
          setProbe(null);
          toast.error(parseApiError(err).messageAr);
        },
      },
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;

    if (isClear) {
      clearCred.mutate(
        { key: credential!.key, currentPassword: password },
        {
          onSuccess: () => {
            toast.success('تم مسح القيمة المحفوظة');
            onClose();
          },
          onError: (err) => toast.error(parseApiError(err).messageAr),
        },
      );
      return;
    }

    setCred.mutate(
      { key: credential!.key, value: value.trim(), currentPassword: password },
      {
        onSuccess: () => {
          toast.success('تم حفظ القيمة');
          onClose();
        },
        onError: (err) => toast.error(parseApiError(err).messageAr),
      },
    );
  }

  const probeInfo = probe ? probeMessage(probe) : null;

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title={isClear ? `مسح ${copy.labelAr}` : copy.labelAr}
      subtitle={credential.key}
      mode={credential.isSet ? 'edit' : 'create'}
      onSubmit={submit}
      submitting={submitting}
      submitLabel={isClear ? 'مسح القيمة' : credential.isSet ? 'استبدال' : 'حفظ'}
      disabled={!canSubmit}
      error={setCred.error ?? clearCred.error}
      dirty={value.length > 0 || password.length > 0}
    >
      {isClear ? (
        <Alert severity="warning">
          <AlertTitle>ما الذي سيحدث</AlertTitle>
          <Stack component="ul" gap={0.5} sx={{ m: 0, paddingInlineStart: 2.5 }}>
            <Typography component="li" variant="body2">
              ستُحذف القيمة المحفوظة في قاعدة البيانات نهائيًا.
            </Typography>
            <Typography component="li" variant="body2">
              {credential.source === 'db'
                ? 'سيعود الخادم إلى القيمة الموجودة في ملف البيئة (.env) إن وُجدت، وإلا يصبح هذا المفتاح غير مضبوط.'
                : 'سيصبح هذا المفتاح غير مضبوط.'}
            </Typography>
            {credential.group === 'payments' && (
              <Typography component="li" variant="body2">
                قد تتوقف عمليات الدفع الجديدة فورًا.
              </Typography>
            )}
          </Stack>
        </Alert>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary">
            {copy.help}
          </Typography>

          {copy.whereAr && (
            <Typography variant="caption" color="text.secondary">
              مصدر القيمة: {copy.whereAr}
            </Typography>
          )}

          {copy.caution && <Alert severity="warning">{copy.caution}</Alert>}

          {credential.secret && credential.isSet && (
            <Alert severity="info">
              يوجد مفتاح مثبَّت حاليًا ينتهي بـ <Mono value={credential.last4} />. لا يمكن عرضه —
              الحفظ هنا يستبدله بالكامل.
            </Alert>
          )}

          <ValueField
            credential={credential}
            value={value}
            onChange={changeValue}
            reveal={reveal}
            onToggleReveal={() => setReveal((v) => !v)}
            disabled={submitting}
          />

          {needsTest && (
            <Box>
              <Button
                variant="outlined"
                startIcon={test.isPending ? <CircularProgress size={16} /> : <BoltRounded />}
                onClick={runTest}
                disabled={test.isPending || submitting || !value.trim()}
              >
                اختبار الاتصال
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                يجب نجاح الاختبار قبل الحفظ. لا تُرسَل القيمة في أي رد من الخادم.
              </Typography>
            </Box>
          )}

          {probeInfo && (
            <Alert severity={probeInfo.severity}>
              <AlertTitle>
                {probe?.verified ? 'تم التحقق' : probe?.ok ? 'نجح جزئيًا' : 'فشل الاختبار'}
              </AlertTitle>
              {probeInfo.text}
            </Alert>
          )}
        </>
      )}

      <TextField
        type="password"
        label="أكّد كلمة مرورك"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        disabled={submitting}
        required
        helperText="مطلوبة لأن هذا الإجراء يغيّر بيانات اعتماد إنتاجية."
        inputProps={{ dir: 'ltr', style: { textAlign: 'start' } }}
      />
    </FormDrawer>
  );
}

interface ValueFieldProps {
  credential: Credential;
  value: string;
  onChange: (next: string) => void;
  reveal: boolean;
  onToggleReveal: () => void;
  disabled: boolean;
}

/** The right control for the credential's declared type. */
function ValueField({ credential, value, onChange, reveal, onToggleReveal, disabled }: ValueFieldProps) {
  const label = 'القيمة الجديدة';

  if (credential.type === 'boolean') {
    return (
      <TextField
        select
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required
      >
        {BOOLEAN_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
        ))}
      </TextField>
    );
  }

  if (credential.type === 'select') {
    return (
      <TextField
        select
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required
      >
        {(credential.options ?? []).map((o) => (
          <MenuItem key={o} value={o} sx={{ direction: 'ltr' }}>{o}</MenuItem>
        ))}
      </TextField>
    );
  }

  if (credential.secret) {
    return (
      <TextField
        // Never bound to a GET value — there is no GET value to bind to.
        type={reveal ? 'text' : 'password'}
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // "new-password" stops the browser autofilling the ADMIN's own login
        // password into a field that would then be sent to a payment provider.
        autoComplete="new-password"
        spellCheck={false}
        disabled={disabled}
        required
        placeholder="ألصق المفتاح هنا"
        inputProps={{ dir: 'ltr', style: { textAlign: 'start' } }}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                onClick={onToggleReveal}
                edge="end"
                size="small"
                aria-label={reveal ? 'إخفاء القيمة' : 'إظهار القيمة'}
                tabIndex={-1}
              >
                {reveal ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
              </IconButton>
            </InputAdornment>
          ),
        }}
      />
    );
  }

  return (
    <TextField
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      required
      multiline={credential.type === 'csv'}
      placeholder={credential.value ?? undefined}
      helperText={credential.type === 'csv' ? 'افصل بين القيم بفاصلة. الترتيب مهم.' : undefined}
      inputProps={{ dir: 'ltr', style: { textAlign: 'start' } }}
    />
  );
}
