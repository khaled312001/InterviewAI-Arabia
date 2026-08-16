import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid2';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import { layout, radius } from '../../theme/tokens';
import { usePrefersReducedMotion } from '../../lib/hooks/usePrefersReducedMotion';

/**
 * Skeleton boxes match the real content's dimensions within ~4px so the swap
 * causes no reflow.
 */
function useAnim(): 'wave' | false {
  return usePrefersReducedMotion() ? false : 'wave';
}

export function TextSkeleton({
  lines = 3,
  width = ['100%', '92%', '60%'],
}: { lines?: number; width?: Array<string | number> }) {
  const animation = useAnim();
  return (
    <Stack gap={0.75}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} animation={animation} height={18} width={width[i % width.length]} />
      ))}
    </Stack>
  );
}

export function StatCardSkeleton() {
  const animation = useAnim();
  return (
    <Card>
      <CardContent>
        <Stack gap={1.5}>
          <Stack direction="row" alignItems="center" gap={1.5}>
            <Skeleton animation={animation} variant="rounded" width={40} height={40} />
            <Skeleton animation={animation} height={14} width="45%" />
          </Stack>
          <Skeleton animation={animation} height={32} width="55%" />
          <Skeleton animation={animation} height={14} width="35%" />
        </Stack>
      </CardContent>
    </Card>
  );
}

export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <Grid container spacing={{ xs: 2, md: 3 }}>
      {Array.from({ length: count }, (_, i) => (
        <Grid key={i} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
          <StatCardSkeleton />
        </Grid>
      ))}
    </Grid>
  );
}

export function TableSkeleton({
  rows = 8,
  cols = 6,
  showToolbar = false,
}: { rows?: number; cols?: number; showToolbar?: boolean }) {
  const animation = useAnim();
  return (
    <Box>
      {showToolbar && (
        <>
          <Stack direction="row" gap={1.5} sx={{ p: 2 }}>
            <Skeleton animation={animation} variant="rounded" height={38} width={280} />
            <Box sx={{ flexGrow: 1 }} />
            <Skeleton animation={animation} variant="rounded" height={38} width={120} />
          </Stack>
          <Divider />
        </>
      )}
      <Stack sx={{ p: 2 }} gap={0}>
        <Stack direction="row" gap={2} sx={{ height: 48, alignItems: 'center' }}>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} animation={animation} height={14} sx={{ flex: c === 0 ? 0.6 : 1 }} />
          ))}
        </Stack>
        {Array.from({ length: rows }, (_, r) => (
          <Stack key={r} direction="row" gap={2} sx={{ height: 52, alignItems: 'center' }}>
            {Array.from({ length: cols }, (_, c) => (
              <Skeleton key={c} animation={animation} height={16} sx={{ flex: c === 0 ? 0.6 : 1 }} />
            ))}
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

export function ChartSkeleton({ height = 300 }: { height?: number }) {
  const animation = useAnim();
  const bars = [0.45, 0.75, 0.6, 0.9, 0.35];
  return (
    <Box sx={{ height, display: 'flex', alignItems: 'flex-end', gap: 2, p: 2 }}>
      {bars.map((h, i) => (
        <Skeleton
          key={i}
          animation={animation}
          variant="rounded"
          sx={{ flex: 1, height: `${h * 100}%`, borderRadius: `${radius.sm}px` }}
        />
      ))}
    </Box>
  );
}

export function FormSkeleton({ fields = 5 }: { fields?: number }) {
  const animation = useAnim();
  return (
    <Stack gap={2.5}>
      {Array.from({ length: fields }, (_, i) => (
        <Stack key={i} gap={0.75}>
          <Skeleton animation={animation} height={14} width="30%" />
          <Skeleton animation={animation} variant="rounded" height={40} />
        </Stack>
      ))}
    </Stack>
  );
}

export function ListSkeleton({ rows = 6, avatar = false }: { rows?: number; avatar?: boolean }) {
  const animation = useAnim();
  return (
    <Stack gap={1.5}>
      {Array.from({ length: rows }, (_, i) => (
        <Stack key={i} direction="row" alignItems="center" gap={1.5}>
          {avatar && <Skeleton animation={animation} variant="circular" width={36} height={36} />}
          <Stack gap={0.5} sx={{ flexGrow: 1 }}>
            <Skeleton animation={animation} height={14} width="40%" />
            <Skeleton animation={animation} height={12} width="65%" />
          </Stack>
        </Stack>
      ))}
    </Stack>
  );
}

/** Full shell chrome — what SessionBoot renders while /auth/me is in flight. */
export function AppSkeleton() {
  const animation = useAnim();
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: `1fr ${layout.sidebarWidth}px` },
        bgcolor: 'background.default',
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        <Stack
          direction="row"
          alignItems="center"
          gap={1.5}
          sx={{
            height: { xs: layout.headerHeightXs, md: layout.headerHeight },
            paddingInline: 2.5,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Skeleton animation={animation} height={16} width={180} />
          <Box sx={{ flexGrow: 1 }} />
          <Skeleton animation={animation} variant="rounded" height={36} width={220} />
          <Skeleton animation={animation} variant="circular" width={32} height={32} />
        </Stack>
        <Stack gap={3} sx={{ p: { xs: 2, md: 3 } }}>
          <Skeleton animation={animation} height={30} width={260} />
          <StatGridSkeleton count={4} />
          <Card><ChartSkeleton /></Card>
        </Stack>
      </Box>
      <Box sx={{ display: { xs: 'none', md: 'block' }, borderInlineEnd: 1, borderColor: 'divider', p: 2 }}>
        <Stack direction="row" alignItems="center" gap={1.5} sx={{ height: layout.headerHeight }}>
          <Skeleton animation={animation} variant="circular" width={32} height={32} />
          <Skeleton animation={animation} height={16} width={110} />
        </Stack>
        <ListSkeleton rows={8} />
      </Box>
    </Box>
  );
}
