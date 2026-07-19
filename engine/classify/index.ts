// Classification orchestrator: heuristic pass first, LLM only for the remainder.
import type { BoqItem, Classification } from '../../shared/types';
import type { LlmProgress } from './types-internal';
import { heuristicClassify, heuristicFallback } from './heuristic';
import { llmClassify, type LlmTransport } from './anthropic';

export interface ClassifyOptions {
  useLlm: boolean;
  transport?: LlmTransport;
  onProgress?: (p: LlmProgress) => void;
}

export async function classifyAll(items: BoqItem[], opts: ClassifyOptions): Promise<Classification[]> {
  const { classified, remaining } = heuristicClassify(items);
  if (!opts.useLlm || remaining.length === 0) {
    // Offline: best-effort guess (low confidence, source=fallback) beats blanket WP-99.
    return [...classified, ...remaining.map((i) => heuristicFallback(i))];
  }
  if (!opts.transport) throw new Error('LLM classification requested but no transport provided.');
  const llmResults = await llmClassify(remaining, opts.transport, (done, total) =>
    opts.onProgress?.({ phase: 'llm', done, total, remainingItems: remaining.length })
  );
  return [...classified, ...llmResults];
}
