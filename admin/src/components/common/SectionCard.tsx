import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

export interface SectionCardProps {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  dense?: boolean;
  /** Removes CardContent padding — for grids and tables that own their edges. */
  disablePadding?: boolean;
  children: React.ReactNode;
}

/** The standard content container. Pages never render a bare Paper. */
export function SectionCard({
  title,
  description,
  actions,
  dense = false,
  disablePadding = false,
  children,
}: SectionCardProps) {
  const hasHeader = Boolean(title || description || actions);

  return (
    <Card>
      {hasHeader && (
        <>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ sm: 'center' }}
            gap={1.5}
            sx={{ padding: dense ? '12px 16px' : '16px 20px' }}
          >
            <Box>
              {title && <Typography variant="h6">{title}</Typography>}
              {description && (
                <Typography variant="body2" color="text.secondary">
                  {description}
                </Typography>
              )}
            </Box>
            {actions && (
              <Stack direction="row" gap={1} alignItems="center">
                {actions}
              </Stack>
            )}
          </Stack>
          <Divider />
        </>
      )}
      {disablePadding ? (
        children
      ) : (
        <CardContent sx={dense ? { padding: 2, '&:last-child': { paddingBottom: 2 } } : undefined}>
          {children}
        </CardContent>
      )}
    </Card>
  );
}
