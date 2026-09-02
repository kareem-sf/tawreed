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
    expect(css).toMatch(/outline:\s*2px solid var\(--gold-deep\)/);
    expect(css).toMatch(/--gold-deep:\s*#9a6700/);
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

  it('renders the AI consent step as a real dialog, not a styled section', () => {
    // Mantine's <Modal> renders role="dialog" and aria-modal="true" automatically
    // (plus focus trapping/restoration), which a hand-rolled <section> cannot provide.
    // The project has no component-rendering test harness (no @testing-library/react
    // devDependency), so this asserts the source uses Modal for the consent view
    // rather than rendering the DOM directly.
    const workspace = readSource('../src/features/workflow/components/WorkflowWorkspace.tsx');
    expect(workspace).toMatch(/import\s*\{[^}]*\bModal\b[^}]*\}\s*from\s*'@mantine\/core'/);
    const consentBlockMatch = workspace.match(/state\.view === 'consent'[\s\S]*?onClose=\{[^}]*\}/);
    expect(consentBlockMatch).not.toBeNull();
    expect(consentBlockMatch![0]).toContain('<Modal');
    expect(consentBlockMatch![0]).not.toContain('<section');
    expect(consentBlockMatch![0]).toContain('onClose={() => onConsent(false)}');
  });
});
