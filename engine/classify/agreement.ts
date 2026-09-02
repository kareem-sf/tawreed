// Cross-check the model against the offline heuristic.
//
// The two classifiers cannot be compared by code: the heuristic emits fixed taxonomy codes
// (WP-02) while the model invents this project's own (WP-CONCRETE-WORKS). What they can be
// compared on is the *grouping* — items the heuristic considers one trade should mostly
// land in one package. An item that breaks away from where the rest of its heuristic trade
// went is the item worth a second look.
//
// This is a genuinely independent signal. `Classification.confidence` is the model grading
// its own work, and self-reported confidence is not calibrated; agreement between two
// classifiers built on different principles is evidence.
import type { BoqItem, Classification } from '../../shared/types';
import { heuristicClassify } from './heuristic';

/** Marks LLM classifications that disagree with where their heuristic trade mostly went. */
export function flagHeuristicDisagreement(
  items: BoqItem[],
  classifications: Classification[],
): Classification[] {
  const { classified } = heuristicClassify(items);
  if (classified.length === 0) return classifications;

  const heuristicByItem = new Map(classified.map((entry) => [entry.itemId, entry.packageCode]));
  const llmByItem = new Map(
    classifications.filter((entry) => entry.source === 'llm').map((entry) => [entry.itemId, entry.packageCode]),
  );

  // For each heuristic trade, which package did the model send most of it to?
  const votes = new Map<string, Map<string, number>>();
  for (const [itemId, heuristicCode] of heuristicByItem) {
    const llmCode = llmByItem.get(itemId);
    if (!llmCode) continue;
    const tally = votes.get(heuristicCode) ?? new Map<string, number>();
    tally.set(llmCode, (tally.get(llmCode) ?? 0) + 1);
    votes.set(heuristicCode, tally);
  }
  const plurality = new Map<string, string>();
  for (const [heuristicCode, tally] of votes) {
    // A trade the heuristic saw only once carries no majority to disagree with.
    let total = 0;
    let bestCode = '';
    let bestCount = 0;
    for (const [code, count] of tally) {
      total += count;
      if (count > bestCount) {
        bestCount = count;
        bestCode = code;
      }
    }
    if (total > 1) plurality.set(heuristicCode, bestCode);
  }

  return classifications.map((entry) => {
    if (entry.source !== 'llm') return entry;
    const heuristicCode = heuristicByItem.get(entry.itemId);
    if (heuristicCode === undefined) return entry;
    const expected = plurality.get(heuristicCode);
    if (expected === undefined || expected === entry.packageCode) return entry;
    return { ...entry, heuristicDisagreement: true };
  });
}
