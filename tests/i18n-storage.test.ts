import { afterEach, describe, expect, it, vi } from 'vitest';

describe('i18n locale storage', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('synchronizes Arabic and English document metadata without mounted configuration', async () => {
    const values = new Map([['tawreed-locale', 'ar']]);
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
    await i18n.changeLanguage('en');
    expect(documentElement).toEqual({ lang: 'en', dir: 'ltr' });
    expect(storage.setItem).toHaveBeenCalledWith('tawreed-locale', 'en');
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
