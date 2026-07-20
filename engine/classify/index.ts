// Classification orchestrator.
// Online (useLlm): the LLM derives the project's packages dynamically from the BOQ.
// Offline: the deterministic bilingual keyword heuristic groups items, with a best-effort fallback.
import type { BoqItem, Classification } from '../../shared/types';
import type { LlmProgress } from './types-internal';
import { heuristicClassify, heuristicFallback } from './heuristic';
import { llmClassify, type LlmTransport } from './llm';

export interface ClassifyOptions {
  useLlm: boolean;
  transport?: LlmTransport;
  onProgress?: (p: LlmProgress) => void;
}

export async function classifyAll(items: BoqItem[], opts: ClassifyOptions): Promise<Classification[]> {
  if (!opts.useLlm) {
    const { classified, remaining } = heuristicClassify(items);
    return [...classified, ...remaining.map((i) => heuristicFallback(i))];
  }
  if (!opts.transport) throw new Error('LLM classification requested but no transport provided.');
  return llmClassify(items, opts.transport, (done, total) =>
    opts.onProgress?.({ phase: 'llm', done, total, remainingItems: items.length })
  );
}
