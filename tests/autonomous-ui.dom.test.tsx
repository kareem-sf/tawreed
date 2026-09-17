// @vitest-environment jsdom
//
// Auto-pilot UI contracts: the held-for-review banner must surface machine-clean
// verdict failures (otherwise an unclean auto run waits silently), and the trust
// list must revoke with rollback (a failed revoke must not desync the UI).
import { describe, it, expect, vi, beforeAll, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { TooltipProvider } from '../src/components/ui/tooltip';
import i18n from '../src/i18n';
import ReviewPanel from '../src/features/review/ReviewPanel';
import { AutopilotSetup } from '../src/features/settings/AutopilotSetup';
import type { PipelineData } from '../src/features/workflow/types';
import type { BoqItem, Classification, WorkPackage } from '../shared/types';

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
});

afterEach(cleanup);

beforeEach(() => {
  trustBridge.getAutopilotTrust.mockReset();
  trustBridge.setAutopilotTrust.mockReset();
});

const trustBridge = vi.hoisted(() => ({ getAutopilotTrust: vi.fn(), setAutopilotTrust: vi.fn() }));
vi.mock('../src/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/bridge')>()),
  getAutopilotTrust: (...a: unknown[]) => trustBridge.getAutopilotTrust(...a),
  setAutopilotTrust: (...a: unknown[]) => trustBridge.setAutopilotTrust(...a),
}));

function renderWithProviders(node: React.ReactNode) {
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>{node}</TooltipProvider>
    </I18nextProvider>,
  );
}

function item(id: number): BoqItem {
  return {
    id, code: `A${id}`, description: `Item ${id}`, unit: 'nr',
    qty: 1, rate: 100, total: 100, row: id,
  };
}

const workPackage: WorkPackage = {
  code: 'WP-01', nameEn: 'Concrete', nameAr: 'خرسانة',
  itemIds: [1, 2, 3], totalCost: 300, itemCount: 3,
};

function heldData(): PipelineData {
  const items = [item(1), item(2), item(3)];
  return {
    inspection: {
      fileName: 'boq.xlsx', sourceKind: 'xlsx', projectName: 'Test Tower',
      projectNameConfidence: 1, projectNameCandidates: ['Test Tower'], language: 'en',
      pageCount: 0, ocrPages: 0, annotationCount: 0, rejectedCount: 0,
      sheetName: 'BOQ', headerRow: 1,
      mapping: {
        code: 1, description: 2, unit: 3, qty: 4, rate: 5, total: 6,
        remarks: null, confidence: 1,
      },
      items, warnings: [],
    },
    classifications: items.map((entry): Classification =>
      ({ itemId: entry.id, packageCode: 'WP-01', confidence: 0.9, source: 'llm' })),
    packages: [workPackage],
    packageCatalog: [workPackage],
    issues: [],
    llmUsed: true,
    llmFailed: false,
    aiSkipped: 0,
    provider: 'gemini',
    model: 'gemini-3.7-flash',
    trace: [],
    memoryApplied: 0,
    fileName: 'boq.xlsx',
    fileHash: 'test-hash',
    startedAt: Date.now(),
    autoPilot: { grantedAt: '2026-09-17T10:00:00.000Z' },
    heldReasons: { en: ['1 item(s) have zero quantity'], ar: ['بند بكمية صفرية'] },
  };
}

describe('held-for-review banner', () => {
  it('lists the machine-clean verdict failures with role=status', () => {
    renderWithProviders(
      <ReviewPanel
        data={heldData()}
        busy={false}
        error={null}
        hasErrors={false}
        retryingPublication={false}
        onGenerate={() => {}}
        onReset={() => {}}
        onClassificationChange={() => {}}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('1 item(s) have zero quantity');
  });

  it('stays silent when nothing was held', () => {
    renderWithProviders(
      <ReviewPanel
        data={{ ...heldData(), heldReasons: null }}
        busy={false}
        error={null}
        hasErrors={false}
        retryingPublication={false}
        onGenerate={() => {}}
        onReset={() => {}}
        onClassificationChange={() => {}}
      />,
    );
    expect(screen.queryByText(/held this run/i)).toBeNull();
  });
});

describe('AutopilotSetup trust list', () => {
  const grants = [{ projectKey: 'tower c', projectName: 'Tower C', grantedAt: '2026-09-17T10:00:00.000Z' }];

  it('lists grants and revokes through the bridge', async () => {
    trustBridge.getAutopilotTrust.mockResolvedValue(grants);
    trustBridge.setAutopilotTrust.mockResolvedValue(undefined);
    renderWithProviders(<AutopilotSetup />);
    expect(await screen.findByText('Tower C')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /revoke: tower c/i }));
    // Destructive revoke needs an explicit confirm — the row click only arms it.
    expect(await screen.findByText('Revoke auto-pilot?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Revoke$/ }));
    await waitFor(() => expect(trustBridge.setAutopilotTrust).toHaveBeenCalledWith([]));
  });

  it('cancelling the confirm leaves the grant untouched', async () => {
    trustBridge.getAutopilotTrust.mockResolvedValue(grants);
    trustBridge.setAutopilotTrust.mockResolvedValue(undefined);
    renderWithProviders(<AutopilotSetup />);
    expect(await screen.findByText('Tower C')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /revoke: tower c/i }));
    expect(await screen.findByText('Revoke auto-pilot?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(trustBridge.setAutopilotTrust).not.toHaveBeenCalled();
    expect(screen.getByText('Tower C')).toBeTruthy();
  });

  it('rolls the list back when the revoke write fails', async () => {
    trustBridge.getAutopilotTrust.mockResolvedValue(grants);
    trustBridge.setAutopilotTrust.mockRejectedValue(new Error('locked'));
    renderWithProviders(<AutopilotSetup />);
    expect(await screen.findByText('Tower C')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /revoke: tower c/i }));
    expect(await screen.findByText('Revoke auto-pilot?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Revoke$/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    // Optimistic removal rolled back: the grant is still listed.
    expect(screen.getByText('Tower C')).toBeTruthy();
  });
});
