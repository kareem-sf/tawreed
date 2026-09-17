// @vitest-environment jsdom
//
// Slice-5 guard: the history table rewrite preserves the three states
// (rows, empty, load error) and the per-row workbook action.
import { describe, it, expect, vi, beforeAll, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { TooltipProvider } from '../src/components/ui/tooltip';
import i18n from '../src/i18n';
import HistoryDrawer from '../src/features/history/HistoryDrawer';
import type { RunRecord } from '../shared/types';

const historyBridge = vi.hoisted(() => ({ listRuns: vi.fn(), getAutopilotTrust: vi.fn() }));
vi.mock('../src/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/bridge')>()),
  listRuns: (...a: unknown[]) => historyBridge.listRuns(...a),
  getAutopilotTrust: (...a: unknown[]) => historyBridge.getAutopilotTrust(...a),
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
  window.scrollTo ??= (() => {}) as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView ??= () => {};
  return i18n.changeLanguage('en');
});

beforeEach(() => {
  historyBridge.listRuns.mockReset();
  historyBridge.getAutopilotTrust.mockReset();
  historyBridge.getAutopilotTrust.mockResolvedValue([]);
});

afterEach(cleanup);

const run: RunRecord = {
  id: 7,
  startedAt: new Date('2026-09-10T10:00:00.000Z').toISOString(),
  fileName: 'boq.xlsx',
  fileHash: 'hash',
  itemCount: 3,
  packageCount: 2,
  errorCount: 0,
  warningCount: 0,
  outputFile: 'C:\\runs\\master.xlsx',
  durationMs: 1200,
  llmUsed: false,
  projectName: 'Tower C',
  revision: 3,
};

function renderDrawer() {
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <HistoryDrawer opened />
      </TooltipProvider>
    </I18nextProvider>,
  );
}

describe('HistoryDrawer', () => {
  it('shows skeleton rows while loading', () => {
    historyBridge.listRuns.mockReturnValue(new Promise(() => {}));
    renderDrawer();
    expect(screen.getByRole('status', { name: i18n.t('loading') })).not.toBeNull();
  });

  it('lists runs with their result and workbook action', async () => {
    historyBridge.listRuns.mockResolvedValue([run]);
    renderDrawer();
    expect(await screen.findByText('Tower C')).toBeTruthy();
    expect(screen.getByText('3 → 2')).not.toBeNull();
    expect(screen.getByRole('button', { name: i18n.t('openWorkbook') })).not.toBeNull();
  });

  it('shows the empty state when there are no runs', async () => {
    historyBridge.listRuns.mockResolvedValue([]);
    renderDrawer();
    expect(await screen.findByText(i18n.t('emptyHistory'))).toBeTruthy();
  });

  it('announces load failures as an alert', async () => {
    historyBridge.listRuns.mockRejectedValue(new Error('locked'));
    renderDrawer();
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
