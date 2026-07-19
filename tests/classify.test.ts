import { describe, it, expect } from 'vitest';
import { inspectWorkbook } from '../engine/ingest';
import { classifyAll } from '../engine/classify';
import { heuristicClassify } from '../engine/classify/heuristic';
import { requestToPrompt, type AnthropicRequest } from '../engine/classify/anthropic';
import { buildPackages } from '../engine/validate';
import { enFixture, arFixture, EN_ROWS } from './fixtures';
import type { BoqItem } from '../shared/types';
import type { LlmProgress } from '../engine/classify/types-internal';

/** Items with no taxonomy keywords so the heuristic pass leaves them all for the LLM. */
function gibberishItems(n: number): BoqItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    code: `Z${i + 1}`,
    description: `Zqx item ${i + 1}`,
    unit: 'nr' as const,
    qty: 1,
    rate: 100,
    total: 100,
    row: i + 1,
  }));
}

/** Pull the item ids back out of a classification request so the mock can answer every one. */
function requestedIds(req: AnthropicRequest): number[] {
  return [...req.messages[0]!.content.matchAll(/^(\d+) \|/gm)].map((m) => Number(m[1]));
}

describe('heuristic classifier (offline)', () => {
  it('classifies obvious English items into the right packages', async () => {
    const { items } = await inspectWorkbook(await enFixture(), 'en.xlsx');
    const { classified, remaining } = heuristicClassify(items);
    const byId = new Map(classified.map((c) => [c.itemId, c.packageCode]));
    expect(byId.get(1)).toBe('WP-02'); // concrete
    expect(byId.get(2)).toBe('WP-02'); // rebar
    expect(byId.get(3)).toBe('WP-03'); // block walls
    expect(byId.get(8)).toBe('WP-08'); // VRF
    expect(byId.get(9)).toBe('WP-09'); // cabling
    // The deliberate gibberish item must stay for the LLM/fallback
    expect(remaining.some((i) => i.id === 11)).toBe(true);
  });

  it('classifies Arabic items', async () => {
    const { items } = await inspectWorkbook(await arFixture(), 'ar.xlsx');
    const { classified } = heuristicClassify(items);
    const byId = new Map(classified.map((c) => [c.itemId, c.packageCode]));
    expect(byId.get(1)).toBe('WP-02'); // خرسانة
    expect(byId.get(2)).toBe('WP-02'); // حديد
    expect(byId.get(3)).toBe('WP-03'); // بلوك
    expect(byId.get(5)).toBe('WP-07'); // سباكة
    expect(byId.get(6)).toBe('WP-09'); // كابلات
  });

  it('offline pipeline assigns every item (fallback for the unknown)', async () => {
    const { items } = await inspectWorkbook(await enFixture(), 'en.xlsx');
    const all = await classifyAll(items, { useLlm: false });
    expect(all).toHaveLength(EN_ROWS.length);
    const gibberish = all.find((c) => c.itemId === 11)!;
    expect(gibberish.source).toBe('fallback');
  });
});

describe('LLM classification', () => {
  const goodTransport = async (req: AnthropicRequest) => {
    expect(req.system).toContain('quantity surveyor');
    // Return the gibberish item into WP-09 (pretend the model understood it)
    return JSON.stringify({ classifications: [{ itemId: 11, packageCode: 'WP-09', confidence: 0.9 }] });
  };

  it('classifies heuristic-remainder via injected transport', async () => {
    const { items } = await inspectWorkbook(await enFixture(), 'en.xlsx');
    const all = await classifyAll(items, { useLlm: true, transport: goodTransport });
    const gibberish = all.find((c) => c.itemId === 11)!;
    expect(gibberish.packageCode).toBe('WP-09');
    expect(gibberish.source).toBe('llm');
  });

  it('falls back deterministically when the LLM returns garbage twice', async () => {
    const garbage = async () => 'I am not JSON at all';
    const { items } = await inspectWorkbook(await enFixture(), 'en.xlsx');
    const all = await classifyAll(items, { useLlm: true, transport: garbage });
    const gibberish = all.find((c) => c.itemId === 11)!;
    expect(gibberish.source).toBe('fallback');
    expect(all).toHaveLength(EN_ROWS.length);
  });

  it('recovers when JSON is embedded in prose', async () => {
    const prose = async () => 'Sure! Here is the result:\n{"classifications":[{"itemId":11,"packageCode":"WP-01","confidence":0.7}]}\nHope that helps.';
    const { items } = await inspectWorkbook(await enFixture(), 'en.xlsx');
    const all = await classifyAll(items, { useLlm: true, transport: prose });
    expect(all.find((c) => c.itemId === 11)!.packageCode).toBe('WP-01');
  });

  it('rejects invalid package codes and falls back for that item', async () => {
    const badCode = async () => JSON.stringify({ classifications: [{ itemId: 11, packageCode: 'WP-42', confidence: 0.9 }] });
    const { items } = await inspectWorkbook(await enFixture(), 'en.xlsx');
    const all = await classifyAll(items, { useLlm: true, transport: badCode });
    expect(all.find((c) => c.itemId === 11)!.source).toBe('fallback');
  });

  it('accepts a content-specific dynamic procurement package with names', async () => {
    const dynamic = async () => JSON.stringify({
      classifications: [{
        itemId: 11,
        packageCode: 'WP-AI-SPECIAL-EQUIPMENT',
        packageNameEn: 'Special Equipment',
        packageNameAr: 'معدات خاصة',
        confidence: 0.82,
      }],
    });
    const { items } = await inspectWorkbook(await enFixture(), 'en.xlsx');
    const all = await classifyAll(items, { useLlm: true, transport: dynamic });
    const result = all.find((c) => c.itemId === 11)!;
    expect(result.packageCode).toBe('WP-AI-SPECIAL-EQUIPMENT');
    expect(result.packageNameEn).toBe('Special Equipment');
    expect(result.source).toBe('llm');
    expect(buildPackages(items, all).find((p) => p.code === result.packageCode)?.nameEn).toBe('Special Equipment');
  });
});

