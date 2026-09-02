// Deterministic accuracy gate. Runs the offline heuristic over the committed synthetic
// corpus and holds it to a floor, so a change that silently degrades grouping quality
// fails CI the way a coverage drop does. The live-provider run is a separate,
// network-dependent script (`npm run eval`) and is deliberately not part of `npm test`.
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { classifyPlan } from '../../engine/classify';
import { loadCorpus } from './corpus';
import { aggregate, formatReport, scoreCase } from './score';

const SYNTHETIC = fileURLToPath(new URL('./corpus-synthetic', import.meta.url));

// Ratchets, set just under today's measured numbers — raise them as accuracy improves,
// never lower them to make a change pass.
const FLOOR = { pairF1: 0.57, purity: 0.85, unclassifiedRate: 0.16 };

describe('classification accuracy (offline heuristic, synthetic corpus)', () => {
  it('holds the grouping-quality floor', async () => {
    const corpus = await loadCorpus(SYNTHETIC);
    expect(corpus.length).toBeGreaterThan(0);

    const scores = [];
    for (const evalCase of corpus) {
      const plan = await classifyPlan(evalCase.items, { useLlm: false });
      scores.push(scoreCase(evalCase.name, evalCase.labels, plan.classifications));
    }
    const total = aggregate(scores);
    // Printed so a CI log shows the number that moved, not just pass/fail.
    console.info(`\n${formatReport(scores, total)}\n`);

    expect(total.pairF1).toBeGreaterThanOrEqual(FLOOR.pairF1);
    expect(total.purity).toBeGreaterThanOrEqual(FLOOR.purity);
    expect(total.unclassifiedRate).toBeLessThanOrEqual(FLOOR.unclassifiedRate);
  });

  it('scores every labelled item, including ones the classifier never returns', async () => {
    const corpus = await loadCorpus(SYNTHETIC);
    const first = corpus[0]!;
    // Dropping half the results must visibly cost recall rather than silently
    // shrinking the denominator.
    const plan = await classifyPlan(first.items, { useLlm: false });
    const full = scoreCase(first.name, first.labels, plan.classifications);
    const partial = scoreCase(first.name, first.labels, plan.classifications.slice(0, 5));
    expect(partial.items).toBe(full.items);
    expect(partial.pairRecall).toBeLessThan(full.pairRecall);
  });
});
