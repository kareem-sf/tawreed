// Live-provider accuracy run. Skipped unless TAWREED_EVAL_LIVE=1, so `npm test` stays
// offline and deterministic. Drive it with `npm run eval`, which sets the environment.
//
// Scores the committed synthetic corpus plus, if present, the private real corpus in
// tests/eval/corpus/ (gitignored — real client BOQs must not enter a public repo).
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyPlan } from '../../engine/classify';
import { loadCorpus, type EvalCase } from './corpus';
import { aggregate, formatReport, scoreCase } from './score';
import { apiKeyFor, apiKeyVariable, makeEvalTransport, type EvalProvider } from './live-transport';

const LIVE = process.env.TAWREED_EVAL_LIVE === '1';
const PROVIDER = (process.env.TAWREED_EVAL_PROVIDER ?? 'anthropic') as EvalProvider;
const MODEL = process.env.TAWREED_EVAL_MODEL?.trim() || undefined;

const DIRS = ['./corpus-synthetic', './corpus'].map((d) => fileURLToPath(new URL(d, import.meta.url)));

describe.runIf(LIVE)(`classification accuracy (live: ${PROVIDER})`, () => {
  it('scores the corpus against the real provider', { timeout: 30 * 60_000 }, async () => {
    const key = apiKeyFor(PROVIDER);
    expect(
      key,
      `set ${apiKeyVariable(PROVIDER)} to score against ${PROVIDER}`,
    ).toBeTruthy();
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
    // must not fail a build. Persist the numbers so the next run can compare instead of
    // eyeballing CI logs — a >5pt pairF1 drop prints a warning, never a failure.
    const runRecord = {
      at: new Date().toISOString(),
      provider: PROVIDER,
      model: MODEL ?? null,
      cases: total.cases,
      items: total.items,
      pairF1: +total.pairF1.toFixed(4),
      purity: +total.purity.toFixed(4),
      unclassifiedRate: +total.unclassifiedRate.toFixed(4),
    };
    const here = fileURLToPath(new URL('.', import.meta.url));
    const outDir = join(here, '..', '..', '..', 'test-results');
    await mkdir(outDir, { recursive: true }).catch(() => undefined);
    await writeFile(join(outDir, 'live-eval.json'), `${JSON.stringify(runRecord, null, 2)}\n`).catch((error: unknown) => {
      console.info(`live baseline: could not persist run record (${error instanceof Error ? error.message : String(error)})`);
    });
    const baselineRaw = await readFile(join(here, '..', '..', '..', 'scripts', 'live-baseline.json'), 'utf8').catch(() => null);
    if (baselineRaw) {
      try {
        const baseline = JSON.parse(baselineRaw) as { provider?: string; model?: string | null; pairF1?: number };
        const sameConfig = (baseline.provider ?? 'anthropic') === PROVIDER && (baseline.model ?? null) === (MODEL ?? null);
        if (sameConfig && typeof baseline.pairF1 === 'number' && baseline.pairF1 - total.pairF1 > 0.05) {
          console.info(
            `live baseline WARNING: pairF1 ${total.pairF1.toFixed(3)} is >5pts below baseline ${baseline.pairF1.toFixed(3)} `
            + `for ${PROVIDER}${MODEL ? `/${MODEL}` : ''} — investigate before shipping prompt/model changes.`,
          );
        }
      } catch {
        // A corrupt baseline must never fail the measurement run.
      }
    }
    expect(total.items).toBeGreaterThan(0);
  });
});
