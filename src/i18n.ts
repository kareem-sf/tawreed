import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './i18n/resources/ar';
import en from './i18n/resources/en';

const LOCALE_STORAGE_KEY = 'tawreed-locale';

function storedLocale(): 'en' | 'ar' {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    return saved === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
  },
  lng: storedLocale(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (language) => {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, language);
  } catch {
    // Persistence is an optional enhancement in restricted/test contexts.
  }
});

export default i18n;
