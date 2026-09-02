// Live-provider accuracy run. Skipped unless TAWREED_EVAL_LIVE=1, so `npm test` stays
// offline and deterministic. Drive it with `npm run eval`, which sets the environment.
//
// Scores the committed synthetic corpus plus, if present, the private real corpus in
// tests/eval/corpus/ (gitignored — real client BOQs must not enter a public repo).
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { classifyPlan } from '../../engine/classify';
import { loadCorpus, type EvalCase } from './corpus';
import { aggregate, formatReport, scoreCase } from './score';
import { apiKeyFor, makeEvalTransport, type EvalProvider } from './live-transport';

const LIVE = process.env.TAWREED_EVAL_LIVE === '1';
const PROVIDER = (process.env.TAWREED_EVAL_PROVIDER ?? 'anthropic') as EvalProvider;
const MODEL = process.env.TAWREED_EVAL_MODEL?.trim() || undefined;

const DIRS = ['./corpus-synthetic', './corpus'].map((d) => fileURLToPath(new URL(d, import.meta.url)));

describe.runIf(LIVE)(`classification accuracy (live: ${PROVIDER})`, () => {
  it('scores the corpus against the real provider', { timeout: 30 * 60_000 }, async () => {
    const key = apiKeyFor(PROVIDER);
    expect(key, `no API key in the environment for provider "${PROVIDER}"`).toBeTruthy();
    const transport = makeEvalTransport(PROVIDER, key!);

    const corpus: EvalCase[] = [];
    for (const dir of DIRS) corpus.push(...(await loadCorpus(dir)));
    expect(corpus.length).toBeGreaterThan(0);

    const scores = [];
    for (const evalCase of corpus) {
      const plan = await classifyPlan(evalCase.items, {
        useLlm: true,
        transport,
        ...(MODEL ? { model: MODEL } : {}),
      });
      scores.push(scoreCase(evalCase.name, evalCase.labels, plan.classifications));
    }
    const total = aggregate(scores);
    console.info(`\nprovider=${PROVIDER}${MODEL ? ` model=${MODEL}` : ''}\n${formatReport(scores, total)}\n`);

    // No floor here: this run is a measurement against a non-deterministic provider and
    // must not fail a build. Compare the printed numbers across runs instead.
    expect(total.items).toBeGreaterThan(0);
  });
});
