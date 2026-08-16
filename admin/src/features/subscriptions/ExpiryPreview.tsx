import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import { RelativeTime } from '../../components/common/RelativeTime';

export interface ExpiryPreviewProps {
  /** The coverage in force right now — null when the user has none. */
  currentExpiresAt: string | Date | null | undefined;
  /** What the write would make it. null while the form is incomplete. */
  nextExpiresAt: Date | null;
  title?: string;
  /** Shown under the arrow — e.g. that the extension adds to paid days. */
  note?: string;
}

/**
 * "ينتهي حاليًا X ← سيصبح Y".
 *
 * The server extends from the current expiry rather than overwriting it
 * (computeExpiry in services/payments/plans.js). That is the single most
 * consequential behaviour on this page and it is invisible in a form that only
 * asks for a number of days, so it is stated before the operator commits.
 * The arrow points to the inline-end side, which is the correct direction of
 * travel in RTL.
 */
export function ExpiryPreview({
  currentExpiresAt,
  nextExpiresAt,
  title = 'أثر هذا الإجراء',
  note,
}: ExpiryPreviewProps) {
  return (
    <Alert severity="info" icon={false}>
      <AlertTitle>{title}</AlertTitle>
      <Stack direction="row" alignItems="center" gap={1.5} sx={{ flexWrap: 'wrap' }}>
        <Stack gap={0.25}>
          <Typography variant="caption" color="text.secondary">
            الوصول الحالي
          </Typography>
          {currentExpiresAt ? (
            <RelativeTime value={currentExpiresAt} mode="both" variant="body2" />
          ) : (
            <Typography variant="body2">لا يوجد وصول مميز</Typography>
          )}
        </Stack>

        <ArrowBackRounded fontSize="small" sx={{ color: 'text.disabled' }} />

        <Stack gap={0.25}>
          <Typography variant="caption" color="text.secondary">
            بعد التنفيذ
          </Typography>
          {nextExpiresAt ? (
            <RelativeTime value={nextExpiresAt.toISOString()} mode="both" variant="body2" />
          ) : (
            <Typography variant="body2" color="text.disabled">
              —
            </Typography>
          )}
        </Stack>
      </Stack>
      {note && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {note}
        </Typography>
      )}
    </Alert>
  );
}
