import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloseRounded from '@mui/icons-material/CloseRounded';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { ApiErrorAlert } from './ApiErrorAlert';
import { useConfirm } from './ConfirmDialog';

export interface FormDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  mode?: 'create' | 'edit';
  onSubmit: (e: React.FormEvent) => void;
  submitting?: boolean;
  submitLabel?: string;
  disabled?: boolean;
  error?: unknown;
  width?: number;
  dirty?: boolean;
  /**
   * Turns off the browser's own constraint validation. Set it only when the
   * form supplies complete inline validation of its own: native bubbles are
   * browser-locale chrome that cannot be translated, so on an Arabic form they
   * arrive in whatever language the browser was installed in.
   */
  noValidate?: boolean;
  /** e.g. a Delete button, pinned to the footer's inline-start. */
  footerStart?: React.ReactNode;
  /**
   * Replaces the cancel/submit pair entirely. For a drawer that has stopped
   * being a form — e.g. the one-time credential panel shown after a user is
   * created, whose only sensible action is an acknowledgement.
   */
  footer?: React.ReactNode;
  /**
   * Overrides the "discard changes?" copy used when a dirty drawer is closed.
   * The guard is worth reusing whenever closing loses something, but "لديك
   * تعديلات غير محفوظة" is the wrong sentence when what is lost is a password
   * that will never be shown again.
   */
  closeConfirm?: {
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
  };
  children: React.ReactNode;
}

/**
 * The single create/edit surface. anchor="left" is the inline-start edge —
 * MUI mirrors it to the visual right under theme.direction 'rtl'.
 * The body is a real <form>, so required / type=email / minLength validate.
 */
export function FormDrawer({
  open,
  onClose,
  title,
  subtitle,
  mode = 'create',
  onSubmit,
  submitting = false,
  submitLabel,
  disabled = false,
  error,
  width,
  dirty = false,
  noValidate = false,
  footerStart,
  footer,
  closeConfirm,
  children,
}: FormDrawerProps) {
  const theme = useTheme();
  const confirm = useConfirm();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));

  async function requestClose() {
    if (submitting) return;
    if (dirty) {
      const ok = await confirm({
        title: closeConfirm?.title ?? 'تجاهل التغييرات؟',
        description: closeConfirm?.description ?? 'لديك تعديلات غير محفوظة سيتم فقدانها.',
        confirmLabel: closeConfirm?.confirmLabel ?? 'تجاهل',
        cancelLabel: closeConfirm?.cancelLabel ?? 'متابعة التحرير',
        tone: 'danger',
        onConfirm: () => {},
      });
      if (!ok) return;
    }
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={requestClose}
      anchor={isXs ? 'bottom' : 'left'}
      slotProps={{
        paper: {
          sx: {
            width: isXs ? '100%' : { sm: 420, md: 480, lg: width ?? 520 },
            height: isXs ? '92vh' : '100%',
            display: 'flex',
            flexDirection: 'column',
          },
        },
      }}
    >
      <Box component="form" onSubmit={onSubmit} noValidate={noValidate} sx={{ display: 'contents' }}>
        <Stack
          direction="row"
          alignItems="center"
          gap={1}
          sx={{ position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.paper', p: 2.5, pb: 1.5 }}
        >
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h5" noWrap>
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="body2" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
          <IconButton onClick={requestClose} aria-label="إغلاق" disabled={submitting}>
            <CloseRounded />
          </IconButton>
        </Stack>
        <Divider />

        <Stack gap={2.5} sx={{ flexGrow: 1, overflowY: 'auto', p: 2.5 }}>
          {error ? <ApiErrorAlert error={error} /> : null}
          {children}
        </Stack>

        <Divider />
        <Stack
          direction="row"
          alignItems="center"
          gap={1}
          sx={{ position: 'sticky', bottom: 0, bgcolor: 'background.paper', p: 2.5 }}
        >
          {footerStart}
          <Box sx={{ flexGrow: 1 }} />
          {footer ?? (
            <>
              <Button variant="text" color="inherit" onClick={requestClose} disabled={submitting}>
                إلغاء
              </Button>
              <Button type="submit" disabled={submitting || disabled} sx={{ minWidth: 120 }}>
                {submitting ? (
                  <CircularProgress size={18} color="inherit" />
                ) : (
                  (submitLabel ?? (mode === 'create' ? 'إنشاء' : 'حفظ'))
                )}
              </Button>
            </>
          )}
        </Stack>
      </Box>
    </Drawer>
  );
}
