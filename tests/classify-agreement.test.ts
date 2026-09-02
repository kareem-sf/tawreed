// The offline heuristic is a second opinion on the model's grouping. Unlike the
// self-reported `confidence` field, it is independent evidence, so it drives which items
// the review panel surfaces.
import { describe, expect, it } from 'vitest';
import { flagHeuristicDisagreement } from '../engine/classify/agreement';
import type { BoqItem, Classification } from '../shared/types';

const item = (id: number, description: string, unit: BoqItem['unit'] = 'm3'): BoqItem => ({
  id, code: `C${id}`, description, unit, qty: 1, rate: 100, total: 100, row: id + 1,
});

const llm = (itemId: number, packageCode: string): Classification =>
  ({ itemId, packageCode, confidence: 0.9, source: 'llm' });

/** Four unmistakable concrete lines — the heuristic places all of them in one trade. */
const concrete = [
  item(1, 'Reinforced concrete C35 to isolated footings'),
  item(2, 'Reinforced concrete C35 to columns and shear walls'),
  item(3, 'Reinforced concrete C35 to suspended slabs and beams'),
  item(4, 'Plain concrete blinding under footings'),
];

describe('heuristic agreement', () => {
  it('flags the item the model separates from the rest of its trade', () => {
    const classifications = [llm(1, 'WP-CONCRETE'), llm(2, 'WP-CONCRETE'), llm(3, 'WP-CONCRETE'), llm(4, 'WP-PAINTING')];
    const flagged = flagHeuristicDisagreement(concrete, classifications);
    expect(flagged.find((c) => c.itemId === 4)?.heuristicDisagreement).toBe(true);
    expect(flagged.filter((c) => c.heuristicDisagreement)).toHaveLength(1);
  });

  it('flags nothing when the model keeps the trade together', () => {
    const classifications = concrete.map((entry) => llm(entry.id, 'WP-CONCRETE'));
    const flagged = flagHeuristicDisagreement(concrete, classifications);
    expect(flagged.some((c) => c.heuristicDisagreement)).toBe(false);
  });

  it('never contradicts a human or a remembered decision', () => {
    const classifications: Classification[] = [
      llm(1, 'WP-CONCRETE'), llm(2, 'WP-CONCRETE'), llm(3, 'WP-CONCRETE'),
      { itemId: 4, packageCode: 'WP-PAINTING', confidence: 1, source: 'user' },
    ];
    const flagged = flagHeuristicDisagreement(concrete, classifications);
    expect(flagged.find((c) => c.itemId === 4)?.heuristicDisagreement).toBeUndefined();
  });

  it('stays silent on a trade the heuristic only ever saw once', () => {
    // One concrete line and one item the heuristic cannot place: no majority to break from.
    const items = [item(1, 'Reinforced concrete C35 to footings'), item(2, 'Zqx unrecognizable scope')];
    const flagged = flagHeuristicDisagreement(items, [llm(1, 'WP-A'), llm(2, 'WP-B')]);
    expect(flagged.some((c) => c.heuristicDisagreement)).toBe(false);
  });
});
