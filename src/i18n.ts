import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './i18n/resources/ar';
import en from './i18n/resources/en';
import {
  canonicalLocale,
  resolvedLocale,
  type SupportedLocale,
} from './i18n/locale';

const LOCALE_STORAGE_KEY = 'tawreed-locale';

function syncDocumentLocale(locale: SupportedLocale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
}

function persistLocale(locale: SupportedLocale): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Persistence is an optional enhancement in restricted/test contexts.
  }
}

function storedLocale(): SupportedLocale {
  try {
    const saved = typeof window === 'undefined'
      ? null
      : window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return canonicalLocale(saved);
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
const resolvedInitialLocale = resolvedLocale(i18n);
syncDocumentLocale(resolvedInitialLocale);
persistLocale(resolvedInitialLocale);

i18n.on('languageChanged', (language) => {
  const locale = resolvedLocale({ language, resolvedLanguage: i18n.resolvedLanguage });
  syncDocumentLocale(locale);
  persistLocale(locale);
});

export default i18n;
