import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import { isEnabled } from '../../lib/flags';
import { isNavItemActive, navSections, type NavItem } from './navConfig';

export interface SidebarNavProps {
  rail: boolean;
  onNavigate?: () => void;
  badges?: Partial<Record<NonNullable<NavItem['badge']>, number>>;
}

export function SidebarNav({ rail, onNavigate, badges }: SidebarNavProps) {
  const { pathname } = useLocation();
  const role = useAuth((s) => s.admin?.role);

  return (
    <Box sx={{ flexGrow: 1, overflowY: 'auto', overscrollBehavior: 'contain', paddingBlock: 1 }}>
      {navSections.map((section) => {
        // Items the current role cannot reach are not rendered at all.
        const items = section.items.filter(
          (item) => (!item.roles || (role && item.roles.includes(role))) && isEnabled(item.featureFlag),
        );
        if (items.length === 0) return null;

        return (
          <Box key={section.id} component="nav" aria-label={section.labelAr}>
            {rail ? (
              // A section label is never truncated or tooltipped in rail mode.
              <Divider sx={{ marginInline: 1.5, marginBlock: '12px 4px' }} />
            ) : (
              <Typography
                variant="overline"
                color="text.disabled"
                sx={{ display: 'block', paddingInline: 2.5, marginBlock: '16px 4px' }}
              >
                {section.labelAr}
              </Typography>
            )}

            <List disablePadding>
              {items.map((item) => {
                const active = isNavItemActive(item, pathname);
                const badgeCount = item.badge ? (badges?.[item.badge] ?? 0) : 0;

                const button = (
                  <ListItemButton
                    component={NavLink}
                    to={item.path}
                    end={item.end}
                    selected={active}
                    onClick={onNavigate}
                    sx={{
                      position: 'relative',
                      justifyContent: rail ? 'center' : 'flex-start',
                      paddingInline: rail ? 0 : 2,
                      ...(active && {
                        '&::before': {
                          content: '""',
                          position: 'absolute',
                          insetInlineStart: 0,
                          top: 8,
                          bottom: 8,
                          width: 3,
                          borderStartEndRadius: 3,
                          borderEndEndRadius: 3,
                          backgroundColor: 'primary.main',
                        },
                      }),
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: rail ? 0 : 36, justifyContent: 'center' }}>
                      {rail && badgeCount > 0 ? (
                        <Badge variant="dot" color="error">
                          {item.icon}
                        </Badge>
                      ) : (
                        item.icon
                      )}
                    </ListItemIcon>
                    {!rail && (
                      <>
                        <ListItemText
                          primary={item.labelAr}
                          primaryTypographyProps={{ variant: 'body2', fontWeight: 600, noWrap: true }}
                        />
                        {badgeCount > 0 && <Chip size="small" color="error" label={badgeCount} />}
                      </>
                    )}
                  </ListItemButton>
                );

                return (
                  <Box key={item.path} component="li" sx={{ listStyle: 'none' }}>
                    {rail ? (
                      <Tooltip title={item.labelAr} placement="left">
                        <Box>{button}</Box>
                      </Tooltip>
                    ) : (
                      button
                    )}
                  </Box>
                );
              })}
            </List>
          </Box>
        );
      })}
    </Box>
  );
}
