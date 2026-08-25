export type SupportedLocale = 'en' | 'ar';

export interface LocaleSource {
  language?: string;
  resolvedLanguage?: string;
}

function supportedBase(language: unknown): SupportedLocale | undefined {
  if (typeof language !== 'string') return undefined;
  const base = language.trim().toLowerCase().split(/[-_]/, 1)[0];
  return base === 'ar' || base === 'en' ? base : undefined;
}

export function canonicalLocale(language: unknown): SupportedLocale {
  return supportedBase(language) ?? 'en';
}

export function resolvedLocale(source: LocaleSource): SupportedLocale {
  return supportedBase(source.language)
    ?? supportedBase(source.resolvedLanguage)
    ?? 'en';
}

export function isArabicLocale(source: LocaleSource): boolean {
  return resolvedLocale(source) === 'ar';
}
