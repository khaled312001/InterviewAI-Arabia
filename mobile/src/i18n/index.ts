import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import ar from './ar.json';
import en from './en.json';

const deviceLang = Localization.getLocales()[0]?.languageCode || 'ar';

i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: en },
  },
  lng: deviceLang === 'en' ? 'en' : 'ar',
  fallbackLng: 'ar',
  interpolation: { escapeValue: false },
});

export default i18n;

export function setAppLanguage(lng: 'ar' | 'en') {
  return i18n.changeLanguage(lng);
}
