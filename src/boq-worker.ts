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

/** Rejection sentinel for user-cancelled jobs — callers check `instanceof` and stay silent. */
export class WorkerCancelledError extends Error {
  constructor() {
    super('Worker job cancelled by user');
    this.name = 'WorkerCancelledError';
  }
}

export interface WorkerJob<T> {
  promise: Promise<T>;
  /** The worker is one-shot per request: terminating it rejects `promise` with WorkerCancelledError. */
  cancel: () => void;
}

function execute<T>(
  message: unknown,
  transfer: Transferable[] = [],
  options: { timeoutMs?: number; onProgress?: (progress: PdfProgress) => void } = {},
): WorkerJob<T> {
  let cancel: () => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    const worker = new Worker(new URL('./workers/boq.worker.ts', import.meta.url), { type: 'module' });
    const timeoutMs = options.timeoutMs ?? 120_000;
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error(`Workbook processing timed out after ${Math.round(timeoutMs / 60_000)} minutes`));
    }, timeoutMs);

    const finish = (callback: () => void) => {
      window.clearTimeout(timeout);
      worker.terminate();
      callback();
    };
    cancel = () => finish(() => reject(new WorkerCancelledError()));
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
  return { promise, cancel };
}

export function inspectInWorker(
  bytes: Uint8Array,
  fileName: string,
  onProgress?: (progress: PdfProgress) => void,
): WorkerJob<InspectionResult> {
  const copy = bytes.slice();
  return execute<InspectionResult>(
    { type: 'inspect', bytes: copy, fileName },
    [copy.buffer],
    { timeoutMs: 15 * 60_000, onProgress },
  );
}

export function generateInWorker(input: GenerateInput): WorkerJob<GeneratedArtifact[]> {
  return execute({ type: 'generate', input }, [], { timeoutMs: 10 * 60_000 });
}
