import { useEffect, useState } from 'react';
import { AccessibilityInfo, useColorScheme, useWindowDimensions } from 'react-native';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { getTheme, ThemeMode, AppTheme, layout } from './tokens';
import { useLanguage } from '../i18n';

export type ThemePreference = 'system' | 'light' | 'dark';

interface ThemeState {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}

/**
 * Light first. The app opens in the light theme on every device, and the
 * reader switches to dark — or back to following the system — themselves.
 *
 * Version 1 moves existing installs across: version 0 defaulted to 'system',
 * and a stored 'system' cannot tell "chose it" from "never touched it". Nearly
 * everyone is the second, so they get the new default; anyone who really
 * wants the system back is one tap away in Settings.
 */
export const useThemePreference = create<ThemeState>()(
  persist(
    (set) => ({
      preference: 'light',
      setPreference: (preference) => set({ preference }),
    }),
    {
      name: 'theme-pref',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      migrate: (persisted: any, version) => {
        if (version < 1 && (!persisted || persisted.preference === 'system')) {
          return { ...(persisted ?? {}), preference: 'light' } as ThemeState;
        }
        return persisted as ThemeState;
      },
    },
  ),
);

/** The resolved mode — what is actually on screen, after 'system' is looked up. */
export function useThemeMode(): ThemeMode {
  const system = useColorScheme();
  const preference = useThemePreference((s) => s.preference);
  return preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
}

/**
 * Whether the reader has asked the system to reduce motion.
 *
 * Read once and then subscribed to, because the setting can be changed while
 * the app is open — on iOS it is a Control Centre toggle. Defaults to `false`
 * so a platform that cannot answer (older web engines) keeps the normal
 * experience rather than a permanently still one.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => { if (alive) setReduced(on); })
      .catch(() => { /* unsupported: keep motion */ });

    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { alive = false; sub?.remove?.(); };
  }, []);

  return reduced;
}

export function useAppTheme(): AppTheme {
  const mode = useThemeMode();
  const reducedMotion = useReducedMotion();
  // Every animation in the app reads its duration from `theme.motion`, so
  // swapping the set here turns motion down everywhere at once — there is no
  // list of animated components to keep in step, and none can be forgotten.
  return getTheme(mode, reducedMotion);
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
  const { width, height } = useWindowDimensions();

  const isPhone = width < 600;
  const isTablet = width >= 600 && width < 1024;
  const isDesktop = width >= 1024;

  return {
    width,
    /** Viewport height. A layout that only ever reads `width` cannot tell that
     *  its content has run out of room vertically — which is how a stage ends
     *  up drawing its caption underneath a banner. */
    height,
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
 * Follows the LANGUAGE, not `I18nManager.isRTL`. The native flag is fixed for
 * the life of the process, so reading it left every chevron pointing the
 * Arabic way after a switch to English until the app was restarted. The root
 * view's `direction` style (App.tsx) flips layout immediately; this flips the
 * glyphs to match. Components must use `chevronBack`/`chevronForward` rather
 * than hardcoding `chevron-back`.
 */
export function useDirection() {
  const { isRTL } = useLanguage();
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
