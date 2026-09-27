import { useCallback, type Dispatch } from 'react';
import { useTranslation } from 'react-i18next';
import {
  appLog,
  discardRevision,
  openWorkbook,
  recordRun,
  reserveRevision,
  saveClassificationMemory,
  writeRevisionBundle,
  type RevisionOutput,
} from '../../bridge';
import {
  memoryFromApprovedReview,
  workflowEvent,
} from '../../../engine/agent-workflow';
import { generateInWorker } from '../../boq-worker';
import { errorMessage, friendlyErrorMessage, isCancellation } from './errors';
import type { WorkflowAction } from './reducer';
import type { PipelineData, WorkflowState } from './types';

interface GenerateRevisionDeps {
  stateRef: { current: WorkflowState };
  generatingRef: { current: boolean };
  cancelJobRef: { current: (() => void) | null };
  clearCancellation: () => void;
  dispatch: Dispatch<WorkflowAction>;
}

/**
 * Revision generation + publication. Extracted from useBoqWorkflow so that
 * module stays within its size budget; behavior is unchanged (pure move).
 *
 * Generation always runs from the review screen: staged state carries the
 * pending publication to reuse on retry.
 */
export function useGenerateRevision({
  stateRef,
  generatingRef,
  cancelJobRef,
  clearCancellation,
  dispatch,
}: GenerateRevisionDeps) {
  const { t } = useTranslation();

  return useCallback(async () => {
    const current = stateRef.current;
    const data = current.data;
    if (generatingRef.current || !data) return;
    // Defense-in-depth: the Generate button is disabled when blocking errors
    // exist (ReviewPanel), but never trust button state alone.
    if (data.issues.some((issue) => issue.severity === 'error')) {
      void appLog('generate blocked: validation errors present');
      dispatch({ type: 'setError', error: t('errorGeneric') });
      return;
    }
    generatingRef.current = true;
    dispatch({ type: 'setGenerating', value: true });
    dispatch({ type: 'startBusy' });
    let reservation = current.pendingPublication?.reservation ?? null;
    let artifacts = current.pendingPublication?.artifacts ?? null;
    const trace = [...data.trace];
    if (!trace.some((event) => event.stage === 'human-review' && event.status === 'completed')) {
      trace.push(workflowEvent('human-review', 'completed', 'User approved item classifications'));
    }

    try {
      const approvedMemory = memoryFromApprovedReview(
        data.inspection.items,
        data.classifications,
        data.packages,
      ).map((entry) => ({ ...entry, updatedAt: new Date().toISOString() }));
      try {
        await saveClassificationMemory(data.inspection.projectName, approvedMemory);
      } catch (reason) {
        void appLog(`classification memory save failed (non-fatal): ${errorMessage(reason)}`);
      }

      if (!reservation || !artifacts) {
        reservation = await reserveRevision(data.inspection.projectName);
        const outputArabic = data.inspection.language === 'ar'
          || (data.inspection.language === 'mixed' && /[\u0600-\u06ff]/.test(data.inspection.projectName));
        dispatch({
          type: 'setBusy',
          message: t('generatingBundle', { revision: reservation.revisionLabel }),
          progress: null,
        });
        trace.push(workflowEvent('generate', 'started', `Building ${reservation.revisionLabel}`));
        const generateJob = generateInWorker({
          packages: data.packages,
          items: data.inspection.items,
          projectName: reservation.projectName,
          revision: reservation.revision,
          locale: outputArabic ? 'ar' : 'en',
          documentLanguage: data.inspection.language,
        });
        cancelJobRef.current = generateJob.cancel;
        dispatch({ type: 'setCancellable', value: true });
        artifacts = await generateJob.promise;
        clearCancellation();
        trace.push(workflowEvent('generate', 'completed', `${artifacts.length} workbook artifacts built`));
      } else {
        dispatch({
          type: 'setBusy',
          message: t('retryingPublish', { revision: reservation.revisionLabel }),
          progress: null,
        });
      }

      dispatch({
        type: 'setBusy',
        message: t('publishingRevision', { revision: reservation.revisionLabel }),
        progress: null,
      });
      trace.push(workflowEvent('publish', 'started', `Publishing ${reservation.revisionLabel}`));
      let published: RevisionOutput;
      try {
        published = await writeRevisionBundle(reservation, artifacts);
      } catch (reason) {
        const message = errorMessage(reason);
        if (/preserved at/i.test(message)) {
          trace.push(workflowEvent('publish', 'failed', 'Generated artifacts preserved for a safe retry'));
          dispatch({ type: 'setPendingPublication', pending: { reservation, artifacts } });
          dispatch({ type: 'showReview', data: { ...data, trace } });
          dispatch({ type: 'setError', error: message });
          return;
        }
        await discardRevision(reservation).catch(() => undefined);
        reservation = null;
        throw reason;
      }
      trace.push(workflowEvent(
        'publish',
        'completed',
        `${published.revisionLabel} published`,
      ));
      const completedData: PipelineData = { ...data, trace };
      const itemsById = new Map(data.inspection.items.map((item) => [item.id, item]));

      try {
        await recordRun({
          startedAt: new Date(data.startedAt).toISOString(),
          fileName: data.fileName,
          fileHash: data.fileHash,
          itemCount: data.inspection.items.length,
          packageCount: data.packages.length,
          errorCount: data.issues.filter((issue) => issue.severity === 'error').length,
          warningCount: data.issues.filter((issue) => issue.severity === 'warning').length,
          outputFile: published.masterPath,
          durationMs: Date.now() - data.startedAt,
          llmUsed: data.llmUsed,
          projectName: published.projectName,
          revision: published.revision,
          packageFolder: published.packageFolder,
          sourceKind: data.inspection.sourceKind,
          ocrUsed: data.inspection.ocrPages > 0,
          provider: data.provider,
          model: data.model,
          trace,
          memoryApplied: data.memoryApplied,
          // Approved classifications, item by item: what the AI proposed and what the
          // human changed. Aggregated `llmUsed` cannot answer either question later.
          classifications: data.classifications.map((classification) => ({
            itemId: classification.itemId,
            description: itemsById.get(classification.itemId)?.description ?? '',
            packageCode: classification.packageCode,
            source: classification.source,
            confidence: classification.confidence,
          })),
        });
      } catch (reason) {
        void appLog(`recordRun failed (non-fatal): ${errorMessage(reason)}`);
      }
      dispatch({ type: 'showDone', output: published, data: completedData });
      void openWorkbook(published.masterPath).catch((reason) => {
        void appLog(`open workbook failed: ${errorMessage(reason)}`);
        dispatch({ type: 'setError', error: friendlyErrorMessage(reason, t) });
      });
    } catch (reason) {
      if (reservation) await discardRevision(reservation).catch(() => undefined);
      if (isCancellation(reason)) {
        trace.push(workflowEvent('generate', 'cancelled', 'Generation cancelled by user'));
      } else {
        void appLog(`generate error: ${errorMessage(reason)}`);
        dispatch({ type: 'setError', error: friendlyErrorMessage(reason, t) });
      }
      // A reset during generation means the user abandoned this run — do not resurrect stale review.
      if (stateRef.current.view === 'idle') return;
      dispatch({ type: 'showReview', data: { ...data, trace } });
    } finally {
      clearCancellation();
      generatingRef.current = false;
      dispatch({ type: 'setGenerating', value: false });
    }
  }, [clearCancellation, t, stateRef, generatingRef, cancelJobRef, dispatch]);
}
