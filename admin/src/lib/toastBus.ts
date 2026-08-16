export type ToastSeverity = 'success' | 'error' | 'info' | 'warning';

export interface ToastPayload {
  message: string;
  severity: ToastSeverity;
  action?: React.ReactNode;
}

type Handler = (t: ToastPayload) => void;

let handler: Handler | null = null;

/** ToastProvider registers itself here so non-React code (the axios
 *  interceptors) can raise an Arabic toast without a context. */
export function registerToastHandler(fn: Handler | null) {
  handler = fn;
}

export function emitToast(payload: ToastPayload) {
  handler?.(payload);
}
