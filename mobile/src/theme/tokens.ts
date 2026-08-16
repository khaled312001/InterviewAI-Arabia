/**
 * InterviewAI Arabia — design tokens.
 *
 * This file is the single source of truth for every visual decision in the
 * app. Screens must not invent spacing, radii, font sizes, or colours; if a
 * value is needed and missing, it gets added here first. That rule is what
 * keeps proportions consistent across 16 screens instead of each one drifting.
 *
 * Grid: everything derives from a 4pt base unit.
 * Arabic-first: the type scale carries explicit line heights, because Arabic
 * script needs noticeably more leading than Latin at the same size — using
 * RN's default line height makes Arabic text feel cramped and clipped.
 */

import { Platform, TextStyle } from 'react-native';

/* ------------------------------------------------------------------ *
 * 1. Primitive palette — raw colour ramps. Never referenced directly
 *    by components; semantic roles below map onto these.
 * ------------------------------------------------------------------ */

export const palette = {
  // Brand — deep, trustworthy blue. Anchors the product as "serious career tool".
  brand50:  '#EFF5FF',
  brand100: '#DBE8FE',
  brand200: '#BFD7FE',
  brand300: '#93BDFD',
  brand400: '#5B93FD',
  brand500: '#2D73FD',   // logo: icon background / first bar
  brand600: '#1A56E8',
  brand700: '#0736A8',   // logo: wordmark + bubble outline
  brand800: '#0A2E86',
  brand900: '#1E378A',
  brand950: '#172554',

  // Accent — warm gold. Used exclusively for premium/value moments so the
  // colour itself becomes a signal, not decoration.
  gold50:  '#FFFBEB',
  gold100: '#FEF3C7',
  gold200: '#FDE68A',
  gold300: '#FCD34D',
  gold400: '#FEBE2E',
  gold500: '#FEAF04',   // logo: tallest bar
  gold600: '#D97706',
  gold700: '#B45309',

  // Semantic ramps
  green100: '#DCFCE7',
  green500: '#22C55E',
  green600: '#16A34A',
  green700: '#15803D',

  amber100: '#FEF3C7',
  amber500: '#F59E0B',
  amber600: '#D97706',

  red100: '#FEE2E2',
  red500: '#EF4444',
  red600: '#DC2626',
  red700: '#B91C1C',

  // Neutrals — slightly blue-tinted so they sit naturally beside the brand.
  n0:   '#FFFFFF',
  n25:  '#FCFDFE',
  n50:  '#F7F9FC',
  n100: '#EEF2F7',
  n200: '#E2E8F0',
  n300: '#CBD5E1',
  n400: '#94A3B8',
  n500: '#64748B',
  n600: '#475569',
  n700: '#334155',
  n800: '#1E293B',
  n900: '#0F172A',
  n950: '#080D1A',
} as const;

/* ------------------------------------------------------------------ *
 * 2. Spacing — 4pt grid. Named by size, not by use, so the same token
 *    means the same distance everywhere.
 * ------------------------------------------------------------------ */

export const spacing = {
  none: 0,
  xxs: 2,
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
  '6xl': 64,
  '7xl': 80,
} as const;

/* ------------------------------------------------------------------ *
 * 3. Radii — tied to component scale. A 40px control and a full-width
 *    card should not share a radius; that mismatch is what made the old
 *    screens look assembled rather than designed.
 * ------------------------------------------------------------------ */

export const radii = {
  none: 0,
  xs:  6,   // chips, tiny badges
  sm:  10,  // inputs, small buttons
  md:  14,  // buttons, list rows
  lg:  18,  // cards
  xl:  24,  // sheets, hero panels
  '2xl': 32,
  pill: 999,
} as const;

/* ------------------------------------------------------------------ *
 * 4. Typography — modular scale (~1.2 ratio) with Arabic-aware leading.
 * ------------------------------------------------------------------ */

const fontStack = Platform.select({
  web: "'Cairo','IBM Plex Sans Arabic',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
  default: 'Cairo-Regular',
}) as string;

const fontStackBold = Platform.select({
  web: "'Cairo','IBM Plex Sans Arabic',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
  default: 'Cairo-Bold',
}) as string;

/**
 * On web a single family renders every weight via `fontWeight`; on native
 * each weight is a separate loaded font file and `fontWeight` is ignored.
 * `text()` below hides that difference so screens never branch on platform.
 */
