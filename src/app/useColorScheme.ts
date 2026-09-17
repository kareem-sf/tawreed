import { useCallback, useEffect, useState } from 'react';

export type ColorSchemeSetting = 'auto' | 'light' | 'dark';
export type ResolvedScheme = 'light' | 'dark';

const OWN_KEY = 'tawreed-color-scheme';
/** Mantine persisted its own copy under this key — adopt it once so users keep
 * their choice across the component migration, then we own OWN_KEY. */
const LEGACY_MANTINE_KEY = 'mantine-color-scheme';
/** Kept name: index.css, the dark: variant and tests key off this attribute. */
const ATTRIBUTE = 'mantineColorScheme';

function isSetting(raw: string | null): raw is ColorSchemeSetting {
  return raw === 'auto' || raw === 'light' || raw === 'dark';
}

export function resolveColorScheme(setting: ColorSchemeSetting, systemDark: boolean): ResolvedScheme {
  if (setting === 'light') return 'light';
  if (setting === 'dark') return 'dark';
  return systemDark ? 'dark' : 'light';
}

/** Precedence for the persisted choice: our own key wins, the legacy Mantine
 * key is adopted once, anything else falls back to system-following auto. */
export function coalesceStoredSetting(own: string | null, legacy: string | null): ColorSchemeSetting {
  if (isSetting(own)) return own;
  if (isSetting(legacy)) return legacy;
  return 'auto';
}

function readStoredSetting(): ColorSchemeSetting {
  let own: string | null = null;
  let legacy: string | null = null;
  try {
    own = window.localStorage.getItem(OWN_KEY);
    legacy = window.localStorage.getItem(LEGACY_MANTINE_KEY);
  } catch {
    // Storage unavailable (private mode, minimal embedders): system default.
  }
  return coalesceStoredSetting(own, legacy);
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function applyResolvedScheme(scheme: ResolvedScheme): void {
  document.documentElement.dataset[ATTRIBUTE] = scheme;
}

/** Owns the color-scheme attribute previously owned by MantineProvider.
 * Persists locally; callers mirror the choice to the Rust settings store
 * themselves so a failed write can roll the UI back. */
export function useColorScheme() {
  const [setting, setSettingState] = useState<ColorSchemeSetting>(readStoredSetting);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (setting !== 'auto') return undefined;
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return undefined;
    const sync = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, [setting]);

  const resolved = resolveColorScheme(setting, systemDark);
  useEffect(() => {
    applyResolvedScheme(resolved);
  }, [resolved]);

  const applySetting = useCallback((next: ColorSchemeSetting) => {
    setSettingState(next);
    try {
      window.localStorage.setItem(OWN_KEY, next);
    } catch {
      // Private mode: the choice still applies for this session.
    }
    applyResolvedScheme(resolveColorScheme(next, systemPrefersDark()));
  }, []);

  return { setting, resolved, applySetting };
}
