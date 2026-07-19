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
});
