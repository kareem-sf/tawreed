import { describe, expect, it } from 'vitest';
import {
  formatHistoryTimestamp,
  type HistoryTimestamp,
} from '../src/features/history/HistoryDrawer';
import type { LocaleSource } from '../src/i18n/locale';

describe('History timestamp locale safety', () => {
  const timestamp = new Date(2026, 7, 25, 13, 5, 9);

  it('demonstrates that the raw underscore locale throws in Intl', () => {
    expect(() => timestamp.toLocaleString('ar_SA')).toThrow(RangeError);
  });

  it.each([
    ['ar', { language: 'ar' }, 'ar'],
    ['ar-EG', { language: 'ar-EG' }, 'ar'],
    ['ar_SA', { language: 'ar_SA' }, 'ar'],
    ['en-US', { language: 'en-US' }, 'en'],
    ['unsupported locale', { language: 'fr-FR' }, 'en'],
    ['null locale', null, 'en'],
  ] satisfies ReadonlyArray<readonly [string, LocaleSource | null, 'ar' | 'en']>)(
    'formats %s through a canonical locale without throwing',
    (_label, source, expectedLocale) => {
      let formatted: HistoryTimestamp | undefined;

      expect(() => {
        formatted = formatHistoryTimestamp(timestamp, source);
      }).not.toThrow();

      expect(formatted).toEqual({
        tooltip: timestamp.toLocaleString(expectedLocale),
        date: timestamp.toLocaleDateString(expectedLocale),
        time: timestamp.toLocaleTimeString(expectedLocale, {
          hour: '2-digit',
          minute: '2-digit',
        }),
      });
    },
  );
});
