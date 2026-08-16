import { alpha } from '@mui/material/styles';
import type { PaletteOptions } from '@mui/material/styles';
import { brand, gold, neutral, semantic, chartLight, chartDark, type ColorScheme } from './tokens';

function semanticFor(scheme: ColorScheme) {
  return {
    success: { ...semantic.success[scheme] },
    error:   { ...semantic.error[scheme] },
    warning: { ...semantic.warning[scheme] },
    info:    { ...semantic.info[scheme] },
  };
}

export function buildPalette(scheme: ColorScheme): PaletteOptions {
  if (scheme === 'light') {
    return {
      primary:   { main: brand[500], dark: brand[900], light: brand[300], contrastText: '#FFFFFF' },
      secondary: { main: gold[500],  dark: gold[700],  light: gold[300],  contrastText: '#1B1200' },
      ...semanticFor('light'),
      background: { default: neutral[50], paper: neutral[0] },
      text: { primary: '#0F1B2D', secondary: neutral[600], disabled: neutral[400] },
      divider: neutral[200],
      action: {
        hover: alpha(brand[500], 0.05),
        selected: alpha(brand[500], 0.1),
        focus: alpha(brand[500], 0.14),
        disabledOpacity: 0.42,
      },
      chart: chartLight,
      surface: { sunken: neutral[100], raised: neutral[0], overlay: alpha(neutral[950], 0.45) },
      brand,
      gold,
    };
  }

  return {
    primary:   { main: '#5B93FF', dark: brand[500], light: '#A5C2FF', contrastText: '#08142B' },
    secondary: { main: gold[500], dark: gold[600],  light: gold[300], contrastText: '#1B1200' },
    ...semanticFor('dark'),
    background: { default: neutral[950], paper: neutral[900] },
    text: { primary: '#E8EDF6', secondary: '#9AA8BF', disabled: '#63718A' },
    divider: 'rgba(255,255,255,0.10)',
    action: {
      hover: 'rgba(255,255,255,0.06)',
      selected: alpha('#5B93FF', 0.18),
      focus: alpha('#5B93FF', 0.24),
      disabledOpacity: 0.38,
    },
    chart: chartDark,
    surface: { sunken: neutral[950], raised: neutral[850], overlay: 'rgba(0,0,0,0.60)' },
    brand,
    gold,
  };
}
