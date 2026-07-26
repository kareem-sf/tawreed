import { describe, expect, it } from 'vitest';
import i18n from '../src/i18n';

const updateKeys = [
  'checkForUpdates',
  'checkingForUpdates',
  'upToDate',
  'updateAvailable',
  'updateAvailableIndicator',
  'updateReadyDetail',
  'updateChecksum',
  'openUpdateRelease',
  'updateCheckFailed',
  'updateOffline',
  'updateRateLimited',
  'updateServiceUnavailable',
  'updateNoRelease',
  'updateReleaseInvalid',
  'updateDownloadFailed',
  'tryAgain',
  'mitLicense',
];

describe('update localization', () => {
  for (const language of ['en', 'ar']) {
    it(`has complete ${language} update copy`, () => {
      for (const key of updateKeys) {
        const translated = i18n.t(key, { lng: language, version: '1.2.3' });
        expect(translated).not.toBe(key);
        expect(translated.trim()).not.toBe('');
      }
    });
  }

  it('has full key-set parity between en and ar', () => {
    const en = i18n.getResourceBundle('en', 'translation') as Record<string, string>;
    const ar = i18n.getResourceBundle('ar', 'translation') as Record<string, string>;
    const missingInAr = Object.keys(en).filter((key) => !(key in ar));
    const missingInEn = Object.keys(ar).filter((key) => !(key in en));
    expect(missingInAr, `keys missing in ar: ${missingInAr.join(', ')}`).toEqual([]);
    expect(missingInEn, `keys missing in en: ${missingInEn.join(', ')}`).toEqual([]);
  });
});
