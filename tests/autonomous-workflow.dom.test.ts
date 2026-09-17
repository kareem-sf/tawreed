// @vitest-environment jsdom
//
// Auto-pilot hook flow: a trusted project skips consent and publishes on a
// machine-clean verdict; unclean or revoked runs land in review with reasons.
// The bridge is mocked at the seam (same style as workflow-degradation.dom.test.ts);
// the reducer, verdict, memory-key, and validation logic under test are real.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { BoqItem, Classification } from '../shared/types';

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

function cleanPlan() {
  const classifications: Classification[] = items(4).map((item) => ({
    itemId: item.id, packageCode: 'WP-01', confidence: 0.9, source: 'llm' as const,
  }));
  return {
    classifications,
    catalog: [{ code: 'WP-01', nameEn: 'Concrete', nameAr: 'خرسانة', keywords: [] as string[] }],
  };
}

const grant = { projectKey: 'test tower', projectName: 'Test Tower', grantedAt: '2026-09-17T10:00:00.000Z' };
const reservation = { projectName: 'Test Tower', revision: 1, revisionLabel: 'Rev 01', session: '.tawreed-rev-01-1-1.tmp' };
const published = {
  projectName: 'Test Tower', revision: 1, revisionLabel: 'Rev 01',
  masterPath: '/out/master.xlsx', packageFolder: '/out/Packages',
  revisionFolder: '/out', files: ['/out/master.xlsx'],
};

const bridge = vi.hoisted(() => ({
  getAutopilotTrust: vi.fn(),
  writeRevisionBundle: vi.fn(),
  generateInWorker: vi.fn(),
  appLog: vi.fn(),
}));

vi.mock('../src/bridge', () => ({
  appLog: (...a: unknown[]) => (bridge.appLog as (...x: unknown[]) => unknown)(...a),
  discardRevision: vi.fn().mockResolvedValue(undefined),
  getSettings: vi.fn().mockResolvedValue({}),
  getAutopilotTrust: bridge.getAutopilotTrust,
  findAutopilotGrant: (grants: { projectKey: string }[], key: string) =>
    grants.find((g) => g.projectKey === key) ?? null,
  listClassificationMemory: vi.fn().mockResolvedValue([]),
  makeCodexTransport: () => vi.fn(), makeCompatibleTransport: () => vi.fn(),
  makeGeminiTransport: () => vi.fn(), makeGrokTransport: () => vi.fn(),
  makeLlmTransport: () => vi.fn(),
  openWorkbook: vi.fn().mockResolvedValue(undefined),
  recordRun: vi.fn().mockResolvedValue(1),
  reserveRevision: vi.fn().mockResolvedValue(reservation),
  saveClassificationMemory: vi.fn().mockResolvedValue(0),
  sha256Hex: vi.fn().mockResolvedValue('abc'),
  writeRevisionBundle: bridge.writeRevisionBundle,
}));
vi.mock('../src/boq-worker', () => ({
  inspectInWorker: () => ({ promise: Promise.resolve(inspection), cancel: () => {} }),
  generateInWorker: (...a: unknown[]) => (bridge.generateInWorker as (...x: unknown[]) => unknown)(...a),
  WorkerCancelledError: class extends Error {},
}));
const classifyPlan = vi.fn();
vi.mock('../engine/classify', () => ({ classifyPlan: (...a: unknown[]) => classifyPlan(...a) }));
vi.mock('../engine/document-agent', () => ({
  refineInspectionWithAgent: vi.fn().mockResolvedValue(inspection),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const { useBoqWorkflow } = await import('../src/features/workflow/useBoqWorkflow');

function renderWorkflow() {
  return renderHook(() => useBoqWorkflow({
    boot: { ...bootstrap },
    modelSlug: 'gemini-3.7-flash',
    processingMode: 'ask',
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  classifyPlan.mockResolvedValue(cleanPlan());
  bridge.getAutopilotTrust.mockResolvedValue([]);
  bridge.writeRevisionBundle.mockResolvedValue(published);
  bridge.generateInWorker.mockReturnValue({
    promise: Promise.resolve([{ kind: 'master', fileName: 'm.xlsx', relativePath: 'm.xlsx', bytes: new Uint8Array() }]),
    cancel: () => {},
  });
});

describe('auto-pilot hook flow', () => {
  it('publishes a trusted clean run with no consent step', async () => {
    bridge.getAutopilotTrust.mockResolvedValue([grant]);
    const { result } = renderWorkflow();
    await act(async () => {
      await result.current.handleFile(new File(['x'], 'boq.xlsx'));
    });
    await waitFor(() => expect(result.current.state.view).toBe('done'));
    expect(bridge.writeRevisionBundle).toHaveBeenCalledTimes(1);
    expect(result.current.state.data!.autoPilot).toMatchObject({ grantedAt: grant.grantedAt });
    expect(result.current.state.output!.masterPath).toBe('/out/master.xlsx');
  });

  it('keeps the consent step for untrusted projects', async () => {
    const { result } = renderWorkflow();
    await act(async () => {
      await result.current.handleFile(new File(['x'], 'boq.xlsx'));
    });
    expect(result.current.state.view).toBe('consent');
    expect(bridge.writeRevisionBundle).not.toHaveBeenCalled();
  });

  it('holds for human review when the grant is revoked mid-flight', async () => {
    bridge.getAutopilotTrust
      .mockResolvedValueOnce([grant]) // handleFile trust check
      .mockResolvedValue([]); // generate re-check: revoked
    const { result } = renderWorkflow();
    await act(async () => {
      await result.current.handleFile(new File(['x'], 'boq.xlsx'));
    });
    await waitFor(() => expect(result.current.state.view).toBe('review'));
    expect(bridge.writeRevisionBundle).not.toHaveBeenCalled();
    expect(result.current.state.data!.heldReasons!.en.join(' ')).toMatch(/revoked/i);
  });

  it('holds for human review on an unclean verdict', async () => {
    bridge.getAutopilotTrust.mockResolvedValue([grant]);
    classifyPlan.mockResolvedValue({
      ...cleanPlan(),
      classifications: cleanPlan().classifications.map((c, i) =>
        i === 0 ? { ...c, packageCode: 'WP-99', confidence: 0, source: 'fallback' as const } : c),
    });
    const { result } = renderWorkflow();
    await act(async () => {
      await result.current.handleFile(new File(['x'], 'boq.xlsx'));
    });
    await waitFor(() => expect(result.current.state.view).toBe('review'));
    expect(bridge.writeRevisionBundle).not.toHaveBeenCalled();
    expect(result.current.state.data!.heldReasons).not.toBeNull();
  });
});
