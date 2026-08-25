import { afterEach, describe, expect, it, vi } from 'vitest';

describe('i18n locale storage', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('canonicalizes a cold stored Arabic variant before initialization', async () => {
    const values = new Map([['tawreed-locale', 'ar-SA']]);
    const documentElement = { lang: '', dir: '' };
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    };
    vi.stubGlobal('window', { localStorage: storage });
    vi.stubGlobal('document', { documentElement });

    const { default: i18n } = await import('../src/i18n');

    expect(i18n.language).toBe('ar');
    expect(documentElement).toEqual({ lang: 'ar', dir: 'rtl' });
    expect(storage.setItem).toHaveBeenCalledWith('tawreed-locale', 'ar');
  });

  it('persists and renders locale variants as exact supported base languages', async () => {
    const values = new Map([['tawreed-locale', 'en']]);
    const documentElement = { lang: '', dir: '' };
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    };
    vi.stubGlobal('window', { localStorage: storage });
    vi.stubGlobal('document', { documentElement });
    const { default: i18n } = await import('../src/i18n');

    const cases = [
      ['ar', 'ar', 'rtl'],
      ['ar-EG', 'ar', 'rtl'],
      ['ar-SA', 'ar', 'rtl'],
      ['en', 'en', 'ltr'],
      ['en-US', 'en', 'ltr'],
      ['fr-FR', 'en', 'ltr'],
    ] as const;
    for (const [requested, locale, direction] of cases) {
      await i18n.changeLanguage(requested);
      expect(documentElement).toEqual({ lang: locale, dir: direction });
      expect(storage.setItem).toHaveBeenLastCalledWith('tawreed-locale', locale);
      expect(values.get('tawreed-locale')).toBe(locale);
    }
  });

  it('falls back to English in Node without touching global localStorage', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    let accessed = false;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        accessed = true;
        throw new Error('global localStorage should not be accessed');
      },
    });

    try {
      const { default: i18n } = await import('../src/i18n');
      expect(i18n.language).toBe('en');
      expect(accessed).toBe(false);
      expect(typeof document).toBe('undefined');
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'localStorage');
      }
    }
  });
});
