import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './ar';
import en from './en';

// Arabic-first by design — we ignore the browser/device locale on launch so
// users always start in the native app language. They can switch to English
// from Settings if they prefer. Selected language persists via i18next's own
// in-memory state for the session; Settings writes it back explicitly.
i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: en },
  },
  lng: 'ar',
  fallbackLng: 'ar',
  interpolation: { escapeValue: false },
});

export default i18n;

export function setAppLanguage(lng: 'ar' | 'en') {
  return i18n.changeLanguage(lng);
}
