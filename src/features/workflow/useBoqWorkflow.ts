import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  appLog,
  discardRevision,
  getSettings,
  listClassificationMemory,
  makeCodexTransport,
  makeCompatibleTransport,
  makeGeminiTransport,
  makeGrokTransport,
  makeLlmTransport,
  sha256Hex,
  type BootstrapInfo,
} from '../../bridge';
import { DEFAULT_MODEL } from '../../../engine/classify/llm';
import {
  applyClassificationMemory,
  reviseClassification,
  workflowEvent,
} from '../../../engine/agent-workflow';
import { buildPackages, validate } from '../../../engine/validate';
import type { AiProvider, WorkPackage } from '../../../shared/types';
import { inspectInWorker } from '../../boq-worker';
import { errorMessage, friendlyErrorMessage, isCancellation } from './errors';
import { workflowReducer } from './reducer';
import { initialWorkflowState, type PendingInspection, type PipelineData } from './types';
import { useGenerateRevision } from './useGenerateRevision';

export type ProcessingMode = 'ask' | 'online' | 'offline';

interface UseBoqWorkflowOptions {
  boot: BootstrapInfo | null;
  modelSlug: string | null;
  processingMode: ProcessingMode;
}

async function providerModel(provider: AiProvider, modelSlug: string | null): Promise<string> {
  if (provider === 'codex') return modelSlug ?? '';
  if (provider === 'anthropic') return DEFAULT_MODEL;
  if (provider === 'compatible') {
    const settings = await getSettings();
    const compatible = settings.compatible;
    const model = compatible && typeof compatible === 'object'
      ? (compatible as Record<string, unknown>).model
      : null;
    return typeof model === 'string' && model ? model : 'configured service';
  }
  if (provider === 'gemini' || provider === 'grok') {
    const settings = await getSettings();
    const named = settings[provider];
    const model = named && typeof named === 'object'
      ? (named as Record<string, unknown>).model
      : null;
    return typeof model === 'string' && model ? model : '';
  }
  return '';
}

function emptyPackage(code: string, nameEn: string, nameAr: string): WorkPackage {
  return { code, nameEn, nameAr, itemIds: [], totalCost: 0, itemCount: 0 };
}

