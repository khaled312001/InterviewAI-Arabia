// Design tokens — modern, professional, Arabic-first.
// Colors derived from a blue-indigo primary with warm amber accent.
// Keep the palette small and intentional; avoid ad-hoc colors in components.

export const palette = {
  // Primary brand (deep blue → electric blue gradient territory)
  brand50:  '#EEF4FF',
  brand100: '#D9E7FF',
  brand200: '#B4CFFE',
  brand300: '#7FAEFB',
  brand400: '#4E8CF5',
  brand500: '#2D6CE0',
  brand600: '#1E54BF',
  brand700: '#1943A0',
  brand800: '#143582',
  brand900: '#0F2867',

  // Accent (amber/gold)
  accent300: '#FFCE6E',
  accent400: '#F5B12F',
  accent500: '#E49515',
  accent600: '#BD780A',

  // Semantic
  success500: '#10B981',
  warning500: '#F59E0B',
  danger500:  '#EF4444',

  // Neutrals (dark theme anchored)
  n0:   '#FFFFFF',
  n50:  '#F5F7FB',
  n100: '#E7ECF3',
  n200: '#CBD3E0',
  n300: '#9AA5B8',
  n400: '#6B7689',
  n500: '#4A5365',
  n600: '#2F3646',
  n700: '#1F2533',
  n800: '#141927',
  n900: '#0A0E1A',
  n950: '#05070E',
} as const;

// Light-mode and dark-mode surfaces built from the palette.
export const lightTheme = {
  mode: 'light' as const,
  colors: {
    bg:          palette.n50,
    bgMuted:     palette.n100,
    surface:     palette.n0,
    surfaceAlt:  palette.n50,
    border:      palette.n100,
    borderStrong:palette.n200,

    text:        palette.n800,
    textMuted:   palette.n400,
    textOnBrand: palette.n0,

    primary:     palette.brand600,
    primaryDim:  palette.brand500,
    primarySoft: palette.brand100,
    primaryFg:   palette.n0,

    accent:      palette.accent500,
    accentSoft:  palette.accent300,

    success:     palette.success500,
    warning:     palette.warning500,
    danger:      palette.danger500,

    overlay:     'rgba(10,14,26,0.55)',
    chipBg:      palette.brand100,
    chipText:    palette.brand700,

    // Legacy aliases (keep existing screens compiling without rewrite)
    primaryDark: palette.brand800,
    primaryLight:palette.brand400,
    secondary:   palette.accent500,
  },
  gradient: {
    hero:   ['#2D6CE0', '#143582'],
    premium:['#F5B12F', '#E49515'],
    subtle: ['rgba(45,108,224,0.12)', 'rgba(45,108,224,0.02)'],
  },
};

export const darkTheme = {
  mode: 'dark' as const,
  colors: {
    bg:          palette.n950,
    bgMuted:     palette.n900,
    surface:     palette.n800,
    surfaceAlt:  palette.n700,
    border:      'rgba(255,255,255,0.08)',
    borderStrong:'rgba(255,255,255,0.16)',

    text:        palette.n50,
    textMuted:   palette.n300,
    textOnBrand: palette.n0,

    primary:     palette.brand400,
    primaryDim:  palette.brand500,
    primarySoft: 'rgba(78,140,245,0.16)',
    primaryFg:   palette.n0,

    accent:      palette.accent400,
    accentSoft:  'rgba(245,177,47,0.18)',

    success:     palette.success500,
    warning:     palette.warning500,
    danger:      palette.danger500,

    overlay:     'rgba(0,0,0,0.65)',
    chipBg:      'rgba(78,140,245,0.18)',
    chipText:    palette.brand200,

    // Legacy aliases
    primaryDark: palette.brand700,
    primaryLight:palette.brand300,
    secondary:   palette.accent400,
  },
  gradient: {
    hero:   ['#1E54BF', '#0F2867'],
    premium:['#E49515', '#BD780A'],
    subtle: ['rgba(78,140,245,0.20)', 'rgba(78,140,245,0.03)'],
  },
};

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xl2: 24, xl3: 32, xl4: 40, xl5: 56,
} as const;

export const radii = {
  xs: 6, sm: 10, md: 14, lg: 18, xl: 22, xl2: 28, pill: 999,
} as const;

export const typography = {
  fontFamily: 'Cairo-Regular, Cairo, IBM Plex Sans Arabic, system-ui, sans-serif',
  fontFamilyBold: 'Cairo-Bold, Cairo, IBM Plex Sans Arabic, system-ui, sans-serif',
  sizes: {
    caption: 12, sub: 13, body: 15, bodyLg: 17,
    h4: 18, h3: 20, h2: 24, h1: 30, display: 36,
  },
  letterSpacing: {
    tight: -0.4,
    normal: 0,
  },
} as const;

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 3,
  },
  raised: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 6,
  },
};

// Legacy color aliases so existing screens keep working; new screens should
// read from useAppTheme().colors directly.
export const colors = {
  primary:      palette.brand600,
  primaryDark:  palette.brand800,
  primaryLight: palette.brand400,
  secondary:    palette.accent500,
  accent:       palette.accent500,
  bgLight:      palette.n50,
  bgDark:       palette.n950,
  surfaceLight: palette.n0,
  surfaceDark:  palette.n800,
  textLight:    palette.n800,
  textDark:     palette.n50,
  textMutedLight: palette.n400,
  textMutedDark:  palette.n300,
  border:       palette.n100,
  success:      palette.success500,
  warning:      palette.warning500,
  danger:       palette.danger500,
};

export type ThemeMode = 'light' | 'dark';

export function getTheme(mode: ThemeMode) {
  const base = mode === 'dark' ? darkTheme : lightTheme;
  return {
    mode,
    colors: base.colors,
    gradient: base.gradient,
    spacing,
    radii,
    typography,
    shadow,
  };
}

export type AppTheme = ReturnType<typeof getTheme>;
