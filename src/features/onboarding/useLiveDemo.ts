import { useEffect, useReducer } from 'react';
import type { RevisionOutput } from '../../bridge';
import { reviseClassification, workflowEvent } from '../../../engine/agent-workflow';
import { classifyPlan } from '../../../engine/classify';
import { inspectDocument } from '../../../engine/inspect-document';
import { buildPackages, validate } from '../../../engine/validate';
import type { WorkPackage } from '../../../shared/types';
import { workflowReducer } from '../workflow/reducer';
import { initialWorkflowState, type PipelineData } from '../workflow/types';

const DEMO_FILE = '/onboarding/demo-boq.csv';

function emptyPackage(code: string, nameEn: string, nameAr: string): WorkPackage {
  return { code, nameEn, nameAr, itemIds: [], totalCost: 0, itemCount: 0 };
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  });
}

/**
 * Drives the real production workflow state machine end-to-end against a bundled
 * sample BOQ, so the onboarding tour renders the actual app instead of a fake video.
 * Never touches the filesystem or OS: the "publish" step is faked with a synthetic
 * RevisionOutput rather than calling reserveRevision/writeRevisionBundle/openWorkbook.
 */
export function useLiveDemo(active: boolean, runId: number) {
  const [state, dispatch] = useReducer(workflowReducer, initialWorkflowState);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const { signal } = controller;

    const run = async () => {
      dispatch({ type: 'reset' });
      await delay(500, signal);

      dispatch({ type: 'startBusy', message: 'Reading demo-boq.csv…', progress: null });
      const response = await fetch(DEMO_FILE, { signal });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const trace = [workflowEvent('inspect', 'started', 'Local document inspection started')];
      const startedAt = Date.now();
      const inspection = await inspectDocument(bytes, 'demo-boq.csv');
      trace.push(workflowEvent(
        'inspect',
        'completed',
        `${inspection.items.length} source-backed items extracted locally`,
      ));

      dispatch({ type: 'setBusy', message: 'Classifying items…', progress: null });
      await delay(500, signal);
      const plan = await classifyPlan(inspection.items, { useLlm: false });
      trace.push(workflowEvent('classify', 'completed', `${inspection.items.length} items classified`));

      const packages = buildPackages(inspection.items, plan.classifications);
      const packageCatalog = plan.catalog.map((definition) =>
        packages.find((workPackage) => workPackage.code === definition.code)
          ?? emptyPackage(definition.code, definition.nameEn, definition.nameAr));
      for (const workPackage of packages) {
        if (!packageCatalog.some((candidate) => candidate.code === workPackage.code)) {
          packageCatalog.push(workPackage);
        }
      }
      const issues = validate(inspection.items, plan.classifications, packages);
      trace.push(workflowEvent('validate', 'completed', `${issues.length} validation findings`));

      let data: PipelineData = {
        inspection,
        classifications: plan.classifications,
        packages,
        packageCatalog,
        issues,
        llmUsed: false,
        llmFailed: false,
        aiSkipped: 0,
        provider: 'offline',
        model: '',
        trace,
        memoryApplied: 0,
        fileName: 'demo-boq.csv',
        bytes,
        startedAt,
      };
      dispatch({ type: 'showReview', data });
      await delay(1000, signal);

      const firstItem = inspection.items[0];
      const otherPackage = packageCatalog.find((candidate) => candidate.itemIds[0] !== firstItem?.id)
        ?? packageCatalog[0];
      if (firstItem && otherPackage) {
        const classifications = reviseClassification(data.classifications, firstItem.id, otherPackage);
        const revisedPackages = buildPackages(inspection.items, classifications);
        const revisedIssues = validate(inspection.items, classifications, revisedPackages);
        data = { ...data, classifications, packages: revisedPackages, issues: revisedIssues };
        dispatch({ type: 'updateData', data });
        await delay(700, signal);
      }

      dispatch({ type: 'setGenerating', value: true });
      dispatch({ type: 'startBusy', message: 'Building workbook…', progress: null });
      await delay(600, signal);
      const completedTrace = [
        ...data.trace,
        workflowEvent('human-review', 'completed', 'Demo approved item classifications'),
        workflowEvent('generate', 'completed', 'Workbook artifacts built'),
        workflowEvent('publish', 'completed', 'Rev-1 published'),
      ];
      const output: RevisionOutput = {
        projectName: inspection.projectName || 'Terminal Expansion',
        revision: 1,
        revisionLabel: 'Rev-1',
        masterPath: `${inspection.projectName || 'Terminal Expansion'}/Rev-1/master.xlsx`,
        packageFolder: `${inspection.projectName || 'Terminal Expansion'}/Rev-1/packages`,
        revisionFolder: `${inspection.projectName || 'Terminal Expansion'}/Rev-1`,
        files: ['master.xlsx'],
      };
      dispatch({ type: 'setGenerating', value: false });
      dispatch({ type: 'showDone', output, data: { ...data, trace: completedTrace } });
      await delay(1500, signal);

      dispatch({ type: 'reset' });
    };

    void run().catch((reason) => {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      dispatch({ type: 'setError', error: reason instanceof Error ? reason.message : String(reason) });
    });

    return () => controller.abort();
  }, [active, runId]);

  return state;
}
