import { useColorScheme, useWindowDimensions, I18nManager } from 'react-native';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { getTheme, ThemeMode, AppTheme, layout } from './tokens';

type Preference = 'system' | 'light' | 'dark';

interface ThemeState {
  preference: Preference;
  setPreference: (p: Preference) => void;
}

export const useThemePreference = create<ThemeState>()(
  persist(
    (set) => ({
      preference: 'system',
      setPreference: (preference) => set({ preference }),
    }),
    { name: 'theme-pref', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

export function useAppTheme(): AppTheme {
  const system = useColorScheme();
  const preference = useThemePreference((s) => s.preference);
  const mode: ThemeMode =
    preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
  return getTheme(mode);
}

/**
 * Responsive breakpoints.
 *
 * The Expo web build is the marketing-visible product surface, so it has to
 * hold up on a desktop monitor — not just render a 390px phone column in the
 * middle of a 1920px screen. Screens use `maxWidth` from here to cap content
 * and `columns` to widen grids instead of stretching tiles.
 */
export function useResponsive() {
  const { width } = useWindowDimensions();

  const isPhone = width < 600;
  const isTablet = width >= 600 && width < 1024;
  const isDesktop = width >= 1024;

  return {
    width,
    isPhone,
    isTablet,
    isDesktop,
    /** Cards per row in the category grid. */
    columns: isDesktop ? 4 : isTablet ? 3 : 2,
    /** Content cap; `undefined` on phones so nothing is inset needlessly. */
    maxWidth: isPhone ? undefined : layout.maxContentWidth,
    maxWideWidth: isPhone ? undefined : layout.maxWideWidth,
    /** Screens get a little more breathing room on large viewports. */
    screenPadding: isDesktop ? 24 : layout.screenPadding,
  };
}

/**
 * Direction helper.
 *
 * `I18nManager.isRTL` is the source of truth on native, but on react-native-web
 * it is only true after `forceRTL` runs at boot. Components that need to flip a
 * directional icon (chevrons, arrows) should use `chevronBack`/`chevronForward`
 * rather than hardcoding `chevron-back`, which is what left the old screens
 * pointing the wrong way once English was selected.
 */
export function useDirection() {
  const isRTL = I18nManager.isRTL;
  // Typed as the Ionicons glyph union rather than `as const` — a conditional
  // expression is not a literal, so `as const` is invalid on it.
  type Glyph = keyof typeof Ionicons.glyphMap;
  return {
    isRTL,
    /** Icon that visually points "back"/"previous" in the current direction. */
    chevronBack: (isRTL ? 'chevron-forward' : 'chevron-back') as Glyph,
    /** Icon that visually points "forward"/"next" — i.e. into a detail screen. */
    chevronForward: (isRTL ? 'chevron-back' : 'chevron-forward') as Glyph,
    arrowForward: (isRTL ? 'arrow-back' : 'arrow-forward') as Glyph,
    arrowBack: (isRTL ? 'arrow-forward' : 'arrow-back') as Glyph,
  };
}
