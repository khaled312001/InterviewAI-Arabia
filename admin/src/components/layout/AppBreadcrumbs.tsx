import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { buildCrumbs } from './routeMeta';

export function AppBreadcrumbs() {
  const { pathname } = useLocation();
  const crumbs = buildCrumbs(pathname);

  return (
    <Breadcrumbs
      aria-label="مسار التنقل"
      // A plain '/' is direction-neutral; a chevron would need manual mirroring.
      separator={
        <Typography component="span" variant="body2" color="text.disabled">
          /
        </Typography>
      }
      sx={{ minWidth: 0, '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' } }}
    >
      {crumbs.map((crumb, i) =>
        crumb.to && i < crumbs.length - 1 ? (
          <Link
            key={crumb.to}
            component={RouterLink}
            to={crumb.to}
            underline="hover"
            variant="body2"
            color="text.secondary"
          >
            {crumb.labelAr}
          </Link>
        ) : (
          <Typography key={crumb.labelAr} variant="body2" color="text.primary" fontWeight={700} noWrap>
            {crumb.labelAr}
          </Typography>
        ),
      )}
    </Breadcrumbs>
  );
}
