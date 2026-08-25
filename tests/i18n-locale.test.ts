import { describe, expect, it } from 'vitest';
import {
  canonicalLocale,
  isArabicLocale,
  resolvedLocale,
} from '../src/i18n/locale';

describe('resolved UI locale', () => {
  it.each([
    ['ar', 'ar'],
    ['ar-EG', 'ar'],
    ['ar_SA', 'ar'],
    ['en', 'en'],
    ['en-US', 'en'],
    ['fr-FR', 'en'],
    [undefined, 'en'],
  ] as const)('canonicalizes %s to %s', (language, expected) => {
    expect(canonicalLocale(language)).toBe(expected);
  });

  it('uses a supported raw base before the resolved fallback', () => {
    expect(resolvedLocale({ language: 'ar-EG', resolvedLanguage: 'ar' })).toBe('ar');
    expect(isArabicLocale({ language: 'ar-EG', resolvedLanguage: 'ar' })).toBe(true);
    expect(resolvedLocale({ language: 'ar_SA', resolvedLanguage: 'en' })).toBe('ar');
    expect(resolvedLocale({ language: 'en-US', resolvedLanguage: 'en' })).toBe('en');
    expect(isArabicLocale({ language: 'fr-FR', resolvedLanguage: 'en' })).toBe(false);
  });

  it('falls back to canonical raw language when resolved language is absent', () => {
    expect(resolvedLocale({ language: 'ar_SA' })).toBe('ar');
    expect(isArabicLocale({ language: 'en-US' })).toBe(false);
  });
});
