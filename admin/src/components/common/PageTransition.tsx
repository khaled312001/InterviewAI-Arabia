import { useEffect } from 'react';
import Box from '@mui/material/Box';
import { useLocation } from 'react-router-dom';
import { usePrefersReducedMotion } from '../../lib/hooks/usePrefersReducedMotion';

/**
 * Enter only. There is no exit transition: animating a full page out produces
 * a visible blank frame and a scroll jump. Never translateX — horizontal
 * motion carries a direction meaning that inverts in RTL.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname]);

  return (
    <Box
      key={pathname}
      sx={(t) => ({
        // Owns the vertical rhythm between page sections, so pages never put
        // margins on their children.
        display: 'flex',
        flexDirection: 'column',
        gap: { xs: 2, md: 3 },
        flexGrow: 1,
        animationName: reduced ? 'none' : 'page-in',
        animationFillMode: 'backwards',
        animationDuration: `${t.transitions.duration.short}ms`,
        animationTimingFunction: t.transitions.easing.easeOut,
        '@keyframes page-in': {
          from: { opacity: 0, transform: 'translateY(6px)' },
        },
      })}
    >
      {children}
    </Box>
  );
}
