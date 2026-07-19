/// <reference lib="webworker" />

import type { GenerateInput } from '../../engine/generate';

type Request =
  | { type: 'inspect'; bytes: Uint8Array; fileName: string }
  | { type: 'generate'; input: GenerateInput };

self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    if (event.data.type === 'inspect') {
      const { inspectDocument } = await import('../../engine/inspect-document');
      const result = await inspectDocument(event.data.bytes, event.data.fileName, {
        onProgress: (progress) => self.postMessage({ type: 'progress', progress }),
      });
      self.postMessage({ type: 'result', ok: true, data: result });
      return;
    }

    const { buildWorkbooks } = await import('../../engine/generate');
    const artifacts = await buildWorkbooks(event.data.input);
    self.postMessage(
      {
        type: 'result', ok: true,
        data: artifacts,
      },
      { transfer: [...new Set(artifacts.map((artifact) => artifact.bytes.buffer))] },
    );
  } catch (error) {
    self.postMessage({
      type: 'result', ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