describe('requestToPrompt (Codex/CLI flattening)', () => {
  it('flattens system + messages into a single prompt with JSON reminder', () => {
    const prompt = requestToPrompt({
      model: 'x',
      max_tokens: 100,
      system: 'SYS',
      messages: [{ role: 'user', content: 'USER CONTENT' }],
    });
    expect(prompt).toContain('SYS');
    expect(prompt).toContain('USER CONTENT');
    expect(prompt).toContain('JSON object only');
  });

  it('works end-to-end through classifyAll with a CLI-style transport', async () => {
    const cliTransport = async (req: AnthropicRequest) => {
      const prompt = requestToPrompt(req);
      expect(prompt).toContain('quantity surveyor');
      expect(prompt).toContain('Zqx unrecognizable');
      return '{"classifications":[{"itemId":11,"packageCode":"WP-04","confidence":0.6}]}';
    };
    const { items } = await inspectWorkbook(await enFixture(), 'en.xlsx');
    const all = await classifyAll(items, { useLlm: true, transport: cliTransport });
    expect(all.find((c) => c.itemId === 11)!.packageCode).toBe('WP-04');
  });
});

describe('LLM batching (BATCH_SIZE = 100)', () => {
  it('splits 250 heuristic-unclassifiable items into 3 transport calls and keeps them all', async () => {
    const items = gibberishItems(250);
    const calls: AnthropicRequest[] = [];
    const transport = async (req: AnthropicRequest) => {
      calls.push(req);
      const ids = requestedIds(req);
      return JSON.stringify({
        classifications: ids.map((id) => ({ itemId: id, packageCode: 'WP-09', confidence: 0.8 })),
      });
    };
    const progress: LlmProgress[] = [];
    const all = await classifyAll(items, { useLlm: true, transport, onProgress: (p) => progress.push(p) });

    expect(all).toHaveLength(250);
    expect(new Set(all.map((c) => c.itemId)).size).toBe(250);
    expect(all.every((c) => c.source === 'llm' && c.packageCode === 'WP-09')).toBe(true);
    // ceil(250 / 100) === 3 batches of sizes 100 / 100 / 50.
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => requestedIds(c).length)).toEqual([100, 100, 50]);
    expect(progress.map((p) => [p.done, p.total])).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('falls back per-batch when later LLM calls fail, without throwing', async () => {
    const items = gibberishItems(250);
    const transport = async (req: AnthropicRequest) => {
      const ids = requestedIds(req);
      if (Math.min(...ids) > 100) throw new Error('LLM batch failure');
      return JSON.stringify({
        classifications: ids.map((id) => ({ itemId: id, packageCode: 'WP-09', confidence: 0.8 })),
      });
    };

    const all = await classifyAll(items, { useLlm: true, transport });

    expect(all).toHaveLength(250);
    const batch1 = all.filter((c) => c.itemId <= 100);
    expect(batch1).toHaveLength(100);
    expect(batch1.every((c) => c.source === 'llm' && c.packageCode === 'WP-09')).toBe(true);
    const failed = all.filter((c) => c.itemId > 100);
    expect(failed).toHaveLength(150);
    expect(failed.every((c) => c.source === 'fallback')).toBe(true);
  });
});
