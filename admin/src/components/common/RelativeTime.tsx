import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { TypographyProps } from '@mui/material/Typography';
import { formatAbsolute, formatRelative, toDate, TIMEZONE } from '../../lib/format';

export interface RelativeTimeProps {
  value: string | number | Date | null | undefined;
  mode?: 'relative' | 'absolute' | 'both';
  emptyLabel?: string;
  timeZone?: string;
  variant?: TypographyProps['variant'];
  color?: TypographyProps['color'];
  showSeconds?: boolean;
}

export function RelativeTime({
  value,
  mode = 'relative',
  emptyLabel = '—',
  timeZone = TIMEZONE,
  variant = 'body2',
  color,
  showSeconds = false,
}: RelativeTimeProps) {
  const date = toDate(value);

  // An unparseable date renders the empty label. `new Date(null)` is 1/1/1970,
  // which reads as real data and is never what the row meant.
  if (!date) {
    return (
      <Typography component="span" variant={variant} color="text.disabled">
        {emptyLabel}
      </Typography>
    );
  }

  const absolute = formatAbsolute(date, { timeZone, showSeconds });
  const relative = formatRelative(date);
  const text = mode === 'absolute' ? absolute : mode === 'both' ? `${relative} · ${absolute}` : relative;

  return (
    <Tooltip title={mode === 'relative' ? absolute : ''}>
      <Typography
        component="time"
        variant={variant}
        color={color}
        dateTime={date.toISOString()}
        sx={{ whiteSpace: 'nowrap' }}
      >
        {text}
      </Typography>
    </Tooltip>
  );
}
