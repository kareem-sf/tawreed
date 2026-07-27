// Classification orchestrator.
// Online (useLlm): the LLM derives the project's packages dynamically from the BOQ.
// Offline: the deterministic bilingual keyword heuristic groups items, with a best-effort fallback.
import type {
  BoqItem,
  Classification,
  ClassificationPlan,
  PackageDefinition,
} from '../../shared/types';
import type { LlmProgress } from './types-internal';
import { heuristicClassify, heuristicFallback } from './heuristic';
import { llmClassify, type LlmTransport } from './llm';
import { TAXONOMY, UNCLASSIFIED } from './taxonomy';

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
  return llmClassify(items, opts.transport, (done, total, processedItems) =>
    opts.onProgress?.({ phase: 'llm', done, total, remainingItems: Math.max(0, items.length - processedItems) })
  );
}

function catalogFromClassifications(classifications: Classification[]): PackageDefinition[] {
  const seen = new Set<string>();
  const catalog: PackageDefinition[] = [];
  for (const classification of classifications) {
    if (seen.has(classification.packageCode)) continue;
    seen.add(classification.packageCode);
    const known = TAXONOMY.find((item) => item.code === classification.packageCode);
    catalog.push(known ?? {
      code: classification.packageCode,
      nameEn: classification.packageNameEn
        ?? (classification.packageCode === UNCLASSIFIED.code ? UNCLASSIFIED.nameEn : classification.packageCode),
      nameAr: classification.packageNameAr
        ?? classification.packageNameEn
        ?? (classification.packageCode === UNCLASSIFIED.code ? UNCLASSIFIED.nameAr : classification.packageCode),
      keywords: [],
    });
  }
  return catalog.sort((a, b) => a.code.localeCompare(b.code));
}

export async function classifyPlan(
  items: BoqItem[],
  opts: ClassifyOptions,
): Promise<ClassificationPlan> {
  const classifications = await classifyAll(items, opts);
  return {
    catalog: catalogFromClassifications(classifications),
    classifications,
  };
}
