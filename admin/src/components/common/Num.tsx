import Typography from '@mui/material/Typography';
import type { TypographyProps } from '@mui/material/Typography';
import { formatNumber, type NumFormat } from '../../lib/format';

export interface NumProps {
  value: number | null | undefined;
  format?: NumFormat;
  /** Fraction digits for format='decimal'. */
  digits?: number;
  emptyLabel?: string;
  variant?: TypographyProps['variant'];
  color?: TypographyProps['color'];
  component?: React.ElementType;
}

/** Every numeric run inside Arabic copy goes through here — bare numbers get
 *  reordered by the bidi algorithm once punctuation is adjacent. */
export function Num({
  value,
  format = 'int',
  digits = 1,
  emptyLabel = '—',
  variant = 'inherit',
  color,
  component = 'span',
}: NumProps) {
  const isEmpty = value === null || value === undefined || Number.isNaN(value);
  return (
    <Typography
      component={component}
      variant={variant}
      color={color}
      className={isEmpty ? undefined : 'ltr-island tabular'}
    >
      {isEmpty ? emptyLabel : formatNumber(value, format, digits)}
    </Typography>
  );
}
