// @vitest-environment jsdom
//
// Slice-5 guard: the app-owned color scheme keeps the attribute contract
// (data-mantine-color-scheme) that CSS, the dark: variant and tests key off,
// and resolves the persisted choice with legacy adoption.
// (jsdom here has no localStorage, so persistence itself is verified by
// construction: every storage access is guarded and falls back to auto.)
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import {
  coalesceStoredSetting,
  resolveColorScheme,
  useColorScheme,
} from '../src/app/useColorScheme';

afterEach(cleanup);

describe('resolveColorScheme', () => {
  it('maps explicit choices directly and follows the system on auto', () => {
    expect(resolveColorScheme('light', true)).toBe('light');
    expect(resolveColorScheme('dark', false)).toBe('dark');
    expect(resolveColorScheme('auto', true)).toBe('dark');
    expect(resolveColorScheme('auto', false)).toBe('light');
  });
});

describe('coalesceStoredSetting', () => {
  it('prefers our key, adopts the legacy Mantine key, else auto', () => {
    expect(coalesceStoredSetting('dark', 'light')).toBe('dark');
    expect(coalesceStoredSetting(null, 'dark')).toBe('dark');
    expect(coalesceStoredSetting('amoled', 'dark')).toBe('dark');
    expect(coalesceStoredSetting(null, null)).toBe('auto');
    expect(coalesceStoredSetting('bogus', 'bogus')).toBe('auto');
  });
});

describe('useColorScheme', () => {
  it('defaults to system-following auto and writes the attribute', () => {
    const { result } = renderHook(() => useColorScheme());
    expect(result.current.setting).toBe('auto');
    expect(result.current.resolved).toBe('light');
    expect(document.documentElement.dataset.mantineColorScheme).toBe('light');
  });

  it('applies an explicit choice immediately without throwing', () => {
    const { result } = renderHook(() => useColorScheme());
    expect(() => act(() => result.current.applySetting('dark'))).not.toThrow();
    expect(result.current.setting).toBe('dark');
    expect(document.documentElement.dataset.mantineColorScheme).toBe('dark');
  });
});