export const typography: {
  fontFamily: string;
  fontFamilyBold: string;
  scale: Record<
    'display' | 'h1' | 'h2' | 'h3' | 'h4' | 'bodyLg' | 'body' | 'bodySm' | 'caption' | 'micro' | 'numeric',
    { fontSize: number; lineHeight: number; letterSpacing: number }
  >;
} = {
  fontFamily: fontStack,
  fontFamilyBold: fontStackBold,

  /** size / lineHeight / letterSpacing per role. */
  scale: {
    display: { fontSize: 34, lineHeight: 46, letterSpacing: -0.6 },
    h1:      { fontSize: 28, lineHeight: 40, letterSpacing: -0.4 },
    h2:      { fontSize: 23, lineHeight: 34, letterSpacing: -0.3 },
    h3:      { fontSize: 19, lineHeight: 29, letterSpacing: -0.2 },
    h4:      { fontSize: 17, lineHeight: 26, letterSpacing: -0.1 },
    bodyLg:  { fontSize: 16, lineHeight: 26, letterSpacing: 0 },
    body:    { fontSize: 15, lineHeight: 24, letterSpacing: 0 },
    bodySm:  { fontSize: 14, lineHeight: 22, letterSpacing: 0 },
    caption: { fontSize: 12.5, lineHeight: 19, letterSpacing: 0.1 },
    micro:   { fontSize: 11, lineHeight: 16, letterSpacing: 0.2 },
    /** Tabular figures for scores/counters so digits don't jitter. */
    numeric: { fontSize: 26, lineHeight: 32, letterSpacing: -0.5 },
  },
};

export type TextRole = keyof typeof typography.scale;

/**
 * Build a complete text style from a role + weight. Use this instead of
 * hand-writing `{ fontSize, fontFamily, lineHeight }` in a screen.
 *
 * Returns `TextStyle` rather than a `const`-asserted literal: RN types
 * `fontWeight` as a union of specific strings, which a widened `string` from
 * an `as const` spread does not satisfy.
 */
export function text(role: TextRole, weight: 'regular' | 'bold' = 'regular'): TextStyle {
  const s = typography.scale[role];
  return {
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    letterSpacing: s.letterSpacing,
    fontFamily: weight === 'bold' ? typography.fontFamilyBold : typography.fontFamily,
    // Native resolves weight by loading a distinct file, so setting
    // fontWeight there would double-bold or be ignored depending on OEM.
    ...(Platform.OS === 'web' ? { fontWeight: weight === 'bold' ? '700' : '400' } : null),
  };
}

/* ------------------------------------------------------------------ *
 * 5. Elevation — four steps, expressed correctly on each platform.
 *    RN's `shadow*` props are iOS-only, `elevation` is Android-only, and
 *    react-native-web wants `boxShadow`; getting this wrong is why the old
 *    cards looked flat on web and heavy on Android.
 * ------------------------------------------------------------------ */

function elevation(level: 0 | 1 | 2 | 3 | 4, color = '#0F172A') {
  if (level === 0) return {};
  const spec = {
    1: { y: 1, blur: 3,  opacity: 0.06, android: 1 },
    2: { y: 4, blur: 12, opacity: 0.08, android: 3 },
    3: { y: 8, blur: 24, opacity: 0.12, android: 6 },
    4: { y: 16, blur: 40, opacity: 0.16, android: 12 },
  }[level];

  return Platform.select({
    ios: {
      shadowColor: color,
      shadowOffset: { width: 0, height: spec.y },
      shadowOpacity: spec.opacity,
      shadowRadius: spec.blur / 2,
    },
    android: { elevation: spec.android },
    default: {
      boxShadow: `0 ${spec.y}px ${spec.blur}px rgba(15,23,42,${spec.opacity})`,
    },
  }) as object;
}

export const shadow = {
  none: elevation(0),
  sm:   elevation(1),
  md:   elevation(2),
  lg:   elevation(3),
  xl:   elevation(4),
  /** Coloured glow for primary CTAs. */
  brand: Platform.select({
    ios: { shadowColor: palette.brand600, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.30, shadowRadius: 10 },
    android: { elevation: 6 },
    default: { boxShadow: `0 8px 20px ${palette.brand600}40` },
  }) as object,
} as const;

/* ------------------------------------------------------------------ *
 * 6. Motion — shared durations/easings so animations feel like one app.
 * ------------------------------------------------------------------ */

export const motion = {
  duration: { instant: 90, fast: 160, normal: 240, slow: 360, deliberate: 520 },
  /** Stagger step for list entrance animations. Kept small: anything above
   *  ~45ms makes an 8-item grid feel sluggish rather than choreographed. */
  stagger: 40,
  easing: {
    standard: [0.2, 0, 0, 1] as const,
    decelerate: [0, 0, 0, 1] as const,
    spring: { damping: 18, stiffness: 220, mass: 0.8 },
  },
} as const;

/* ------------------------------------------------------------------ *
 * 7. Layout — the tokens that make the web build look designed rather
 *    than like a phone app stretched across a desktop monitor.
 * ------------------------------------------------------------------ */

