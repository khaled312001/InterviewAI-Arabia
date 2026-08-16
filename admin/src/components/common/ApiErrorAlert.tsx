import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import { parseApiError } from '../../lib/errors';

export interface ApiErrorAlertProps {
  error: unknown;
  onRetry?: () => void;
}

/** The inline, form-level error surface used by FormDrawer. */
export function ApiErrorAlert({ error, onRetry }: ApiErrorAlertProps) {
  if (!error) return null;
  const { messageAr } = parseApiError(error);
  return (
    <Alert
      severity="error"
      action={
        onRetry && (
          <Button color="inherit" size="small" onClick={onRetry}>
            إعادة المحاولة
          </Button>
        )
      }
    >
      {messageAr}
    </Alert>
  );
}
