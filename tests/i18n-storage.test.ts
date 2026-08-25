import { afterEach, describe, expect, it, vi } from 'vitest';

describe('i18n locale storage', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('reads and writes locale through browser localStorage', async () => {
    const values = new Map([['tawreed-locale', 'ar']]);
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    };
    vi.stubGlobal('window', { localStorage: storage });

    const { default: i18n } = await import('../src/i18n');

    expect(i18n.language).toBe('ar');
    await i18n.changeLanguage('en');
    expect(storage.setItem).toHaveBeenCalledWith('tawreed-locale', 'en');
  });
});
