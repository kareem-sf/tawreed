// @vitest-environment jsdom
//
// A failed classification batch does not stop the run: its items come back Unclassified
// and the workbook still generates. The only thing standing between that and a buyer
// acting on silently-ungrouped items is this banner, so it is worth a test.
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { I18nextProvider } from 'react-i18next';
import { afterEach } from 'vitest';
import i18n from '../src/i18n';
import ReviewPanel from '../src/features/review/ReviewPanel';
import type { PipelineData } from '../src/features/workflow/types';
import type { BoqItem, Classification, WorkPackage } from '../shared/types';

beforeAll(() => {
  // Mantine and motion probe APIs jsdom does not implement.
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

function item(id: number): BoqItem {
  return {
    id, code: `A${id}`, description: `Item ${id}`, unit: 'nr',
    qty: 1, rate: 100, total: 100, row: id,
  };
}

function classification(id: number, source: Classification['source']): Classification {
  return { itemId: id, packageCode: 'WP-01', confidence: 0.9, source };
}

const workPackage: WorkPackage = {
  code: 'WP-01', nameEn: 'Concrete', nameAr: 'خرسانة',
  itemIds: [1, 2, 3], totalCost: 300, itemCount: 3,
};

function pipelineData(aiSkipped: number): PipelineData {
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
    classifications: items.map((entry, index) =>
      classification(entry.id, index < aiSkipped ? 'fallback' : 'llm')),
    packages: [workPackage],
    packageCatalog: [workPackage],
    issues: [],
    llmUsed: true,
    llmFailed: false,
    aiSkipped,
    provider: 'gemini',
    model: 'gemini-3.7-flash',
    trace: [],
    memoryApplied: 0,
    fileName: 'boq.xlsx',
    bytes: new Uint8Array(),
    startedAt: Date.now(),
  };
}

function renderPanel(aiSkipped: number) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MantineProvider>
        <ReviewPanel
          data={pipelineData(aiSkipped)}
          busy={false}
          error={null}
          hasErrors={false}
          retryingPublication={false}
          onGenerate={() => {}}
          onReset={() => {}}
          onClassificationChange={() => {}}
        />
      </MantineProvider>
    </I18nextProvider>,
  );
}

describe('ReviewPanel — incomplete AI classification', () => {
  it('warns, with counts, when the AI left items ungrouped', () => {
    renderPanel(2);
    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain('2 of 3');
    expect(banner.textContent).toMatch(/did not finish/i);
  });

  it('stays silent when every item was classified by the AI', () => {
    renderPanel(0);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
