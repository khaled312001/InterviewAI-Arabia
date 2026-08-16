import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { Outlet, useLocation } from 'react-router-dom';
import { layout } from '../../theme/tokens';
import { useUi } from '../../store/ui';
import { PageTransition } from '../common/PageTransition';
import { CommandPalette } from './CommandPalette';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

/**
 * The shell is a CSS grid and the header is sticky inside the content column.
 * That removes every `calc(100% - Xpx)` and every compensating margin — the
 * whole class of bug the old Layout had.
 *
 * In RTL grid column 1 is painted on the right, so the sidebar is declared
 * first and appears on the right; the content column follows on the left.
 */
export function AppShell() {
  const theme = useTheme();
  const { pathname } = useLocation();
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'));
  const isMd = useMediaQuery(theme.breakpoints.between('md', 'lg'));
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const pushRecentRoute = useUi((s) => s.pushRecentRoute);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // At md the sidebar is a rail by default and the toggle overlays rather than
  // reflowing the content.
  const rail = isMd || (isDesktop && collapsed);
  const columnWidth = rail ? layout.sidebarRail : layout.sidebarWidth;

  useEffect(() => {
    setMobileOpen(false);
    setOverlayOpen(false);
    pushRecentRoute(pathname);
  }, [pathname, pushRecentRoute]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function onOpenNav() {
    if (isMobile) setMobileOpen(true);
    else if (isMd) setOverlayOpen(true);
    else toggleSidebar();
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: `${columnWidth}px 1fr` },
        bgcolor: 'background.default',
      }}
    >
      <Sidebar
        rail={rail}
        onToggleRail={isDesktop ? toggleSidebar : undefined}
        permanent={!isMobile}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        overlayOpen={overlayOpen}
        onOverlayClose={() => setOverlayOpen(false)}
      />

      <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Header
          onOpenNav={onOpenNav}
          navControlOpens={isMobile}
          onOpenSearch={() => setPaletteOpen(true)}
        />

        <Box
          component="main"
          sx={{
            width: '100%',
            maxWidth: layout.contentMaxWidth,
            marginInline: 'auto',
            paddingInline: { xs: 2, sm: 2.5, md: 3, lg: 4 },
            paddingBlockStart: { xs: 2, md: 3 },
            paddingBlockEnd: 8,
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            minWidth: 0,
          }}
        >
          <PageTransition>
            <Outlet />
          </PageTransition>
        </Box>
      </Box>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </Box>
  );
}