export const layout = {
  /** Horizontal padding at the screen edge. */
  screenPadding: spacing.lg,
  /** Gap between cards in a vertical stack. */
  stackGap: spacing.md,
  /** Gap between grid tiles. */
  gridGap: spacing.md,
  /** Minimum accessible touch target (iOS HIG / Material both say 44–48). */
  touchTarget: 48,
  /** Caps content width on tablets and desktop web. */
  maxContentWidth: 720,
  /** Wider cap for dashboard-style screens. */
  maxWideWidth: 1040,
  /** Standard control heights — keeps buttons/inputs/selects aligned. */
  control: { sm: 40, md: 48, lg: 56 },
  /** Bottom tab bar content height (safe-area inset added on top). */
  tabBarHeight: 60,
  /** Icon sizes. */
  icon: { xs: 14, sm: 16, md: 20, lg: 24, xl: 28, '2xl': 36 },
  /** Avatar sizes. */
  avatar: { sm: 32, md: 44, lg: 64, xl: 88 },
  hairline: Platform.OS === 'web' ? 1 : 0.5,
} as const;

/* ------------------------------------------------------------------ *
 * 8. Semantic colour roles. Components reference these — never `palette`.
 * ------------------------------------------------------------------ */

const lightColorsBase = {
  // Surfaces, back to front
  bg:           palette.n50,
  bgElevated:   palette.n0,
  surface:      palette.n0,
  surfaceAlt:   palette.n50,
  surfaceSunken: palette.n100,

  border:       palette.n200,
  borderStrong: palette.n300,
  divider:      palette.n100,

  // Text
  text:         palette.n900,
  textSecondary: palette.n600,
  textMuted:    palette.n500,
  textDisabled: palette.n400,
  textOnBrand:  palette.n0,

  // Brand
  primary:      palette.brand600,
  primaryHover: palette.brand700,
  primaryMuted: palette.brand50,
  primaryBorder: palette.brand200,
  onPrimary:    palette.n0,

  // Premium
  accent:       palette.gold500,
  accentMuted:  palette.gold50,
  accentBorder: palette.gold200,
  onAccent:     palette.n900,
  // Text colour to use *on top of* accentMuted. gold500 on gold50 is ~1.9:1,
  // well under the 4.5:1 minimum, so muted-accent surfaces need a darker ink.
  accentText:   palette.gold700,

  // Status
  success:      palette.green600,
  successMuted: palette.green100,
  warning:      palette.amber600,
  warningMuted: palette.amber100,
  danger:       palette.red600,
  dangerMuted:  palette.red100,
  info:         palette.brand600,
  infoMuted:    palette.brand50,

  // Surfaces layered ON a brand gradient (hero chips, glass panels). These
  // stay identical in both themes on purpose: the gradient underneath is the
  // same in light and dark, so a theme-reactive value would break contrast.
  onBrandMuted: 'rgba(255,255,255,0.18)',
  onBrandBorder:'rgba(255,255,255,0.24)',
  onBrandText:  '#FFFFFF',

  // Utility
  overlay:      'rgba(15,23,42,0.55)',
  scrim:        'rgba(15,23,42,0.08)',
  skeleton:     palette.n200,
  skeletonHighlight: palette.n100,
};

/**
 * Every semantic colour role, with values widened to `string`.
 * Without the mapping each role would carry the literal hex from `palette`
 * (which is `as const`), and the dark theme could never satisfy the light
 * theme's type.
 */
export type ColorRoles = { [K in keyof typeof lightColorsBase]: string };

export const lightColors: ColorRoles = lightColorsBase;

export const darkColors: ColorRoles = {
  bg:           palette.n950,
  bgElevated:   palette.n900,
  surface:      '#111C31',
  surfaceAlt:   palette.n900,
  surfaceSunken: '#0B1424',

  border:       'rgba(148,163,184,0.18)',
  borderStrong: 'rgba(148,163,184,0.32)',
  divider:      'rgba(148,163,184,0.12)',

  text:         palette.n50,
  textSecondary: palette.n300,
  textMuted:    palette.n400,
  textDisabled: palette.n600,
  textOnBrand:  palette.n0,

  primary:      palette.brand400,
  primaryHover: palette.brand300,
  primaryMuted: 'rgba(96,154,250,0.14)',
  primaryBorder: 'rgba(96,154,250,0.32)',
  onPrimary:    palette.n950,

  accent:       palette.gold400,
  accentMuted:  'rgba(251,191,36,0.14)',
  accentBorder: 'rgba(251,191,36,0.32)',
  onAccent:     palette.n950,
  // On a dark surface the light gold already carries enough contrast.
  accentText:   palette.gold300,

  success:      palette.green500,
  successMuted: 'rgba(34,197,94,0.16)',
  warning:      palette.amber500,
  warningMuted: 'rgba(245,158,11,0.16)',
  danger:       palette.red500,
  dangerMuted:  'rgba(239,68,68,0.16)',
  info:         palette.brand400,
  infoMuted:    'rgba(96,154,250,0.14)',

  onBrandMuted: 'rgba(255,255,255,0.18)',
  onBrandBorder:'rgba(255,255,255,0.24)',
  onBrandText:  '#FFFFFF',

  overlay:      'rgba(0,0,0,0.68)',
  scrim:        'rgba(255,255,255,0.06)',
  skeleton:     'rgba(148,163,184,0.16)',
  skeletonHighlight: 'rgba(148,163,184,0.26)',
};

