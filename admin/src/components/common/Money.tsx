import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { TypographyProps } from '@mui/material/Typography';
import { formatMoney } from '../../lib/format';

export interface MoneyProps {
  amount: number | null | undefined;
  currency?: 'EGP' | 'USD';
  /** 'micro' reads AiUsageLog.costMicroUsd; 'minor' is piastres/cents. */
  unit?: 'minor' | 'major' | 'micro';
  precision?: number;
  variant?: TypographyProps['variant'];
  color?: TypographyProps['color'];
  emptyLabel?: string;
  /** Mandatory whenever the figure is an estimate. */
  approximate?: boolean;
  tooltip?: string;
}

const DIVISOR = { minor: 100, major: 1, micro: 1_000_000 } as const;

export function Money({
  amount,
  currency = 'EGP',
  unit = 'minor',
  precision,
  variant = 'inherit',
  color,
  emptyLabel = '—',
  approximate = false,
  tooltip,
}: MoneyProps) {
  // A null amount is not zero. Rendering 0 for "we don't know" is the bug this
  // component exists to prevent.
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    const node = (
      <Typography component="span" variant={variant} color={color ?? 'text.disabled'}>
        {emptyLabel}
      </Typography>
    );
    return tooltip ? <Tooltip title={tooltip}>{node}</Tooltip> : node;
  }

  const digits = precision ?? (unit === 'micro' ? 4 : 2);
  const text = formatMoney(amount / DIVISOR[unit], currency, digits);

  const node = (
    <Typography component="span" variant={variant} color={color} className="ltr-island tabular">
      {approximate ? `≈ ${text}` : text}
    </Typography>
  );
  return tooltip ? <Tooltip title={tooltip}>{node}</Tooltip> : node;
}
