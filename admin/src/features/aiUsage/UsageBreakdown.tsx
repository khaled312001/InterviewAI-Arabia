import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { EmptyState } from '../../components/common/EmptyState';
import { Money } from '../../components/common/Money';
import { Num } from '../../components/common/Num';
import type { UsageBucket } from './api';

export interface BreakdownRow extends UsageBucket {
  key: string;
  label: string;
}

/**
 * Share-of-cost rows for the provider and feature panels. The bar is share of
 * *cost*, not of calls: a cheap provider handling most traffic should not look
 * like the expensive one.
 */
export function UsageBreakdown({ rows, emptyTitle }: { rows: BreakdownRow[]; emptyTitle: string }) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} size="sm" />;
  }

  const totalCost = rows.reduce((sum, r) => sum + r.costMicroUsd, 0);

  return (
    <Stack gap={2}>
      {rows.map((row) => {
        // With no cost recorded anywhere, fall back to share of calls so the
        // bar still means something rather than collapsing to zero width.
        const totalCalls = rows.reduce((sum, r) => sum + r.calls, 0);
        const share =
          totalCost > 0
            ? row.costMicroUsd / totalCost
            : totalCalls > 0
              ? row.calls / totalCalls
              : 0;

        return (
          <Stack key={row.key} gap={0.75}>
            <Stack direction="row" alignItems="baseline" justifyContent="space-between" gap={2}>
              <Typography variant="subtitle2" sx={{ minWidth: 0 }} noWrap>
                {row.label}
              </Typography>
              <Money
                amount={row.unpricedCalls === row.calls && row.costMicroUsd === 0 ? null : row.costMicroUsd}
                unit="micro"
                currency="USD"
                variant="subtitle2"
                approximate={row.unpricedCalls > 0}
                tooltip={
                  row.unpricedCalls > 0
                    ? `${row.unpricedCalls} من ${row.calls} مكالمة بلا تكلفة مسجّلة`
                    : undefined
                }
              />
            </Stack>

            <LinearProgress
              variant="determinate"
              value={Math.min(100, share * 100)}
              sx={{ height: 6, borderRadius: 3 }}
            />

            <Stack direction="row" gap={2} flexWrap="wrap">
              <Typography variant="caption" color="text.secondary">
                <Num value={row.calls} /> مكالمة
              </Typography>
              {row.failures > 0 && (
                <Typography variant="caption" color="error.main">
                  <Num value={row.failures} /> فشل
                </Typography>
              )}
              <Box sx={{ flexGrow: 1 }} />
              <Typography variant="caption" color="text.secondary">
                <Num value={row.inputTokens} format="compact" /> ← / →{' '}
                <Num value={row.outputTokens} format="compact" />
              </Typography>
            </Stack>
          </Stack>
        );
      })}
    </Stack>
  );
}
