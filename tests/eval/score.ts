// Scoring for classification evaluation.
//
// The LLM invents this project's package codes from the BOQ itself (WP-<SLUG>), so a
// predicted code never has to equal the label in the corpus. Comparing codes directly
// would score a perfect grouping as a total failure purely because the model called the
// package WP-CONCRETE-WORKS and the corpus called it WP-02.
//
// So we score the *grouping*: did items that belong together end up together. Pairwise
// precision/recall/F1 over item pairs is the primary metric; purity reports how cleanly
// each produced package maps onto a single expected trade. Both are naming-independent.
// The unclassified rate is tracked separately because dumping items into WP-99 is a
// distinct failure from mis-grouping them.
import type { Classification } from '../../shared/types';
import { UNCLASSIFIED_CODE } from '../../engine/classify/llm';

export interface CaseScore {
  name: string;
  items: number;
  /** Pairwise agreement between the expected grouping and the produced grouping. */
  pairPrecision: number;
  pairRecall: number;
  pairF1: number;
  /** Share of items sitting in a package whose dominant expected trade they belong to. */
  purity: number;
  /** Share of items the classifier refused to place. */
  unclassifiedRate: number;
  /** Share of items placed by the model rather than a fallback/heuristic path. */
  llmShare: number;
}

const pairs = (n: number): number => (n * (n - 1)) / 2;

/** Exact pairwise counts from a contingency table — O(n), not O(n^2) over item pairs. */
export function scoreCase(
  name: string,
  labels: ReadonlyMap<number, string>,
  classifications: readonly Classification[],
): CaseScore {
  const predictedByItem = new Map(classifications.map((c) => [c.itemId, c]));
  const expectedSizes = new Map<string, number>();
  const predictedSizes = new Map<string, number>();
  const cell = new Map<string, number>();
  let items = 0;
  let unclassified = 0;
  let llm = 0;

  for (const [itemId, expected] of labels) {
    const predicted = predictedByItem.get(itemId);
    // An item the classifier never returned is a real failure, not a gap in the corpus:
    // give it a unique bucket so it can never be credited with a correct pairing.
    const code = predicted?.packageCode ?? `__MISSING__${itemId}`;
    items++;
    if (code === UNCLASSIFIED_CODE) unclassified++;
    if (predicted?.source === 'llm') llm++;
    expectedSizes.set(expected, (expectedSizes.get(expected) ?? 0) + 1);
    predictedSizes.set(code, (predictedSizes.get(code) ?? 0) + 1);
    const key = `${expected}\u0000${code}`;
    cell.set(key, (cell.get(key) ?? 0) + 1);
  }

  let truePositives = 0;
  for (const count of cell.values()) truePositives += pairs(count);
  let expectedPairs = 0;
  for (const count of expectedSizes.values()) expectedPairs += pairs(count);
  let predictedPairs = 0;
  for (const count of predictedSizes.values()) predictedPairs += pairs(count);

  const pairPrecision = predictedPairs === 0 ? 1 : truePositives / predictedPairs;
  const pairRecall = expectedPairs === 0 ? 1 : truePositives / expectedPairs;
  const pairF1 = pairPrecision + pairRecall === 0
    ? 0
    : (2 * pairPrecision * pairRecall) / (pairPrecision + pairRecall);

  // Purity: assign each produced package to the expected trade that dominates it.
  const dominant = new Map<string, number>();
  for (const [key, count] of cell) {
    const code = key.slice(key.indexOf('\u0000') + 1);
    if (count > (dominant.get(code) ?? 0)) dominant.set(code, count);
  }
  let dominantTotal = 0;
  for (const count of dominant.values()) dominantTotal += count;

  return {
    name,
    items,
    pairPrecision,
    pairRecall,
    pairF1,
    purity: items === 0 ? 1 : dominantTotal / items,
    unclassifiedRate: items === 0 ? 0 : unclassified / items,
    llmShare: items === 0 ? 0 : llm / items,
  };
}

export interface AggregateScore extends Omit<CaseScore, 'name'> {
  cases: number;
}

/** Item-weighted aggregate, so a 2000-row BOQ is not outvoted by a 20-row one. */
export function aggregate(scores: readonly CaseScore[]): AggregateScore {
  const items = scores.reduce((sum, s) => sum + s.items, 0);
  if (items === 0) {
    return {
      cases: scores.length, items: 0, pairPrecision: 1, pairRecall: 1, pairF1: 1,
      purity: 1, unclassifiedRate: 0, llmShare: 0,
    };
  }
  const weighted = (pick: (s: CaseScore) => number): number =>
    scores.reduce((sum, s) => sum + pick(s) * s.items, 0) / items;
  return {
    cases: scores.length,
    items,
    pairPrecision: weighted((s) => s.pairPrecision),
    pairRecall: weighted((s) => s.pairRecall),
    pairF1: weighted((s) => s.pairF1),
    purity: weighted((s) => s.purity),
    unclassifiedRate: weighted((s) => s.unclassifiedRate),
    llmShare: weighted((s) => s.llmShare),
  };
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

export function formatReport(scores: readonly CaseScore[], total: AggregateScore): string {
  const lines = [
    'case                                  items   pairF1  purity  unclass   llm',
    '─'.repeat(76),
  ];
  for (const s of scores) {
    lines.push(
      `${s.name.slice(0, 36).padEnd(36)}  ${String(s.items).padStart(5)}  ${pct(s.pairF1).padStart(7)}`
      + `  ${pct(s.purity).padStart(6)}  ${pct(s.unclassifiedRate).padStart(7)}  ${pct(s.llmShare).padStart(5)}`,
    );
  }
  lines.push('─'.repeat(76));
  lines.push(
    `${`TOTAL (${total.cases} cases)`.padEnd(36)}  ${String(total.items).padStart(5)}  ${pct(total.pairF1).padStart(7)}`
    + `  ${pct(total.purity).padStart(6)}  ${pct(total.unclassifiedRate).padStart(7)}  ${pct(total.llmShare).padStart(5)}`,
  );
  lines.push(`pair precision ${pct(total.pairPrecision)} / recall ${pct(total.pairRecall)}`);
  return lines.join('\n');
}
