import { describe, it, expect } from 'vitest';
import { inspectWorkbook } from '../engine/ingest';
import { classifyAll } from '../engine/classify';
import { heuristicClassify } from '../engine/classify/heuristic';
import { requestToPrompt, type AnthropicRequest } from '../engine/classify/anthropic';
import { buildPackages } from '../engine/validate';
import { enFixture, arFixture, EN_ROWS } from './fixtures';

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
