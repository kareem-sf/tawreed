import { describe, expect, it } from 'vitest';
import type { InspectionResult, WorkPackage } from '../shared/types';
import type { PipelineData } from '../src/features/workflow/types';
import { initialWorkflowState } from '../src/features/workflow/types';
import { workflowReducer } from '../src/features/workflow/reducer';

function inspection(): InspectionResult {
  return {
    fileName: 'sample.xlsx',
    sourceKind: 'xlsx',
    projectName: 'Sample project',
    projectNameConfidence: 1,
    projectNameCandidates: ['Sample project'],
    language: 'en',
    pageCount: 0,
    ocrPages: 0,
    annotationCount: 0,
    rejectedCount: 0,
    sheetName: 'BOQ',
    headerRow: 1,
    mapping: {
      code: 1,
      description: 2,
      unit: 3,
      qty: 4,
      rate: 5,
      total: 6,
      remarks: null,
      confidence: 1,
    },
    items: [],
    warnings: [],
  };
}

function data(): PipelineData {
  const workPackage: WorkPackage = {
    code: 'WP-01',
    nameEn: 'Civil',
    nameAr: 'مدني',
    itemIds: [],
    totalCost: 0,
    itemCount: 0,
  };
  return {
    inspection: inspection(),
    classifications: [],
    packages: [workPackage],
    packageCatalog: [workPackage],
    issues: [],
    llmUsed: false,
    llmFailed: false,
    aiSkipped: 0,
    provider: 'offline',
    model: '',
    trace: [],
    memoryApplied: 0,
    fileName: 'sample.xlsx',
    fileHash: 'test-hash',
    startedAt: 1,
  };
}

describe('workflowReducer', () => {
  it('starts and updates cancellable busy work', () => {
    const busy = workflowReducer(initialWorkflowState, {
      type: 'startBusy',
      message: 'Parsing',
      progress: 25,
    });
    const cancellable = workflowReducer(busy, { type: 'setCancellable', value: true });
    expect(cancellable).toMatchObject({
      view: 'busy',
      busyMessage: 'Parsing',
      busyProgress: 25,
      cancellable: true,
      error: null,
    });
  });

  it('keeps reserved publication data available for a safe retry', () => {
    const reviewData = data();
    const busy = workflowReducer(initialWorkflowState, { type: 'startBusy', message: 'Parsing' });
    const review = workflowReducer(busy, { type: 'showReview', data: reviewData });
    const pending = {
      reservation: {
        projectName: 'Sample project',
        revision: 1,
        revisionLabel: 'Rev 01',
        session: 'session-1',
      },
      artifacts: [],
    };
    const retryable = workflowReducer(review, { type: 'setPendingPublication', pending });
    const restoredReview = workflowReducer(retryable, { type: 'showReview', data: reviewData });
    expect(restoredReview.pendingPublication).toEqual(pending);
    expect(restoredReview.view).toBe('review');
  });

  it('clears transient state after a completed publication', () => {
    const reviewData = data();
    const output = {
      projectName: 'Sample project',
      revision: 1,
      revisionLabel: 'Rev 01',
      masterPath: '/tmp/master.xlsx',
      packageFolder: '/tmp/rev-01',
      revisionFolder: '/tmp/rev-01',
      files: ['/tmp/master.xlsx'],
    };
    const done = workflowReducer(
      { ...initialWorkflowState, view: 'review', data: reviewData, pendingPublication: {
        reservation: {
          projectName: 'Sample project',
          revision: 1,
          revisionLabel: 'Rev 01',
          session: 'session-1',
        },
        artifacts: [],
      } },
      { type: 'showDone', output, data: reviewData },
    );
    expect(done).toMatchObject({
      view: 'done',
      output,
      pendingPublication: null,
      cancellable: false,
      error: null,
    });
  });

  it('returns to a clean idle state on reset', () => {
    const reset = workflowReducer(
      { ...initialWorkflowState, view: 'busy', error: 'failed', cancellable: true },
      { type: 'reset' },
    );
    expect(reset).toEqual(initialWorkflowState);
  });

  it('ignores illegal transitions (stale async cannot resurrect state)', () => {
    const reviewData = data();
    // showReview from idle/done is a no-op
    expect(workflowReducer(initialWorkflowState, { type: 'showReview', data: reviewData }).view).toBe('idle');
    const busy = workflowReducer(initialWorkflowState, { type: 'startBusy', message: 'x' });
    const done = workflowReducer(
      { ...busy, view: 'review', data: reviewData },
      { type: 'showDone', output: { projectName: 'p', revision: 1, revisionLabel: 'Rev 01', masterPath: '/m', packageFolder: '/f', revisionFolder: '/f', files: [] }, data: reviewData },
    );
    expect(workflowReducer(done, { type: 'showReview', data: reviewData }).view).toBe('done');
    // requestConsent only from busy
    expect(workflowReducer(initialWorkflowState, {
      type: 'requestConsent',
      pending: { inspection: inspection(), fileName: 'f', fileHash: 'test-hash', startedAt: 1, trace: [] },
    }).view).toBe('idle');
    // updateData with no data is a no-op
    expect(workflowReducer(initialWorkflowState, { type: 'updateData', data: reviewData }).data).toBeNull();
    // setBusy outside busy is a no-op
    expect(workflowReducer(initialWorkflowState, { type: 'setBusy', message: 'x' }).busyMessage).toBe('');
  });
});
