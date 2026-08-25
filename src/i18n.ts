import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './i18n/resources/ar';
import en from './i18n/resources/en';

const LOCALE_STORAGE_KEY = 'tawreed-locale';

function syncDocumentLocale(language: string): void {
  if (typeof document === 'undefined') return;
  const locale = language === 'ar' ? 'ar' : 'en';
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
}

function storedLocale(): 'en' | 'ar' {
  try {
    const saved = typeof window === 'undefined'
      ? null
      : window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return saved === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

const initialLocale = storedLocale();

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
  },
  lng: initialLocale,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});
syncDocumentLocale(initialLocale);

i18n.on('languageChanged', (language) => {
  syncDocumentLocale(language);
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, language);
    }
  } catch {
    // Persistence is an optional enhancement in restricted/test contexts.
  }
});

export default i18n;
