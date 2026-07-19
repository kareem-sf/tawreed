import type { GeneratedArtifact, GenerateInput } from '../engine/generate';
import type { InspectionResult } from '../shared/types';
import type { PdfProgress } from '../engine/pdf-ingest';

interface WorkerResponse<T> {
  type: 'result';
  ok: boolean;
  data?: T;
  error?: string;
}

interface WorkerProgress {
  type: 'progress';
  progress: PdfProgress;
}

function execute<T>(
  message: unknown,
  transfer: Transferable[] = [],
  options: { timeoutMs?: number; onProgress?: (progress: PdfProgress) => void } = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workers/boq.worker.ts', import.meta.url), { type: 'module' });
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error('Workbook processing timed out after 2 minutes'));
    }, options.timeoutMs ?? 120_000);

    const finish = (callback: () => void) => {
      window.clearTimeout(timeout);
      worker.terminate();
      callback();
    };
    worker.onmessage = (event: MessageEvent<WorkerResponse<T> | WorkerProgress>) => {
      const response = event.data;
      if (response.type === 'progress') {
        options.onProgress?.(response.progress);
        return;
      }
      finish(() => {
        if (response.ok && response.data !== undefined) resolve(response.data);
        else reject(new Error(response.error || 'BOQ worker failed'));
      });
    };
    worker.onerror = (event) => {
      finish(() => reject(new Error(event.message || 'BOQ worker crashed')));
    };
    worker.onmessageerror = () => {
      finish(() => reject(new Error('Workbook worker returned an unreadable response')));
    };
    try {
      worker.postMessage(message, transfer);
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

export function inspectInWorker(
  bytes: Uint8Array,
  fileName: string,
  onProgress?: (progress: PdfProgress) => void,
): Promise<InspectionResult> {
  const copy = bytes.slice();
  return execute<InspectionResult>(
    { type: 'inspect', bytes: copy, fileName },
    [copy.buffer],
    { timeoutMs: 15 * 60_000, onProgress },
  );
}

export function generateInWorker(input: GenerateInput): Promise<GeneratedArtifact[]> {
  return execute({ type: 'generate', input });
}