/** Gradients, per mode. Kept as tuples for expo-linear-gradient. */
export const gradients = {
  light: {
    hero:    [palette.brand600, palette.brand800] as const,
    premium: [palette.gold400, palette.gold600] as const,
    success: [palette.green500, palette.green700] as const,
    live:    ['#10B981', '#059669'] as const,
  },
  dark: {
    hero:    [palette.brand700, palette.brand950] as const,
    premium: [palette.gold500, palette.gold700] as const,
    success: [palette.green600, palette.green700] as const,
    live:    ['#059669', '#047857'] as const,
  },
} as const;

/**
 * Category tile accents. Fixed order so a category keeps the same colour
 * between sessions — a category that changes colour on every load reads as
 * a bug, and it destroys the user's ability to recognise tiles by colour.
 * Index by category id, not by array position.
 */
export const categoryAccents = [
  { fg: '#3B7BF6', bg: 'rgba(59,123,246,0.12)' },
  { fg: '#16A34A', bg: 'rgba(22,163,74,0.12)' },
  { fg: '#D97706', bg: 'rgba(217,119,6,0.12)' },
  { fg: '#DC2626', bg: 'rgba(220,38,38,0.12)' },
  { fg: '#9333EA', bg: 'rgba(147,51,234,0.12)' },
  { fg: '#0891B2', bg: 'rgba(8,145,178,0.12)' },
  { fg: '#DB2777', bg: 'rgba(219,39,119,0.12)' },
  { fg: '#4F46E5', bg: 'rgba(79,70,229,0.12)' },
] as const;

export function accentForCategory(id: number | string) {
  const n = typeof id === 'number' ? id : Number(String(id).replace(/\D/g, '')) || 0;
  return categoryAccents[Math.abs(n) % categoryAccents.length];
}

/* ------------------------------------------------------------------ *
 * 9. Theme assembly
 * ------------------------------------------------------------------ */

export type ThemeMode = 'light' | 'dark';

export function getTheme(mode: ThemeMode) {
  return {
    mode,
    colors: mode === 'dark' ? darkColors : lightColors,
    gradients: mode === 'dark' ? gradients.dark : gradients.light,
    spacing,
    radii,
    typography,
    text,
    shadow,
    motion,
    layout,
    isDark: mode === 'dark',
  };
}

export type AppTheme = ReturnType<typeof getTheme>;

/* ------------------------------------------------------------------ *
 * 10. Score semantics — one place decides what "a good score" looks
 *     like, so the colour of a 7/10 is identical on every screen.
 * ------------------------------------------------------------------ */

export function scoreTone(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 7.5) return 'success';
  if (score >= 5) return 'warning';
  return 'danger';
}

export function scoreColor(score: number, theme: AppTheme) {
  return theme.colors[scoreTone(score)];
}

export function scoreMutedColor(score: number, theme: AppTheme) {
  const tone = scoreTone(score);
  return theme.colors[`${tone}Muted` as const];
}

/* ------------------------------------------------------------------ *
 * Legacy aliases — the previous token file exported a flat `colors`
 * object that a few call sites still import. Keep them resolving so the
 * migration can land screen-by-screen instead of in one risky sweep.
 * ------------------------------------------------------------------ */

export const colors = {
  primary:      lightColors.primary,
  primaryDark:  palette.brand800,
  primaryLight: palette.brand400,
  secondary:    lightColors.accent,
  accent:       lightColors.accent,
  bgLight:      lightColors.bg,
  bgDark:       darkColors.bg,
  surfaceLight: lightColors.surface,
  surfaceDark:  darkColors.surface,
  textLight:    lightColors.text,
  textDark:     darkColors.text,
  textMutedLight: lightColors.textMuted,
  textMutedDark:  darkColors.textMuted,
  border:       lightColors.border,
  success:      lightColors.success,
  warning:      lightColors.warning,
  danger:       lightColors.danger,
};
