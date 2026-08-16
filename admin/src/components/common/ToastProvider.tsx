import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Grow from '@mui/material/Grow';
import Snackbar from '@mui/material/Snackbar';
import { registerToastHandler, type ToastPayload, type ToastSeverity } from '../../lib/toastBus';

interface ToastOptions {
  action?: React.ReactNode;
  duration?: number;
}

interface ToastApi {
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
  warning: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

interface QueueItem extends ToastPayload {
  key: number;
  duration: number;
}

const DEFAULT_DURATION: Record<ToastSeverity, number> = {
  success: 3500,
  info: 4000,
  warning: 5000,
  error: 6000,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const current = queue[0];

  const push = useCallback((payload: ToastPayload & { duration?: number }) => {
    setQueue((q) => [
      ...q,
      {
        ...payload,
        key: Date.now() + Math.random(),
        duration: payload.duration ?? DEFAULT_DURATION[payload.severity],
      },
    ]);
  }, []);

  // The axios interceptors are not React; they raise toasts through the bus.
  useEffect(() => {
    registerToastHandler(push);
    return () => registerToastHandler(null);
  }, [push]);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, o) => push({ message, severity: 'success', ...o }),
      error: (message, o) => push({ message, severity: 'error', ...o }),
      info: (message, o) => push({ message, severity: 'info', ...o }),
      warning: (message, o) => push({ message, severity: 'warning', ...o }),
    }),
    [push],
  );

  const close = (_e?: unknown, reason?: string) => {
    if (reason === 'clickaway') return;
    setQueue((q) => q.slice(1));
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Snackbar
        key={current?.key}
        open={Boolean(current)}
        autoHideDuration={current?.duration}
        onClose={close}
        TransitionComponent={Grow}
      >
        <Alert
          severity={current?.severity ?? 'info'}
          variant="filled"
          onClose={() => close()}
          action={current?.action}
          sx={{ minWidth: 280, maxWidth: 460 }}
        >
          {current?.message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
