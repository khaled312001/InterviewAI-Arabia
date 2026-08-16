/**
 * The only file in the app where a raw hex may appear.
 * Everything else reads colours through the theme.
 */

// ── Brand ──────────────────────────────────────────────────────────────────
export const brand = {
  50: '#EEF4FF', 100: '#D9E5FF', 200: '#B6CCFE', 300: '#8AACFE', 400: '#5B8CFD',
  500: '#2D73FD',   // brand-500 — the product blue
  600: '#1D63EA', 700: '#1450CE', 800: '#0E45BC',
  900: '#0736A8',   // brand deep
} as const;

export const gold = {
  50: '#FFF8E6', 100: '#FFEEC2', 200: '#FFDE8A', 300: '#FFCD52', 400: '#FFBE24',
  500: '#FEAF04',   // brand gold
  600: '#D18E00', 700: '#A16D00', 800: '#7A5200', 900: '#523700',
} as const;

export const neutral = {
  0: '#FFFFFF', 25: '#FCFDFF', 50: '#F5F7FB', 100: '#EDF1F7', 200: '#E3E8F0',
  300: '#CDD5E1', 400: '#9AA4B2', 500: '#6B7789', 600: '#5A6779', 700: '#3E4A5C',
  800: '#26324A', 850: '#1A2438', 900: '#121C2E', 950: '#0B1220',
} as const;

// ── Semantic ramps (identical hue logic light/dark, different stops) ────────
export const semantic = {
  success: { light: { main: '#12855C', light: '#34C38F', dark: '#0C6244' }, dark: { main: '#34C38F', light: '#6FDCB4', dark: '#12855C' } },
  error:   { light: { main: '#D92D20', light: '#F97066', dark: '#A21309' }, dark: { main: '#F97066', light: '#FDA29B', dark: '#D92D20' } },
  warning: { light: { main: '#E08600', light: '#FDB022', dark: '#B35C00' }, dark: { main: '#FDB022', light: '#FEC84B', dark: '#E08600' } },
  info:    { light: { main: '#0B7EC4', light: '#38A8E8', dark: '#075E93' }, dark: { main: '#38A8E8', light: '#7CC9F5', dark: '#0B7EC4' } },
} as const;

// ── Chart series — 7 stops, ordered by first-use priority. ─────────────────
export const chartLight = ['#2D73FD', '#FEAF04', '#12855C', '#D92D20', '#7C3AED', '#0E9BA8', '#8A5A2B'] as const;
export const chartDark  = ['#5B93FF', '#FFCD52', '#34C38F', '#F97066', '#A78BFA', '#22C7D6', '#C69B6D'] as const;

// ── Radii / layout constants used by both theme and shell ──────────────────
export const radius = { xs: 6, sm: 8, md: 10, lg: 12, xl: 16, xxl: 20, pill: 999 } as const;

export const layout = {
  sidebarWidth: 264,
  sidebarRail: 76,
  headerHeight: 64,
  headerHeightXs: 56,
  contentMaxWidth: 1440,
} as const;

export type ColorScheme = 'light' | 'dark';
