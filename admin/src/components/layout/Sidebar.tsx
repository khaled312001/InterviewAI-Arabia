import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import { layout } from '../../theme/tokens';
import { APP_VERSION, IS_PRODUCTION } from '../../lib/flags';
import { StatusChip } from '../common/StatusChip';
import { SidebarNav } from './SidebarNav';
import type { NavItem } from './navConfig';

interface SidebarContentProps {
  rail: boolean;
  onNavigate?: () => void;
  onToggleRail?: () => void;
  badges?: Partial<Record<NonNullable<NavItem['badge']>, number>>;
}

function SidebarContent({ rail, onNavigate, onToggleRail, badges }: SidebarContentProps) {
  return (
    <Stack sx={{ height: '100%', minHeight: 0 }}>
      <Stack
        direction="row"
        alignItems="center"
        gap={1.25}
        sx={{
          height: layout.headerHeight,
          flexShrink: 0,
          paddingInline: rail ? 0 : 2.5,
          justifyContent: rail ? 'center' : 'flex-start',
        }}
      >
        <Avatar sx={{ bgcolor: 'primary.main', width: 32, height: 32, fontSize: '1rem', fontWeight: 800 }}>
          ث
        </Avatar>
        {/* The wordmark fades rather than unmounting, so the rail toggle does
            not make the brand block jump. */}
        <Box
          sx={(t) => ({
            minWidth: 0,
            opacity: rail ? 0 : 1,
            width: rail ? 0 : 'auto',
            overflow: 'hidden',
            transition: t.transitions.create('opacity', { duration: t.transitions.duration.shorter }),
          })}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 800, lineHeight: 1 }} noWrap>
            ثقتي
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            لوحة التحكم
          </Typography>
        </Box>
      </Stack>
      <Divider />

      <SidebarNav rail={rail} onNavigate={onNavigate} badges={badges} />

      <Divider />
      <Stack
        direction={rail ? 'column' : 'row'}
        alignItems="center"
        gap={1}
        sx={{ flexShrink: 0, padding: 1.5 }}
      >
        {onToggleRail && (
          <Tooltip title={rail ? 'توسيع القائمة' : 'تصغير القائمة'} placement="left">
            <IconButton size="small" onClick={onToggleRail} aria-label={rail ? 'توسيع القائمة' : 'تصغير القائمة'}>
              {/* Chevron direction is inline-aware: in RTL, collapsing the
                  right-hand sidebar points toward the inline-end (left). */}
              {rail ? <ChevronLeftRounded /> : <ChevronRightRounded />}
            </IconButton>
          </Tooltip>
        )}
        {!rail && (
          <>
            <Typography variant="caption" color="text.disabled" className="ltr-island">
              v{APP_VERSION}
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <StatusChip kind="env" value={IS_PRODUCTION ? 'production' : 'development'} />
          </>
        )}
      </Stack>
    </Stack>
  );
}

export interface SidebarProps {
  /** Rail collapses the permanent column to icons only. */
  rail: boolean;
  onToggleRail?: () => void;
  /** <md drawer. */
  mobileOpen: boolean;
  onMobileClose: () => void;
  /** md overlay — expands over the content instead of reflowing it. */
  overlayOpen: boolean;
  onOverlayClose: () => void;
  /** false below md, where the drawer is the only sidebar. */
  permanent: boolean;
  badges?: Partial<Record<NonNullable<NavItem['badge']>, number>>;
}

export function Sidebar({
  rail,
  onToggleRail,
  mobileOpen,
  onMobileClose,
  overlayOpen,
  onOverlayClose,
  permanent,
  badges,
}: SidebarProps) {
  return (
    <>
      {permanent && (
        // A plain sticky aside, not a permanent Drawer: it lives in grid
        // column 1 (inline-start = right in RTL), so there is no width or
        // margin arithmetic anywhere in the shell.
        <Box
          component="aside"
          sx={(t) => ({
            display: { xs: 'none', md: 'block' },
            position: 'sticky',
            top: 0,
            alignSelf: 'start',
            height: '100vh',
            width: rail ? layout.sidebarRail : layout.sidebarWidth,
            borderInlineEnd: `1px solid ${t.vars.palette.divider}`,
            backgroundColor: t.vars.palette.background.paper,
            transition: t.transitions.create('width', {
              duration: t.transitions.duration.standard,
              easing: t.transitions.easing.easeInOut,
            }),
            willChange: 'width',
            zIndex: t.zIndex.appBar + 1,
          })}
        >
          <SidebarContent rail={rail} onToggleRail={onToggleRail} badges={badges} />
        </Box>
      )}

      {/* anchor="left" is inline-start — MUI mirrors it to the visual right
          under theme.direction 'rtl' (Drawer.getAnchor). */}
      <Drawer
        variant="temporary"
        anchor="left"
        open={mobileOpen}
        onClose={onMobileClose}
        ModalProps={{ keepMounted: true }}
        sx={{ display: { xs: 'block', md: 'none' } }}
        slotProps={{ paper: { sx: { width: layout.sidebarWidth } } }}
      >
        <SidebarContent rail={false} onNavigate={onMobileClose} badges={badges} />
      </Drawer>

      <Drawer
        variant="temporary"
        anchor="left"
        open={overlayOpen}
        onClose={onOverlayClose}
        sx={{ display: { xs: 'none', md: 'block', lg: 'none' } }}
        slotProps={{ paper: { sx: { width: layout.sidebarWidth } } }}
      >
        <SidebarContent rail={false} onNavigate={onOverlayClose} badges={badges} />
      </Drawer>
    </>
  );
}
