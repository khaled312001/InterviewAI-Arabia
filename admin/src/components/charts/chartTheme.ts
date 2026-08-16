import type { Theme } from '@mui/material/styles';
import { fontFamily } from '../../theme/typography';

/**
 * recharts positions everything with computed x/y SVG attributes: `dir` does
 * not reach SVG and stylis only rewrites CSS, so charts do NOT flip on their
 * own. This is the single exempt surface — it needs explicit props, and they
 * all live here.
 */
export const chartMargin = { top: 8, right: 8, bottom: 8, left: 8 };

export function axisTick(theme: Theme) {
  return { fontFamily, fontSize: 12, fill: theme.vars.palette.text.secondary };
}

export function gridStroke(theme: Theme) {
  return theme.vars.palette.divider;
}

export function tooltipProps(theme: Theme) {
  return {
    // The tooltip is an HTML div positioned by inline style; it never passes
    // through emotion, so direction has to be set here.
    wrapperStyle: { direction: 'rtl' as const, outline: 'none' },
    contentStyle: {
      textAlign: 'start' as const,
      fontFamily,
      fontSize: 12,
      borderRadius: 12,
      border: `1px solid ${theme.vars.palette.divider}`,
      background: theme.vars.palette.background.paper,
      color: theme.vars.palette.text.primary,
      boxShadow: theme.shadows[3],
    },
    itemStyle: { color: theme.vars.palette.text.primary },
    labelStyle: { color: theme.vars.palette.text.secondary, marginBottom: 4 },
    cursor: { fill: theme.vars.palette.action.hover },
  };
}

export function legendProps() {
  return { wrapperStyle: { direction: 'rtl' as const, fontFamily, fontSize: 12 } };
}

export function seriesColor(theme: Theme, index: number) {
  return theme.vars.palette.chart[index % theme.vars.palette.chart.length];
}

/** Responsive chart heights, matching SHELL §3.5. */
export const chartHeight = { xs: 220, sm: 260, md: 300, lg: 320 };
