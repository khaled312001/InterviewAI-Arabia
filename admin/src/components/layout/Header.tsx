import { useState } from 'react';
import AppBar from '@mui/material/AppBar';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useColorScheme, useTheme } from '@mui/material/styles';
import DarkModeRounded from '@mui/icons-material/DarkModeRounded';
import LightModeRounded from '@mui/icons-material/LightModeRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import MenuOpenRounded from '@mui/icons-material/MenuOpenRounded';
import MenuRounded from '@mui/icons-material/MenuRounded';
import PersonRounded from '@mui/icons-material/PersonRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import SettingsBrightnessRounded from '@mui/icons-material/SettingsBrightnessRounded';
import { useIsFetching } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { layout, radius } from '../../theme/tokens';
import { useAuth } from '../../store/auth';
import { Mono } from '../common/Mono';
import { RoleBadge } from '../common/RoleBadge';
import { AppBreadcrumbs } from './AppBreadcrumbs';
import { currentPageTitle } from './CommandPalette';

const MODES = ['light', 'dark', 'system'] as const;
type Mode = (typeof MODES)[number];

const MODE_LABEL: Record<Mode, string> = {
  light: 'الوضع الفاتح',
  dark: 'الوضع الداكن',
  system: 'حسب النظام',
};

function ModeIcon({ mode }: { mode: Mode }) {
  const icon =
    mode === 'light' ? <LightModeRounded /> : mode === 'dark' ? <DarkModeRounded /> : <SettingsBrightnessRounded />;
  return (
    <Box
      key={mode}
      sx={(t) => ({
        display: 'grid',
        placeItems: 'center',
        // Only the icon animates on toggle — never the whole surface.
        animation: `mode-icon ${t.transitions.duration.short}ms ${t.transitions.easing.easeOut}`,
        '@keyframes mode-icon': { from: { opacity: 0, transform: 'rotate(180deg)' } },
      })}
    >
      {icon}
    </Box>
  );
}

export interface HeaderProps {
  onOpenNav: () => void;
  /** true below lg, where the nav control opens rather than collapses. */
  navControlOpens: boolean;
  onOpenSearch: () => void;
}

export function Header({ onOpenNav, navControlOpens, onOpenSearch }: HeaderProps) {
  const theme = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { admin, logout } = useAuth();
  const { mode, setMode } = useColorScheme();
  const isFetching = useIsFetching() > 0;
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const current = (mode ?? 'system') as Mode;
  const next = MODES[(MODES.indexOf(current) + 1) % MODES.length];

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  function cycleMode() {
    setMode(next);
  }

  return (
    <AppBar position="sticky" sx={{ top: 0 }}>
      <Toolbar
        sx={{
          minHeight: { xs: layout.headerHeightXs, md: layout.headerHeight },
          gap: 1,
          paddingInline: { xs: 1.5, md: 2.5 },
        }}
      >
        <IconButton edge="start" onClick={onOpenNav} aria-label="القائمة">
          {navControlOpens ? <MenuRounded /> : <MenuOpenRounded />}
        </IconButton>

        {isXs ? (
          <Typography variant="subtitle1" fontWeight={700} noWrap>
            {currentPageTitle(pathname)}
          </Typography>
        ) : (
          <AppBreadcrumbs />
        )}

        <Box sx={{ flexGrow: 1 }} />

        {isMobile ? (
          <IconButton onClick={onOpenSearch} aria-label="بحث">
            <SearchRounded />
          </IconButton>
        ) : (
          <ButtonBase
            onClick={onOpenSearch}
            sx={(t) => ({
              width: { md: 240, lg: 280 },
              height: 36,
              gap: 1,
              paddingInline: 1.5,
              justifyContent: 'flex-start',
              borderRadius: `${radius.pill}px`,
              backgroundColor: t.vars.palette.surface.sunken,
              border: `1px solid ${t.vars.palette.divider}`,
              color: t.vars.palette.text.secondary,
            })}
          >
            <SearchRounded sx={{ fontSize: 18 }} />
            <Typography variant="body2" color="inherit">
              بحث…
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Typography variant="caption" className="ltr-island" color="text.disabled">
              {isMac ? '⌘K' : 'Ctrl K'}
            </Typography>
          </ButtonBase>
        )}

        <Tooltip title={MODE_LABEL[next]}>
          <IconButton onClick={cycleMode} aria-label={`تبديل السمة إلى ${MODE_LABEL[next]}`}>
            <ModeIcon mode={current} />
          </IconButton>
        </Tooltip>

        {!isMobile && <RoleBadge role={admin?.role} />}

        <IconButton onClick={(e) => setMenuAnchor(e.currentTarget)} aria-label="حساب المشرف">
          <Avatar sx={{ bgcolor: 'secondary.main', width: 32, height: 32, fontSize: '0.875rem' }}>
            {admin?.name?.[0]?.toUpperCase() || 'A'}
          </Avatar>
        </IconButton>

        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
          <Stack gap={0.5} sx={{ paddingInline: 2, paddingBlock: 1 }}>
            <Typography variant="body2" fontWeight={700}>
              {admin?.name}
            </Typography>
            <Mono value={admin?.email} variant="caption" />
            <Box sx={{ mt: 0.5 }}>
              <RoleBadge role={admin?.role} />
            </Box>
          </Stack>
          <Divider />
          <MenuItem disabled>
            <ListItemIcon>
              <PersonRounded fontSize="small" />
            </ListItemIcon>
            الملف الشخصي
          </MenuItem>
          <MenuItem
            onClick={() => {
              cycleMode();
              setMenuAnchor(null);
            }}
          >
            <ListItemIcon>
              <SettingsBrightnessRounded fontSize="small" />
            </ListItemIcon>
            تبديل السمة
          </MenuItem>
          <Divider />
          <MenuItem
            onClick={() => {
              logout();
              navigate('/login');
            }}
            sx={{ color: 'error.main' }}
          >
            <ListItemIcon sx={{ color: 'inherit' }}>
              <LogoutRounded fontSize="small" />
            </ListItemIcon>
            تسجيل الخروج
          </MenuItem>
        </Menu>
      </Toolbar>

      {/* The app's single global loading signal. */}
      <LinearProgress
        sx={{
          position: 'absolute',
          insetInlineStart: 0,
          insetInlineEnd: 0,
          bottom: 0,
          opacity: isFetching ? 1 : 0,
          transition: (t) => t.transitions.create('opacity', { duration: t.transitions.duration.shorter }),
        }}
      />
    </AppBar>
  );
}
