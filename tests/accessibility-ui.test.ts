import { describe, expect, it } from 'vitest';
import { appendAccessibleStatus } from '../src/lib/accessibility';
import titleBarSource from '../src/components/TitleBar.tsx?raw';
import blurFadeSource from '../src/components/ui/blur-fade.tsx?raw';
import appCss from '../src/index.css?raw';

describe('accessible UI contracts', () => {
  it('adds translated status text only when the state is active', () => {
    expect(appendAccessibleStatus('Settings')).toBe('Settings');
    expect(appendAccessibleStatus('Settings', 'A Tawreed update is available'))
      .toBe('Settings. A Tawreed update is available');
    expect(appendAccessibleStatus('الإعدادات', 'يتوفر تحديث جديد لتوريد'))
      .toBe('الإعدادات. يتوفر تحديث جديد لتوريد');
  });

  it('keeps custom title-bar controls visibly focused', () => {
    expect(appCss).toContain('.titlebar-btn:focus-visible,\n.titlebar-nav:focus-visible');
    expect(appCss).toMatch(/outline:\s*2px solid #9a6700/);
    expect(appCss).toContain('@media (forced-colors: active)');
  });

  it('honors the operating-system reduced-motion preference', () => {
    expect(appCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(appCss).toContain('.animate-shimmer-slide,');
    expect(blurFadeSource).toContain('useReducedMotion');
    expect(blurFadeSource).toContain("initial={reduceMotion ? false : 'hidden'}");
    expect(blurFadeSource).toContain("exit={reduceMotion ? undefined : 'hidden'}");
  });

  it('announces update availability without exposing the decorative dot', () => {
    expect(titleBarSource).toContain("t('updateAvailableIndicator')");
    expect(titleBarSource).toContain('aria-label={settingsLabel}');
    expect(titleBarSource).toContain('aria-hidden="true"');
  });
});