export function useBoqWorkflow({ boot, modelSlug, processingMode }: UseBoqWorkflowOptions) {
  const { t, i18n } = useTranslation();
  const [state, dispatch] = useReducer(workflowReducer, initialWorkflowState);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const generatingRef = useRef(false);
  const cancelJobRef = useRef<(() => void) | null>(null);
  const runIdRef = useRef(0);

  const clearCancellation = useCallback(() => {
    cancelJobRef.current = null;
    dispatch({ type: 'setCancellable', value: false });
  }, []);

  const reset = useCallback(() => {
    runIdRef.current++;
    cancelJobRef.current?.();
    const pending = stateRef.current.pendingPublication;
    if (pending) void discardRevision(pending.reservation).catch(() => undefined);
    cancelJobRef.current = null;
    dispatch({ type: 'reset' });
  }, []);

  const cancel = useCallback(() => {
    cancelJobRef.current?.();
  }, []);

  const analyze = useCallback(async (
    pending: PendingInspection,
    allowAi: boolean,
  ): Promise<PipelineData | null> => {
    const runId = runIdRef.current;
    dispatch({ type: 'startBusy' });
    const resolvedProvider = allowAi && boot?.provider !== 'none' ? boot?.provider : 'offline';
    const provider: AiProvider = resolvedProvider ?? 'offline';
    const model = await providerModel(provider, modelSlug);
    const controller = new AbortController();
    if (provider !== 'offline') {
      cancelJobRef.current = () => controller.abort();
      dispatch({ type: 'setCancellable', value: true });
    }
    const trace = [...pending.trace, workflowEvent(
      'consent',
      'completed',
      provider === 'offline'
        ? 'Local-only processing selected'
        : `User approved ${provider} for this document`,
    )];

    try {
      const [{ classifyPlan }, { refineInspectionWithAgent }] = await Promise.all([
        import('../../../engine/classify'),
        import('../../../engine/document-agent'),
      ]);
      const transport = provider === 'codex'
        ? makeCodexTransport(modelSlug, controller.signal)
        : provider === 'compatible'
          ? makeCompatibleTransport(controller.signal)
          : provider === 'gemini'
            ? makeGeminiTransport(controller.signal)
            : provider === 'grok'
              ? makeGrokTransport(controller.signal)
              : makeLlmTransport(controller.signal);
      let inspection = pending.inspection;
      let llmFailed = false;

      if (provider !== 'offline') {
        dispatch({ type: 'setBusy', message: t('analyzingDocument'), progress: null });
        try {
          inspection = await refineInspectionWithAgent(inspection, transport);
          trace.push(workflowEvent(
            'document-analysis',
            'completed',
            `Grounded project and comments with ${provider}`,
          ));
        } catch (reason) {
          if (isCancellation(reason)) throw reason;
          trace.push(workflowEvent(
            'document-analysis',
            'fallback',
            'Grounded agent unavailable; deterministic inspection retained',
          ));
          void appLog(`document intelligence fallback: ${errorMessage(reason)}`);
        }
      } else {
        trace.push(workflowEvent(
          'document-analysis',
          'completed',
          'Deterministic local document analysis',
        ));
      }

      dispatch({ type: 'setBusy', message: t('classifying'), progress: null });
      let classificationPlan;
      let classifyFallbackReason: string | null = null;
      try {
        classificationPlan = await classifyPlan(inspection.items, {
          useLlm: provider !== 'offline',
          transport: provider !== 'offline' ? transport : undefined,
          onProgress: (progress) => dispatch({
            type: 'setBusy',
            message: t('aiBusy', { done: progress.done, total: progress.total }),
            progress: progress.total ? (progress.done / progress.total) * 100 : null,
          }),
        });
      } catch (reason) {
        if (isCancellation(reason)) throw reason;
        llmFailed = provider !== 'offline';
        classifyFallbackReason = errorMessage(reason);
        void appLog(`classification fallback: ${classifyFallbackReason}`);
        classificationPlan = await classifyPlan(inspection.items, { useLlm: false });
      }

      let classifications = classificationPlan.classifications;
      // A failed batch marks its items 'fallback' and the run continues, so asking merely
      // whether *any* item reached the AI would report a mostly-failed run as a success.
      // Count what the AI never classified so the total can be shown to the user.
      const aiSkipped = provider === 'offline'
        ? 0
        : classifications.filter((entry) => entry.source !== 'llm').length;
      const llmApplied = aiSkipped < classifications.length;
      if (provider !== 'offline' && !llmApplied) llmFailed = true;
      trace.push(workflowEvent(
        'classify',
        llmFailed || aiSkipped > 0 ? 'fallback' : 'completed',
        llmFailed
          ? (classifyFallbackReason ?? 'Provider unavailable; deterministic classification completed')
          : `${classifications.length - aiSkipped} of ${classifications.length} items classified by AI`,
      ));

      let memoryApplied = 0;
      try {
        const memory = await listClassificationMemory(inspection.projectName);
        const remembered = applyClassificationMemory(inspection.items, classifications, memory);
        classifications = remembered.classifications;
        memoryApplied = remembered.applied;
        trace.push(workflowEvent(
          'memory',
          'completed',
          memoryApplied
            ? `${memoryApplied} exact approved project matches applied`
            : 'No exact approved project matches',
        ));
      } catch (reason) {
        trace.push(workflowEvent('memory', 'fallback', 'Local project memory was unavailable'));
        void appLog(`classification memory unavailable: ${errorMessage(reason)}`);
      }

      const packages = buildPackages(inspection.items, classifications);
      const packageCatalog = classificationPlan.catalog.map((definition) =>
        packages.find((workPackage) => workPackage.code === definition.code)
          ?? emptyPackage(definition.code, definition.nameEn, definition.nameAr));
      for (const workPackage of packages) {
        if (!packageCatalog.some((candidate) => candidate.code === workPackage.code)) {
          packageCatalog.push(workPackage);
        }
      }
      const issues = validate(inspection.items, classifications, packages);
      trace.push(workflowEvent(
        'validate',
        'completed',
        `${issues.length} validation findings; source quantities remain authoritative`,
      ));
      trace.push(workflowEvent('human-review', 'started', 'Waiting for item-level approval'));

      if (runId !== runIdRef.current) return null;
      const data: PipelineData = {
        inspection,
        classifications,
        packages,
        packageCatalog,
        issues,
        llmUsed: provider !== 'offline' && !llmFailed && llmApplied,
        llmFailed,
        aiSkipped,
        provider,
        model,
        trace,
        memoryApplied,
        fileName: pending.fileName,
        fileHash: pending.fileHash,
        startedAt: pending.startedAt,
      };
      dispatch({ type: 'showReview', data });
      return data;
    } catch (reason) {
      if (isCancellation(reason)) {
        reset();
        return null;
      }
      dispatch({ type: 'reset' });
      void appLog(`workflow error: ${errorMessage(reason)}`);
      dispatch({ type: 'setError', error: friendlyErrorMessage(reason, t) });
      return null;
    } finally {
      clearCancellation();
    }
  }, [boot, clearCancellation, modelSlug, reset, t]);

  // Revision generation + publication lives in useGenerateRevision (extracted to
  // keep this module within its size budget); behavior is unchanged.
  const generate = useGenerateRevision({
    stateRef,
    generatingRef,
    cancelJobRef,
    clearCancellation,
    dispatch,
  });

  const handleFile = useCallback(async (file: File) => {
    // A second drop supersedes the first: cancel the prior worker so its late
    // completion cannot overwrite the newer run.
    cancelJobRef.current?.();
    const runId = ++runIdRef.current;
    dispatch({ type: 'startBusy', message: t('parsing'), progress: null });
    const trace = [workflowEvent('inspect', 'started', 'Local document inspection started')];
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const startedAt = Date.now();
      // Hash before the worker transfer neuters the buffer (see boq-worker.ts).
      const fileHash = await sha256Hex(bytes);
      // Re-read the mode at drop time: the settings dialog writes it directly,
      // so the prop can be stale while settings are open.
      let mode = processingMode;
      try {
        const fresh = (await getSettings()).processingMode;
        if (fresh === 'ask' || fresh === 'online' || fresh === 'offline') mode = fresh;
      } catch {
        // Fall through with the prop when settings are unreadable.
      }
      const inspectJob = inspectInWorker(bytes, file.name, (progress) => {
        if (progress.phase === 'ocr') {
          dispatch({
            type: 'setBusy',
            progress: (progress.progress ?? 0) * 100,
            message: t('ocrProgress', {
              page: progress.page,
              total: progress.total,
              percent: Math.round((progress.progress ?? 0) * 100),
            }),
          });
        } else if (progress.phase === 'pdf') {
          dispatch({
            type: 'setBusy',
            progress: progress.total ? (progress.page / progress.total) * 100 : null,
            message: t('pdfProgress', { page: progress.page, total: progress.total }),
          });
        } else {
          dispatch({ type: 'setBusy', message: t('analyzingDocument'), progress: null });
        }
      });
      cancelJobRef.current = inspectJob.cancel;
      dispatch({ type: 'setCancellable', value: true });
      const inspection = await inspectJob.promise;
      if (runId !== runIdRef.current) {
        inspectJob.cancel();
        return;
      }
      clearCancellation();
      trace.push(workflowEvent(
        'inspect',
        'completed',
        `${inspection.items.length} source-backed items extracted locally`,
      ));
      void appLog(
        `inspection: file=${file.name} source=${inspection.sourceKind} project=${inspection.projectName} items=${inspection.items.length} confidence=${inspection.mapping.confidence.toFixed(2)}`,
      );
      const pending = { inspection, fileName: file.name, fileHash, startedAt, trace };
      if (boot?.provider && boot.provider !== 'none' && mode === 'online') {
        await analyze(pending, true);
      } else if (boot?.provider && boot.provider !== 'none' && mode === 'ask') {
        dispatch({ type: 'requestConsent', pending });
      } else {
        await analyze(pending, false);
      }
    } catch (reason) {
      clearCancellation();
      if (isCancellation(reason)) {
        reset();
        return;
      }
      dispatch({ type: 'reset' });
      void appLog(`workflow error: ${errorMessage(reason)}`);
      dispatch({ type: 'setError', error: friendlyErrorMessage(reason, t) });
    }
  }, [analyze, boot, clearCancellation, processingMode, reset, t]);

  const analyzePending = useCallback((allowAi: boolean) => {
    const pending = stateRef.current.pendingInspection;
    if (pending) void analyze(pending, allowAi);
  }, [analyze]);

  const changeClassification = useCallback((itemId: number, packageCode: string) => {
    const current = stateRef.current;
    const data = current.data;
    if (!data) return;
    if (current.pendingPublication) {
      void discardRevision(current.pendingPublication.reservation).catch(() => undefined);
      dispatch({ type: 'setPendingPublication', pending: null });
    }
    const workPackage = data.packageCatalog.find((candidate) => candidate.code === packageCode)
      ?? emptyPackage('WP-99', i18n.getFixedT('en')('unclassified'), i18n.getFixedT('ar')('unclassified'));
    const classifications = reviseClassification(data.classifications, itemId, workPackage);
    const packages = buildPackages(data.inspection.items, classifications);
    const issues = validate(data.inspection.items, classifications, packages);
    const trace = [...data.trace, workflowEvent('human-review', 'completed', `Item ${itemId} reassigned to ${workPackage.code}`)];
    dispatch({ type: 'updateData', data: { ...data, classifications, packages, issues, trace } });
  }, [i18n]);

  return {
    state,
    handleFile,
    analyzePending,
    changeClassification,
    generate,
    reset,
    cancel,
  };
}
