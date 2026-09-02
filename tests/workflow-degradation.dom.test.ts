// @vitest-environment jsdom
//
// A failed classification batch does not abort the run: its items come back Unclassified
// and the workbook still generates. The hook therefore has to say how much of the run the
// AI actually did — a boolean "did any item reach the AI" reported a mostly-failed run as
// a success, which is how ungrouped items reach a buyer unnoticed.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { BoqItem, Classification, ClassifySource } from '../shared/types';

const bootstrap = {
  first_run: false, onboarding_required: false, onboarding_step: 'complete' as const,
  data_dir: '/tmp', has_api_key: true, has_compatible_key: false,
  has_gemini_key: true, has_grok_key: false, run_count: 0, version: 'test',
  provider: 'gemini' as const, provider_preference: 'gemini' as const,
  codex_installed: false, codex_authenticated: false,
};

function items(count: number): BoqItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1, code: `A${i + 1}`, description: `Item ${i + 1}`, unit: 'nr' as const,
    qty: 1, rate: 100, total: 100, row: i + 1,
  }));
}

const inspection = {
  fileName: 'boq.xlsx', sourceKind: 'xlsx', projectName: 'Test Tower',
  projectNameConfidence: 1, projectNameCandidates: ['Test Tower'], language: 'en',
  pageCount: 0, ocrPages: 0, annotationCount: 0, rejectedCount: 0,
  sheetName: 'BOQ', headerRow: 1,
  mapping: { code: 1, description: 2, unit: 3, qty: 4, rate: 5, total: 6, remarks: null, confidence: 1 },
  items: items(4), warnings: [],
};

/** Classifications with the first `skipped` items never reaching the AI. */
function plan(skipped: number, fallbackSource: ClassifySource = 'fallback') {
  const classifications: Classification[] = items(4).map((item, index) => ({
    itemId: item.id,
    packageCode: index < skipped ? 'WP-99' : 'WP-01',
    confidence: index < skipped ? 0 : 0.9,
    source: index < skipped ? fallbackSource : 'llm',
  }));
  return {
    classifications,
    catalog: [{ code: 'WP-01', nameEn: 'Concrete', nameAr: 'خرسانة', keywords: [] }],
  };
}

const classifyPlan = vi.fn();

vi.mock('../src/bridge', () => ({
  appLog: vi.fn(), discardRevision: vi.fn(), getSettings: vi.fn().mockResolvedValue({}),
  listClassificationMemory: vi.fn().mockResolvedValue([]),
  makeCodexTransport: () => vi.fn(), makeCompatibleTransport: () => vi.fn(),
  makeGeminiTransport: () => vi.fn(), makeGrokTransport: () => vi.fn(),
  makeLlmTransport: () => vi.fn(),
  openWorkbook: vi.fn(), recordRun: vi.fn(), reserveRevision: vi.fn(),
  saveClassificationMemory: vi.fn(), sha256Hex: vi.fn().mockResolvedValue('abc'),
  writeRevisionBundle: vi.fn(),
}));
vi.mock('../src/boq-worker', () => ({
  // The real worker hands back a cancellable job, not a bare promise.
  inspectInWorker: () => ({ promise: Promise.resolve(inspection), cancel: () => {} }),
  generateInWorker: vi.fn(),
  WorkerCancelledError: class extends Error {},
}));
vi.mock('../engine/classify', () => ({ classifyPlan: (...a: unknown[]) => classifyPlan(...a) }));
vi.mock('../engine/document-agent', () => ({
  refineInspectionWithAgent: vi.fn().mockResolvedValue(inspection),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const { useBoqWorkflow } = await import('../src/features/workflow/useBoqWorkflow');

/** Drives upload → consent → review and returns the review payload. Offline is spelled
 * "none" on the wire, and it skips the consent gate entirely. */
async function runToReview(provider: 'gemini' | 'none') {
  const { result } = renderHook(() => useBoqWorkflow({
    boot: { ...bootstrap, provider },
    modelSlug: 'gemini-3.7-flash',
    processingMode: 'ask',
  }));

  await act(async () => {
    await result.current.handleFile(new File(['x'], 'boq.xlsx'));
  });
  if (result.current.state.view === 'consent') {
    await act(async () => {
      result.current.analyzePending(true);
    });
  }
  await waitFor(() => expect(result.current.state.view).toBe('review'));
  return result.current.state.data!;
}

beforeEach(() => {
  classifyPlan.mockReset();
});

describe('useBoqWorkflow — how much of the run the AI actually did', () => {
  it('counts the items a failed batch left behind rather than reporting success', async () => {
    classifyPlan.mockResolvedValue(plan(3));
    const data = await runToReview('gemini');

    expect(data.aiSkipped).toBe(3);
    // One batch did succeed, so this is a partial failure, not a total one.
    expect(data.llmFailed).toBe(false);
  });

  it('reports a clean run as fully classified', async () => {
    classifyPlan.mockResolvedValue(plan(0));
    const data = await runToReview('gemini');

    expect(data.aiSkipped).toBe(0);
    expect(data.llmFailed).toBe(false);
    expect(data.llmUsed).toBe(true);
  });

  it('treats a run that reached the AI for nothing as a failure', async () => {
    classifyPlan.mockResolvedValue(plan(4));
    const data = await runToReview('gemini');

    expect(data.aiSkipped).toBe(4);
    expect(data.llmFailed).toBe(true);
    expect(data.llmUsed).toBe(false);
  });

  it('catches a silent full degradation to the offline heuristic', async () => {
    // proposeStructure failing drops llmClassify to keyword matching, which is not a
    // fallback source — counting only 'fallback' would have called this a success.
    classifyPlan.mockResolvedValue(plan(4, 'heuristic'));
    const data = await runToReview('gemini');

    expect(data.aiSkipped).toBe(4);
    expect(data.llmFailed).toBe(true);
  });

  it('does not accuse the offline provider of skipping anything', async () => {
    classifyPlan.mockResolvedValue(plan(4, 'heuristic'));
    const data = await runToReview('none');

    expect(data.aiSkipped).toBe(0);
    expect(data.llmFailed).toBe(false);
  });
});
