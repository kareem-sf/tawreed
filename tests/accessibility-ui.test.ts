import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { appendAccessibleStatus } from '../src/lib/accessibility';

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('accessible UI contracts', () => {
  it('adds translated status text only when the state is active', () => {
    expect(appendAccessibleStatus('Settings')).toBe('Settings');
    expect(appendAccessibleStatus('Settings', 'A Tawreed update is available'))
      .toBe('Settings. A Tawreed update is available');
    expect(appendAccessibleStatus('الإعدادات', 'يتوفر تحديث جديد لتوريد'))
      .toBe('الإعدادات. يتوفر تحديث جديد لتوريد');
  });

  it('keeps custom title-bar controls visibly focused', () => {
    const css = readSource('../src/index.css');
    expect(css).toContain('.titlebar-btn:focus-visible,\n.titlebar-nav:focus-visible');
    expect(css).toMatch(/outline:\s*2px solid #9a6700/);
    expect(css).toContain('@media (forced-colors: active)');
  });

  it('honors the operating-system reduced-motion preference', () => {
    const css = readSource('../src/index.css');
    const blurFade = readSource('../src/components/ui/blur-fade.tsx');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('.animate-shimmer-slide,');
    expect(blurFade).toContain('useReducedMotion');
    expect(blurFade).toContain("initial={reduceMotion ? false : 'hidden'}");
    expect(blurFade).toContain("exit={reduceMotion ? undefined : 'hidden'}");
  });

  it('announces update availability without exposing the decorative dot', () => {
    const titleBar = readSource('../src/components/TitleBar.tsx');
    expect(titleBar).toContain("t('updateAvailableIndicator')");
    expect(titleBar).toContain('aria-label={settingsLabel}');
    expect(titleBar).toContain('aria-hidden="true"');
  });
});
