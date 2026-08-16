import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { radius } from '../../theme/tokens';

export interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbHidden?: boolean;
  /** Chips/badges under the title — counts, StatusChip, etc. */
  meta?: React.ReactNode;
  loading?: boolean;
}

/** Every page's first child. */
export function PageHeader({ title, description, icon, actions, meta, loading = false }: PageHeaderProps) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      justifyContent="space-between"
      alignItems={{ sm: 'center' }}
      gap={2}
    >
      <Stack direction="row" alignItems="center" gap={1.5} sx={{ minWidth: 0 }}>
        {icon && (
          <Box
            sx={(t) => ({
              width: 40,
              height: 40,
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              borderRadius: `${radius.md}px`,
              color: 'primary.main',
              backgroundColor: `rgba(${t.vars.palette.primary.mainChannel} / 0.12)`,
            })}
          >
            {icon}
          </Box>
        )}
        <Box sx={{ minWidth: 0 }}>
          {loading ? (
            <Skeleton height={30} width={220} />
          ) : (
            <Typography variant="h3" noWrap>
              {title}
            </Typography>
          )}
          {description && (
            <Typography variant="body2" color="text.secondary">
              {description}
            </Typography>
          )}
          {meta && (
            <Stack direction="row" gap={1} alignItems="center" sx={{ mt: 1, flexWrap: 'wrap' }}>
              {meta}
            </Stack>
          )}
        </Box>
      </Stack>

      {actions && (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          gap={1}
          sx={{ width: { xs: '100%', sm: 'auto' }, flexShrink: 0, '& > *': { width: { xs: '100%', sm: 'auto' } } }}
        >
          {actions}
        </Stack>
      )}
    </Stack>
  );
}
