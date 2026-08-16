import { useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import LockOutlined from '@mui/icons-material/LockOutlined';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import { apiErrorDetails, parseApiError } from '../../lib/errors';
import { monoFamily } from '../../theme/typography';

export interface ErrorStateProps {
  error?: unknown;
  title?: string;
  description?: string;
  onRetry?: () => void;
  variant?: 'inline' | 'block' | 'page';
  /** 403 preset. */
  forbidden?: boolean;
  showDetails?: boolean;
  requiredRole?: string;
  currentRole?: string;
}

export function ErrorState({
  error,
  title,
  description,
  onRetry,
  variant = 'block',
  forbidden = false,
  showDetails = import.meta.env.DEV,
  requiredRole,
  currentRole,
}: ErrorStateProps) {
  const [open, setOpen] = useState(false);
  const parsed = parseApiError(error);
  const isForbidden = forbidden || parsed.status === 403;

  const heading = title ?? (isForbidden ? 'ليس لديك صلاحية' : parsed.messageAr);
  const body =
    description ??
    (isForbidden
      ? [
          requiredRole ? `هذا الإجراء متاح لدور: ${requiredRole}` : 'هذا الإجراء متاح لدور أعلى.',
          currentRole ? `دورك الحالي: ${currentRole}` : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : 'حاول مرة أخرى، أو تواصل مع الدعم إذا تكرر الخطأ.');

  const details = apiErrorDetails(error);
  const retry = onRetry && (
    <Button size="small" variant="outlined" startIcon={<RefreshRounded />} onClick={onRetry}>
      إعادة المحاولة
    </Button>
  );

  // No entrance animation: fading in a failure reads as an unfinished load.
  if (variant === 'inline') {
    return (
      <Alert severity="error" action={retry}>
        <AlertTitle sx={{ mb: 0 }}>{heading}</AlertTitle>
        {body}
      </Alert>
    );
  }

  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      gap={1.5}
      sx={{
        minHeight: variant === 'page' ? '60vh' : 320,
        textAlign: 'center',
        paddingInline: 3,
        paddingBlock: 4,
      }}
    >
      <Box sx={{ color: 'error.main', display: 'grid', placeItems: 'center', '& > svg': { fontSize: 56 } }}>
        {isForbidden ? <LockOutlined /> : <ErrorOutlineRounded />}
      </Box>
      <Typography variant="h5">{heading}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520 }}>
        {body}
      </Typography>
      {retry}
      {showDetails && details && (
        <>
          <Button size="small" variant="text" onClick={() => setOpen((v) => !v)}>
            {open ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
          </Button>
          <Collapse in={open}>
            <Typography
              variant="caption"
              className="ltr-island"
              sx={{
                fontFamily: monoFamily,
                display: 'block',
                maxWidth: 620,
                overflowX: 'auto',
                textAlign: 'start',
                color: 'text.disabled',
              }}
            >
              {details}
            </Typography>
          </Collapse>
        </>
      )}
    </Stack>
  );
}
