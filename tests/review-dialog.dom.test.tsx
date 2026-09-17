// @vitest-environment jsdom
//
// Slice-4 guard: the review-items dialog opens from the panel, carries its
// translated title and pagination, and closes through the Radix
// open-change mapping (X, ESC, backdrop all funnel to onClose).
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../src/i18n';
import ReviewPanel from '../src/features/review/ReviewPanel';
import type { PipelineData } from '../src/features/workflow/types';
import type { BoqItem } from '../shared/types';

vi.mock('@tauri-apps/api/core', () => ({ invoke: () => Promise.reject(new Error('no backend')) }));

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

afterEach(cleanup);

function item(id: number): BoqItem {
  return {
    id, code: `A${id}`, description: `Item ${id}`, unit: 'nr',
    qty: 1, rate: 100, total: 100, row: id,
  };
}

const items = [item(1), item(2)];

const data: PipelineData = {
  inspection: {
    fileName: 'boq.xlsx', sourceKind: 'xlsx', projectName: 'Test Tower',
    projectNameConfidence: 1, projectNameCandidates: ['Test Tower'], language: 'en',
    pageCount: 0, ocrPages: 0, annotationCount: 0, rejectedCount: 0,
    sheetName: 'BOQ', headerRow: 1,
    mapping: { code: 1, description: 2, unit: 3, qty: 4, rate: 5, total: 6, remarks: null, confidence: 1 },
    items, warnings: [],
  },
  classifications: items.map((entry) => ({
    itemId: entry.id, packageCode: 'WP-01', confidence: 0.9, source: 'llm' as const,
  })),
  packages: [{ code: 'WP-01', nameEn: 'Concrete', nameAr: 'خرسانة', itemIds: [1, 2], totalCost: 300, itemCount: 2 }],
  packageCatalog: [{ code: 'WP-01', nameEn: 'Concrete', nameAr: 'خرسانة', itemIds: [1, 2], totalCost: 300, itemCount: 2 }],
  issues: [],
  llmUsed: true,
  llmFailed: false,
  aiSkipped: 0,
  provider: 'codex',
  model: '',
  trace: [],
  memoryApplied: 0,
  fileName: 'boq.xlsx',
  fileHash: 'test-hash',
  startedAt: Date.now(),
  autoPilot: null,
  heldReasons: null,
};

function renderPanel() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ReviewPanel
        data={data}
        busy={false}
        error={null}
        hasErrors={false}
        retryingPublication={false}
        onGenerate={() => {}}
        onReset={() => {}}
        onClassificationChange={() => {}}
      />
    </I18nextProvider>,
  );
}

describe('review items dialog', () => {
  it('opens with title, headers and pagination, and closes via its close button', () => {
    renderPanel();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('reviewItems') }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain(i18n.t('reviewItemsTitle'));
    expect(dialog.textContent).toContain(i18n.t('pageCount', { page: 1, pages: 1 }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('close') }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on ESC through the open-change mapping', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('reviewItems') }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
