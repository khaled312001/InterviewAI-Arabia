import type { ThemeOptions } from '@mui/material/styles';

export const fontFamily =
  '"Cairo","IBM Plex Sans Arabic","Segoe UI",system-ui,-apple-system,sans-serif';

export const monoFamily =
  '"JetBrains Mono","SFMono-Regular",Menlo,Consolas,"Courier New",monospace';

/**
 * letterSpacing is 0 on every variant and textTransform is none everywhere:
 * MUI's Latin-tuned defaults (h1 -0.01562em, button 0.02857em, overline
 * 0.08333em) break Arabic glyph joining and render visibly disconnected
 * letters. Arabic has no case, so uppercase only mangles mixed Latin runs.
 */
export const typography: ThemeOptions['typography'] = {
  fontFamily,
  htmlFontSize: 16,
  fontSize: 14,
  fontWeightLight: 400,
  fontWeightRegular: 400,
  fontWeightMedium: 600,
  fontWeightBold: 700,
  allVariants: { letterSpacing: 0, textTransform: 'none' },
  h1: { fontSize: '2rem',     lineHeight: 1.25, fontWeight: 800 },
  h2: { fontSize: '1.75rem',  lineHeight: 1.28, fontWeight: 800 },
  h3: { fontSize: '1.5rem',   lineHeight: 1.32, fontWeight: 700 },
  h4: { fontSize: '1.25rem',  lineHeight: 1.36, fontWeight: 700 },
  h5: { fontSize: '1.125rem', lineHeight: 1.4,  fontWeight: 700 },
  h6: { fontSize: '1rem',     lineHeight: 1.45, fontWeight: 700 },
  subtitle1: { fontSize: '0.9375rem', lineHeight: 1.55, fontWeight: 600 },
  subtitle2: { fontSize: '0.8125rem', lineHeight: 1.55, fontWeight: 600 },
  body1: { fontSize: '0.9375rem', lineHeight: 1.7,  fontWeight: 400 },
  body2: { fontSize: '0.875rem',  lineHeight: 1.65, fontWeight: 400 },
  button: { fontSize: '0.875rem', lineHeight: 1.5,  fontWeight: 600 },
  caption: { fontSize: '0.75rem', lineHeight: 1.6,  fontWeight: 500 },
  overline: { fontSize: '0.6875rem', lineHeight: 1.6, fontWeight: 700 },
};
