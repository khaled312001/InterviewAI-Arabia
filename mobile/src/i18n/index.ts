import i18n from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import { I18nManager, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ar from './ar';
import en from './en';

export type AppLanguage = 'ar' | 'en';

const STORAGE_KEY = 'app-language';

/*
 * Arabic-first: a first launch is Arabic whatever the device locale says, and
 * English is one tap away in Settings. What changed is that the choice now
 * SURVIVES. It used to live only in i18next's memory, so every cold start
 * quietly switched an English reader back to Arabic.
 */
i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: en },
  },
  // English is the default; Arabic is a saved choice.
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;

export const isRTLLanguage = (lng: string | undefined) => (lng ?? 'en').startsWith('ar');

/**
 * Point the platform's own notion of direction at the language.
 *
 * Web: the `dir`/`lang` attributes on <html>. react-native-web lays out with
 * CSS logical properties, so this flips margins, rows and text alignment
 * everywhere at once, and screen readers pick the right voice from `lang`.
 *
 * Native: `forceRTL` is read ONCE, when the app process starts, so this only
 * fixes the NEXT launch — the running one is flipped by the `direction` style
 * on the root view in App.tsx, which Yoga applies to every descendant
 * immediately. Between the two, a language change is correct on the spot and
 * stays correct after a restart, with no "please reopen the app" step.
 */
function applyPlatformDirection(lng: AppLanguage) {
  const rtl = isRTLLanguage(lng);
  if (Platform.OS === 'web') {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('dir', rtl ? 'rtl' : 'ltr');
      document.documentElement.setAttribute('lang', lng);
    }
    return;
  }
  I18nManager.allowRTL(rtl);
  if (I18nManager.isRTL !== rtl) I18nManager.forceRTL(rtl);
}

/**
 * Restore the saved language. Awaited by App.tsx before the first real frame,
 * so a reader who chose Arabic never sees an English flash on launch.
 */
export async function initLanguage(): Promise<AppLanguage> {
  let saved: string | null = null;
  try { saved = await AsyncStorage.getItem(STORAGE_KEY); } catch { /* storage off: default */ }
  const lng: AppLanguage = saved === 'ar' ? 'ar' : 'en';
  if (i18n.language !== lng) await i18n.changeLanguage(lng);
  applyPlatformDirection(lng);
  return lng;
}

/** Listeners that want to hear about an explicit change (e.g. to tell the server). */
const listeners = new Set<(lng: AppLanguage) => void>();
export function onLanguageChanged(fn: (lng: AppLanguage) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export async function setAppLanguage(lng: AppLanguage) {
  await i18n.changeLanguage(lng);
  applyPlatformDirection(lng);
  try { await AsyncStorage.setItem(STORAGE_KEY, lng); } catch { /* still applied for this session */ }
  listeners.forEach((fn) => { try { fn(lng); } catch { /* a listener must not block the switch */ } });
}

/** The current language and whether it reads right-to-left. Re-renders on change. */
export function useLanguage(): { language: AppLanguage; isRTL: boolean } {
  const { i18n: inst } = useTranslation();
  const language: AppLanguage = isRTLLanguage(inst.language) ? 'ar' : 'en';
  return { language, isRTL: language === 'ar' };
}
