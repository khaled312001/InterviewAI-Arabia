import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import InboxRounded from '@mui/icons-material/InboxRounded';
import SearchOffRounded from '@mui/icons-material/SearchOffRounded';
import FilterAltOffRounded from '@mui/icons-material/FilterAltOffRounded';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  variant?: 'default' | 'search' | 'filtered';
  query?: string;
  size?: 'sm' | 'md';
  'data-testid'?: string;
}

const DEFAULT_ICON = {
  default: <InboxRounded />,
  search: <SearchOffRounded />,
  filtered: <FilterAltOffRounded />,
};

/** Never used to represent a failed request — that is ErrorState. */
export function EmptyState({
  title,
  description,
  icon,
  action,
  secondaryAction,
  variant = 'default',
  query,
  size = 'md',
  'data-testid': testId,
}: EmptyStateProps) {
  const heading = variant === 'search' && query ? `لا نتائج للبحث «${query}»` : title;

  return (
    <Stack
      data-testid={testId}
      alignItems="center"
      justifyContent="center"
      gap={1.5}
      sx={{
        minHeight: size === 'md' ? 320 : 200,
        textAlign: 'center',
        paddingInline: 3,
        paddingBlock: 4,
      }}
    >
      <Box
        sx={{
          color: 'text.disabled',
          display: 'grid',
          placeItems: 'center',
          '& > svg': { fontSize: 56 },
        }}
      >
        {icon ?? DEFAULT_ICON[variant]}
      </Box>
      <Typography variant="h6">{heading}</Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 460 }}>
          {description}
        </Typography>
      )}
      {(action || secondaryAction) && (
        <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} sx={{ mt: 1 }}>
          {action}
          {secondaryAction}
        </Stack>
      )}
    </Stack>
  );
}
