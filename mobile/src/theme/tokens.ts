export const colors = {
  primary: '#0F5AA8',
  primaryDark: '#0A3F75',
  primaryLight: '#3679C6',
  secondary: '#F39C12',
  accent: '#2BB673',

  bgLight: '#F4F6FA',
  bgDark: '#0B1220',
  surfaceLight: '#FFFFFF',
  surfaceDark: '#14213D',

  textLight: '#16213E',
  textDark: '#F1F3F8',
  textMutedLight: '#6B7280',
  textMutedDark: '#9AA3B2',

  border: '#E4E9F2',
  success: '#2E7D32',
  warning: '#ED6C02',
  danger: '#C62828',
};

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48,
};

export const radii = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 };

export const typography = {
  fontFamily: 'Cairo-Regular',
  fontFamilyBold: 'Cairo-Bold',
  sizes: {
    caption: 12, body: 14, bodyLg: 16, h3: 18, h2: 22, h1: 28, display: 34,
  },
};

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
};

export type ThemeMode = 'light' | 'dark';

export function getTheme(mode: ThemeMode) {
  const isDark = mode === 'dark';
  return {
    mode,
    colors: {
      ...colors,
      bg: isDark ? colors.bgDark : colors.bgLight,
      surface: isDark ? colors.surfaceDark : colors.surfaceLight,
      text: isDark ? colors.textDark : colors.textLight,
      textMuted: isDark ? colors.textMutedDark : colors.textMutedLight,
    },
    spacing,
    radii,
    typography,
    shadow,
  };
}

export type AppTheme = ReturnType<typeof getTheme>;
