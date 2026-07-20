import { describe, it, expect } from 'vitest';
import { inspectWorkbook } from '../engine/ingest';
import { classifyAll } from '../engine/classify';
import { heuristicClassify } from '../engine/classify/heuristic';
import { requestToPrompt, type LlmRequest } from '../engine/classify/llm';
import { buildPackages } from '../engine/validate';
import { enFixture, arFixture, EN_ROWS } from './fixtures';
import type { BoqItem } from '../shared/types';
import type { LlmProgress } from '../engine/classify/types-internal';

/** Items with no taxonomy keywords so the offline heuristic cannot place them. */
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

const isProposal = (req: LlmRequest): boolean => req.system.includes('Define the procurement work-packages');

/** Pull the item ids out of a classify request so the mock can answer every one. */
function requestedIds(req: LlmRequest): number[] {
  return [...req.messages[0]!.content.matchAll(/^(\d+) \|/gm)].map((m) => Number(m[1]));
}

function proposal(packages: Array<{ code: string; nameEn: string; nameAr?: string }>): string {
  return JSON.stringify({ packages });
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
    // The deliberate gibberish item must stay unplaced by the heuristic
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

describe('dynamic LLM classification (two-phase)', () => {
  const STRUCTURE = [
    { code: 'WP-CONCRETE', nameEn: 'Concrete Works', nameAr: 'أعمال الخرسانة' },
    { code: 'WP-99', nameEn: 'Unclassified', nameAr: 'غير مصنف' },
  ];

  /** Transport that proposes STRUCTURE then assigns every item to WP-CONCRETE. */
  const concreteTransport = async (req: LlmRequest): Promise<string> => {
    if (isProposal(req)) return proposal(STRUCTURE);
    return JSON.stringify({
      classifications: requestedIds(req).map((id) => ({ itemId: id, packageCode: 'WP-CONCRETE', confidence: 0.9 })),
    });
  };

  it('derives project-specific packages — no fixed taxonomy imposed', async () => {
    const seen: LlmRequest[] = [];
    const transport = async (req: LlmRequest): Promise<string> => {
      seen.push(req);
      return concreteTransport(req);
    };
    const { items } = await inspectWorkbook(await enFixture(), 'en.xlsx');
    const all = await classifyAll(items, { useLlm: true, transport });

    // Phase 1 ran and did NOT inject the old fixed standard-taxonomy block.
    const proposalReq = seen.find(isProposal)!;
    expect(proposalReq).toBeTruthy();
    expect(proposalReq.messages[0]!.content).not.toContain('STANDARD PACKAGES (preferred');

    // Every item took the LLM-defined dynamic package, with the proposed names attached.
    expect(all).toHaveLength(EN_ROWS.length);
    expect(all.every((c) => c.source === 'llm' && c.packageCode === 'WP-CONCRETE')).toBe(true);
    expect(all[0]!.packageNameEn).toBe('Concrete Works');
    expect(all[0]!.packageNameAr).toBe('أعمال الخرسانة');

    // The dynamic package flows through to the built package with its proposed name.
    expect(buildPackages(items, all).find((p) => p.code === 'WP-CONCRETE')?.nameEn).toBe('Concrete Works');
  });

  it('normalizes codes the model returns without the WP- prefix', async () => {
    const transport = async (req: LlmRequest): Promise<string> => {
      if (isProposal(req)) return proposal([{ code: 'GLAZING', nameEn: 'Facade & Glazing', nameAr: 'الواجهات' }]);
      return JSON.stringify({
        classifications: requestedIds(req).map((id) => ({ itemId: id, packageCode: 'glazing', confidence: 0.8 })),
      });
    };
    const { items } = await inspectWorkbook(await enFixture(), 'en.xlsx');
    const all = await classifyAll(items, { useLlm: true, transport });
    expect(all.every((c) => c.packageCode === 'WP-GLAZING')).toBe(true);
    expect(all[0]!.packageNameEn).toBe('Facade & Glazing');
  });

  it('enforces the frozen structure — codes outside the proposal are rejected to WP-99', async () => {
    const transport = async (req: LlmRequest): Promise<string> => {
      if (isProposal(req)) return proposal(STRUCTURE);
      return JSON.stringify({
        classifications: requestedIds(req).map((id) => ({ itemId: id, packageCode: 'WP-NOT-PROPOSED', confidence: 0.9 })),
      });
    };
    const { items } = await inspectWorkbook(await enFixture(), 'en.xlsx');
    const all = await classifyAll(items, { useLlm: true, transport });
    expect(all.every((c) => c.packageCode === 'WP-99' && c.source === 'fallback')).toBe(true);
  });

  it('keeps items the model assigns to WP-99 as unclassified', async () => {
    const transport = async (req: LlmRequest): Promise<string> => {
      if (isProposal(req)) return proposal(STRUCTURE);
      return JSON.stringify({
        classifications: requestedIds(req).map((id) => ({ itemId: id, packageCode: 'WP-99', confidence: 0.2 })),
      });
    };
    const { items } = await inspectWorkbook(await enFixture(), 'en.xlsx');
    const all = await classifyAll(items, { useLlm: true, transport });
    expect(all.every((c) => c.packageCode === 'WP-99' && c.source === 'llm')).toBe(true);
  });

  it('degrades to the offline heuristic when structure proposal fails', async () => {
    const garbage = async () => 'I am not JSON at all';
    const { items } = await inspectWorkbook(await enFixture(), 'en.xlsx');
    const all = await classifyAll(items, { useLlm: true, transport: garbage });
    expect(all).toHaveLength(EN_ROWS.length);
    // Concrete still gets placed by the heuristic; the gibberish item is a fallback.
    expect(all.find((c) => c.itemId === 1)!.packageCode).toBe('WP-02');
    expect(all.find((c) => c.itemId === 11)!.source).toBe('fallback');
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
    const cliTransport = async (req: LlmRequest): Promise<string> => {
      const prompt = requestToPrompt(req);
      if (isProposal(req)) {
        expect(prompt).toContain('Define the procurement work-packages');
        return proposal([{ code: 'WP-FINISHES', nameEn: 'Finishes', nameAr: 'التشطيبات' }]);
      }
      expect(prompt).toContain('Zqx unrecognizable');
      return JSON.stringify({
        classifications: requestedIds(req).map((id) => ({ itemId: id, packageCode: 'WP-FINISHES', confidence: 0.6 })),
      });
    };
    const { items } = await inspectWorkbook(await enFixture(), 'en.xlsx');
    const all = await classifyAll(items, { useLlm: true, transport: cliTransport });
    expect(all.find((c) => c.itemId === 11)!.packageCode).toBe('WP-FINISHES');
  });
});

describe('LLM batching (BATCH_SIZE = 100)', () => {
  const STRUCTURE = [{ code: 'WP-MISC', nameEn: 'Miscellaneous', nameAr: 'متنوع' }];

  it('proposes once, then splits 250 items into 3 classify calls and keeps them all', async () => {
    const items = gibberishItems(250);
    const classifyCalls: LlmRequest[] = [];
    let proposals = 0;
    const transport = async (req: LlmRequest): Promise<string> => {
      if (isProposal(req)) {
        proposals += 1;
        return proposal(STRUCTURE);
      }
      classifyCalls.push(req);
      return JSON.stringify({
        classifications: requestedIds(req).map((id) => ({ itemId: id, packageCode: 'WP-MISC', confidence: 0.8 })),
      });
    };
    const progress: LlmProgress[] = [];
    const all = await classifyAll(items, { useLlm: true, transport, onProgress: (p) => progress.push(p) });

    expect(proposals).toBe(1);
    expect(all).toHaveLength(250);
    expect(new Set(all.map((c) => c.itemId)).size).toBe(250);
    expect(all.every((c) => c.source === 'llm' && c.packageCode === 'WP-MISC')).toBe(true);
    // ceil(250 / 100) === 3 classify batches of sizes 100 / 100 / 50.
    expect(classifyCalls).toHaveLength(3);
    expect(classifyCalls.map((c) => requestedIds(c).length)).toEqual([100, 100, 50]);
    expect(progress.map((p) => [p.done, p.total])).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('marks later batches unclassified when those classify calls fail, without throwing', async () => {
    const items = gibberishItems(250);
    const transport = async (req: LlmRequest): Promise<string> => {
      if (isProposal(req)) return proposal(STRUCTURE);
      const ids = requestedIds(req);
      if (Math.min(...ids) > 100) throw new Error('LLM batch failure');
      return JSON.stringify({
        classifications: ids.map((id) => ({ itemId: id, packageCode: 'WP-MISC', confidence: 0.8 })),
      });
    };

    const all = await classifyAll(items, { useLlm: true, transport });

    expect(all).toHaveLength(250);
    const batch1 = all.filter((c) => c.itemId <= 100);
    expect(batch1).toHaveLength(100);
    expect(batch1.every((c) => c.source === 'llm' && c.packageCode === 'WP-MISC')).toBe(true);
    const failed = all.filter((c) => c.itemId > 100);
    expect(failed).toHaveLength(150);
    expect(failed.every((c) => c.packageCode === 'WP-99' && c.source === 'fallback')).toBe(true);
  });
});
