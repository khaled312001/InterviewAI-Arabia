import { useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { TypographyProps } from '@mui/material/Typography';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import { monoFamily } from '../../theme/typography';
import { truncateMiddle } from '../../lib/format';
import { useToast } from './ToastProvider';

export interface MonoProps {
  value: string | number | null | undefined;
  /** Middle-truncates while keeping the full value in a tooltip. */
  maxChars?: number;
  copyable?: boolean;
  variant?: TypographyProps['variant'];
  color?: TypographyProps['color'];
  emptyLabel?: string;
}

/** IDs, tokens, emails, last4, model names — Latin runs that must not reorder. */
export function Mono({
  value,
  maxChars,
  copyable = false,
  variant = 'body2',
  color,
  emptyLabel = '—',
}: MonoProps) {
  const toast = useToast();
  const [copying, setCopying] = useState(false);

  if (value === null || value === undefined || value === '') {
    return (
      <Typography component="span" variant={variant} color="text.disabled">
        {emptyLabel}
      </Typography>
    );
  }

  const text = String(value);
  const shown = maxChars ? truncateMiddle(text, maxChars) : text;

  async function copy() {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(text);
      toast.success('تم النسخ');
    } catch {
      toast.error('تعذّر النسخ');
    } finally {
      setCopying(false);
    }
  }

  const label = (
    <Tooltip title={shown === text ? '' : text}>
      <Typography
        component="span"
        variant={variant}
        color={color}
        className="ltr-island"
        sx={{ fontFamily: monoFamily, fontSize: '0.8125rem' }}
      >
        {shown}
      </Typography>
    </Tooltip>
  );

  if (!copyable) return label;

  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      {label}
      <Tooltip title="نسخ">
        <IconButton size="small" onClick={copy} disabled={copying} aria-label="نسخ">
          <ContentCopyRounded sx={{ fontSize: 15 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
