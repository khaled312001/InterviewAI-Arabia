import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { parseApiError } from '../../lib/errors';
import { useToast } from './ToastProvider';

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  /** Rendered as a bulleted warning Alert — say what is irreversible. */
  consequences?: string[];
  /** The user must type this exact string before confirm is enabled. */
  requireTypedConfirmation?: string;
  onConfirm: () => Promise<unknown> | unknown;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const toast = useToast();
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts);
    setTyped('');
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  function settle(result: boolean) {
    resolver.current?.(result);
    resolver.current = null;
    setOptions(null);
    setTyped('');
  }

  async function handleConfirm() {
    if (!options) return;
    setBusy(true);
    try {
      // The dialog stays open until the action settles, so the operator sees
      // the failure in context rather than after the surface disappeared.
      await options.onConfirm();
      settle(true);
    } catch (err) {
      toast.error(parseApiError(err).messageAr);
    } finally {
      setBusy(false);
    }
  }

  const gateOk = !options?.requireTypedConfirmation || typed === options.requireTypedConfirmation;
  const danger = options?.tone === 'danger';

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog open={Boolean(options)} onClose={() => !busy && settle(false)}>
        <DialogTitle>{options?.title}</DialogTitle>
        <DialogContent>
          <Stack gap={2}>
            {options?.description && (
              typeof options.description === 'string' ? (
                <Typography variant="body2" color="text.secondary">
                  {options.description}
                </Typography>
              ) : (
                options.description
              )
            )}

            {options?.consequences && options.consequences.length > 0 && (
              <Alert severity="warning">
                <AlertTitle>ما الذي سيحدث</AlertTitle>
                <Stack component="ul" gap={0.5} sx={{ m: 0, paddingInlineStart: 2.5 }}>
                  {options.consequences.map((c) => (
                    <Typography key={c} component="li" variant="body2">
                      {c}
                    </Typography>
                  ))}
                </Stack>
              </Alert>
            )}

            {options?.requireTypedConfirmation && (
              <TextField
                label={`اكتب «${options.requireTypedConfirmation}» للتأكيد`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                inputProps={{ dir: 'ltr' }}
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="inherit" onClick={() => settle(false)} disabled={busy}>
            {options?.cancelLabel ?? 'إلغاء'}
          </Button>
          <Button
            onClick={handleConfirm}
            color={danger ? 'error' : 'primary'}
            disabled={busy || !gateOk}
            // Width is locked so the label -> spinner swap causes no reflow.
            sx={{ minWidth: 120 }}
          >
            {busy ? <CircularProgress size={18} color="inherit" /> : (options?.confirmLabel ?? 'تأكيد')}
          </Button>
        </DialogActions>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
}
