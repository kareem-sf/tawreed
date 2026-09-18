// @vitest-environment jsdom
//
// Settings tab guard: the modal opens on General, the two tabs switch
// panels, and inactive panels stay mounted (forceMount) so half-typed keys
// and provider status survive tab switches.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { TooltipProvider } from '../src/components/ui/tooltip';
import i18n from '../src/i18n';
import SettingsModal from '../src/features/settings/SettingsModal';

vi.mock('../src/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/bridge')>()),
  getSettings: () => Promise.resolve({ processingMode: 'ask' }),
  setSetting: () => Promise.resolve(undefined),
  codexStatus: () => Promise.resolve({ installed: false, authenticated: false }),
  codexModels: () => Promise.resolve([]),
  geminiModels: () => Promise.resolve([]),
  grokModels: () => Promise.resolve([]),
}));

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  return i18n.changeLanguage('en');
});

afterEach(cleanup);

const props = {
  hasKey: false,
  hasCompatibleKey: false,
  hasGeminiKey: false,
  hasGrokKey: false,
  onProviderChanged: () => {},
  onOpenAbout: () => {},
  onRunOnboarding: () => {},
};

function renderModal() {
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <SettingsModal {...props} />
      </TooltipProvider>
    </I18nextProvider>,
  );
}

function panels() {
  return Array.from(document.querySelectorAll('[role="tabpanel"]'));
}

/** Realistic tab selection: Radix activates on focus/click in sequence. */
function selectTab(name: string) {
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab);
  (tab as HTMLElement).focus();
  fireEvent.focus(tab);
  fireEvent.click(tab);
  return tab;
}

describe('SettingsModal tabs', () => {
  it('opens on General with both tabs present', async () => {
    renderModal();
    expect(screen.getByRole('tab', { name: 'General' }).getAttribute('data-state')).toBe('active');
    expect(screen.getByRole('tab', { name: 'Connection' })).toBeTruthy();
    // Excision guard: the removed third tab stays gone — General + Connection only.
    expect(screen.queryByRole('tab', { name: 'Auto-pilot' })).toBeNull();
    expect(await screen.findByText('For each BOQ')).toBeTruthy();
  });

  it('switches to the Connection panel on click', async () => {
    renderModal();
    selectTab('Connection');
    expect(await screen.findByText('Not detected on this machine')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Connection' }).getAttribute('data-state')).toBe('active');
    expect(screen.getByRole('combobox', { name: 'AI provider' })).toBeTruthy();
    const active = panels().filter((panel) => panel.getAttribute('data-state') === 'active');
    expect(active).toHaveLength(1);
    expect(within(active[0] as HTMLElement).getByRole('combobox', { name: 'AI provider' })).toBeTruthy();
  });

  it('keeps inactive panels mounted so form state survives switches', async () => {
    renderModal();
    // Provider content is in the DOM even before its tab is selected.
    expect(await screen.findByRole('combobox', { name: 'AI provider' })).toBeTruthy();
    selectTab('General');
    expect(await screen.findByText('For each BOQ')).toBeTruthy();
    // Connection panel is still mounted, just inactive.
    expect(screen.getByRole('combobox', { name: 'AI provider' })).toBeTruthy();
    const active = panels().filter((panel) => panel.getAttribute('data-state') === 'active');
    expect(active).toHaveLength(1);
    // Inactive panels are display:none via data-state (removes the subtree
    // from the accessibility tree and tab order in browsers).
    for (const panel of panels()) {
      if (panel.getAttribute('data-state') !== 'active') {
        expect(panel.className).toContain('data-[state=inactive]:hidden');
      }
    }
  });

  it('keeps the guide/about footer intact', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /view setup guide/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /about/i })).toBeTruthy();
  });
});
