// @vitest-environment jsdom
//
// Slice-3 guard: the AI consent step renders as a real Radix dialog that
// cannot be dismissed implicitly (ESC/backdrop/X) — the choice must be
// explicit via the two action buttons.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../src/i18n';
import type { BootstrapInfo } from '../src/bridge';
import {
  WorkflowWorkspace,
  consentProviderName,
} from '../src/features/workflow/components/WorkflowWorkspace';
import { initialWorkflowState, type WorkflowState } from '../src/features/workflow/types';
import type { InspectionResult } from '../shared/types';

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

const boot = {
  first_run: false,
  onboarding_required: false,
  data_dir: '/tmp/tawreed',
  has_api_key: false,
  has_compatible_key: false,
  has_gemini_key: false,
  has_grok_key: false,
  run_count: 1,
  version: 'test',
  provider: 'none',
  codex_installed: false,
  codex_authenticated: false,
} as unknown as BootstrapInfo;

const inspection: InspectionResult = {
  fileName: 'boq.xlsx',
  sourceKind: 'xlsx',
  projectName: 'Test Tower',
  projectNameConfidence: 1,
  projectNameCandidates: ['Test Tower'],
  language: 'en',
  pageCount: 0,
  ocrPages: 0,
  annotationCount: 0,
  rejectedCount: 0,
  sheetName: 'BOQ',
  headerRow: 1,
  mapping: { code: 0, description: 1, unit: null, qty: null, rate: null, total: null, remarks: null, confidence: 1 },
  items: [],
  warnings: [],
};

function consentState(): WorkflowState {
  return {
    ...initialWorkflowState,
    view: 'consent',
    pendingInspection: { inspection, fileName: 'boq.xlsx', fileHash: 'x', startedAt: 0, trace: [] },
  };
}

function renderConsent(onConsent: (allow: boolean) => void) {
  const handlers = {
    onFile: () => undefined,
    onConsent,
    onCancel: () => undefined,
    onGenerate: () => undefined,
    onReset: () => undefined,
    onClassificationChange: () => undefined,
  };
  return render(
    <I18nextProvider i18n={i18n}>
      <WorkflowWorkspace boot={boot} state={consentState()} {...handlers} />
    </I18nextProvider>,
  );
}

describe('consent dialog', () => {
  it('renders as a modal dialog with exactly the two choice buttons', () => {
    renderConsent(() => undefined);
    const dialog = screen.getByRole('dialog');
    const buttons = within(dialog).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(within(dialog).getByRole('button', { name: i18n.t('stayOffline') })).not.toBeNull();
    expect(within(dialog).getByRole('button', { name: i18n.t('improvePackages') })).not.toBeNull();
  });

  it('reports the explicit choice through onConsent', () => {
    const seen: boolean[] = [];
    renderConsent((allow) => seen.push(allow));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('improvePackages') }));
    expect(seen).toEqual([true]);
  });

  it('ignores ESC instead of choosing silently', () => {
    const seen: boolean[] = [];
    renderConsent((allow) => seen.push(allow));
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    expect(seen).toEqual([]);
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('keeps the provider-name helper intact', () => {
    expect(consentProviderName('codex', (key: string) => key)).toBe('Codex');
  });
});
