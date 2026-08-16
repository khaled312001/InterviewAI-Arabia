import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ArrowDropDownRounded from '@mui/icons-material/ArrowDropDownRounded';
import ArrowDropUpRounded from '@mui/icons-material/ArrowDropUpRounded';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import { Link as RouterLink } from 'react-router-dom';
import type { Theme } from '@mui/material/styles';
import { radius } from '../../theme/tokens';
import { staggerDelay } from '../../theme/motion';
import { formatMoney, formatNumber } from '../../lib/format';
import { useCountUp } from '../../lib/hooks/useCountUp';
import { usePrefersReducedMotion } from '../../lib/hooks/usePrefersReducedMotion';
import { StatCardSkeleton } from './Skeletons';
import type { Tone } from './StatusChip';

export interface StatCardProps {
  label: string;
  value: number | string | undefined;
  format?: 'number' | 'money' | 'percent' | 'compact' | 'raw';
  currency?: 'EGP' | 'USD';
  /** Money decimal places. Sub-cent AI spend rounds to a misleading 0.00 at 2. */
  precision?: number;
  icon?: React.ReactNode;
  tone?: Tone;
  hint?: string;
  delta?: { value: number; label?: string; goodWhen?: 'up' | 'down' };
  loading?: boolean;
  /** A failed fetch shows '—'. It must never render a confident 0. */
  error?: boolean;
  href?: string;
  countUp?: boolean;
  /** First-mount stagger position; ignored on refetch and under reduced motion. */
  index?: number;
  'data-testid'?: string;
}

const TONE_PATH: Record<Tone, 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info' | null> = {
  brand: 'primary',
  gold: 'secondary',
  success: 'success',
  warning: 'warning',
  error: 'error',
  info: 'info',
  neutral: null,
};

export function StatCard({
  label,
  value,
  format = 'number',
  currency = 'EGP',
  precision = 2,
  icon,
  tone = 'brand',
  hint,
  delta,
  loading = false,
  error = false,
  href,
  countUp = true,
  index = 0,
  'data-testid': testId,
}: StatCardProps) {
  const reduced = usePrefersReducedMotion();
  const numeric = typeof value === 'number' && !error ? value : undefined;
  const animated = useCountUp(numeric, countUp && format !== 'raw');

  if (loading) return <StatCardSkeleton />;

  const path = TONE_PATH[tone];
  const shown = animated ?? numeric;
  const displayValue = error
    ? '—'
    : value === undefined
      ? '—'
      : typeof value === 'string'
        ? value
        : format === 'money'
          ? formatMoney(shown ?? 0, currency, precision)
          : format === 'percent'
            ? formatNumber(shown ?? 0, 'percent')
            : format === 'compact'
              ? formatNumber(shown ?? 0, 'compact')
              : format === 'raw'
                ? String(value)
                : formatNumber(shown ?? 0, 'int');

  const deltaGood = delta ? (delta.goodWhen === 'down' ? delta.value < 0 : delta.value > 0) : false;

  const body = (
    <CardContent>
      <Stack gap={1.5}>
        <Stack direction="row" alignItems="center" gap={1.5}>
          {icon && (
            <Box
              sx={(t: Theme) => ({
                width: 40,
                height: 40,
                flexShrink: 0,
                display: 'grid',
                placeItems: 'center',
                borderRadius: `${radius.md}px`,
                color: path ? `${path}.main` : 'text.secondary',
                backgroundColor: `rgba(${
                  path ? t.vars.palette[path].mainChannel : t.vars.palette.text.secondaryChannel
                } / 0.12)`,
              })}
            >
              {icon}
            </Box>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0 }}>
            {label}
          </Typography>
          {error && (
            <Tooltip title="تعذّر تحميل هذه القيمة">
              <WarningAmberRounded sx={{ fontSize: 18, color: 'warning.main' }} />
            </Tooltip>
          )}
        </Stack>

        <Typography variant="h3" className="tabular ltr-island" color={error ? 'text.disabled' : undefined}>
          {displayValue}
        </Typography>

        {delta && !error && (
          <Stack direction="row" alignItems="center" gap={0.5}>
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                color: deltaGood ? 'success.main' : 'error.main',
              }}
            >
              {delta.value >= 0 ? <ArrowDropUpRounded /> : <ArrowDropDownRounded />}
              <Typography variant="caption" className="tabular ltr-island" color="inherit">
                {formatNumber(Math.abs(delta.value), 'percent')}
              </Typography>
            </Box>
            {delta.label && (
              <Typography variant="caption" color="text.secondary">
                {delta.label}
              </Typography>
            )}
          </Stack>
        )}

        {hint && !delta && (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        )}
      </Stack>
    </CardContent>
  );

  return (
    <Card
      data-testid={testId}
      sx={(t: Theme) => ({
        height: '100%',
        // Base state is visible; the keyframe only supplies the entrance. If
        // animations never run the card is still readable.
        animationName: 'statcard-in',
        animationFillMode: 'backwards',
        animationDuration: `${t.transitions.duration.short}ms`,
        animationTimingFunction: t.transitions.easing.easeOut,
        animationDelay: `${staggerDelay(index, reduced)}ms`,
        '@keyframes statcard-in': {
          from: { opacity: 0, transform: 'translateY(6px)' },
        },
        ...(href && { '&:hover': { borderColor: 'primary.main' } }),
      })}
    >
      {href ? (
        <CardActionArea component={RouterLink} to={href} sx={{ height: '100%' }}>
          {body}
        </CardActionArea>
      ) : (
        body
      )}
    </Card>
  );
}
