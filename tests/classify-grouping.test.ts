// Regressions for the two accuracy defects in the dynamic LLM classifier:
//   1. the package structure was proposed from the FIRST N distinct descriptions, so
//      trades appearing late in a long BOQ were never shown to the model at all;
//   2. batches were classified independently, so the same description could land in
//      different packages depending on which batch it fell into.
import { describe, expect, it } from 'vitest';
import { classifyAll } from '../engine/classify';
import { requestToPrompt, type LlmRequest } from '../engine/classify/llm';
import type { BoqItem } from '../shared/types';

const isProposal = (req: LlmRequest): boolean => req.system.includes('Define the procurement work-packages');
const proposal = (packages: Array<{ code: string; nameEn: string; nameAr?: string }>): string =>
  JSON.stringify({ packages });
const requestedIds = (req: LlmRequest): number[] =>
  [...req.messages[0]!.content.matchAll(/^(\d+) \|/gm)].map((m) => Number(m[1]));

const item = (id: number, description: string, unit: BoqItem['unit'] = 'm2'): BoqItem => ({
  id, code: `C${id}`, description, unit, qty: 1, rate: 100, total: 100, row: id + 1,
});

describe('package proposal covers the whole document', () => {
  it('shows the model trades that appear only after the sampling cap', async () => {
    // 600 distinct early items, then a single late trade — more distinct descriptions
    // than MAX_DISTINCT_FOR_PROPOSAL, so first-N sampling could never reach the tail.
    const items = [
      ...Array.from({ length: 600 }, (_, i) => item(i + 1, `Early trade variant ${i + 1}`)),
      item(601, 'VRF air conditioning outdoor condensing unit', 'TR'),
    ];
    let proposalPrompt = '';
    const transport = async (req: LlmRequest): Promise<string> => {
      if (isProposal(req)) {
        proposalPrompt = requestToPrompt(req);
        return proposal([{ code: 'WP-HVAC', nameEn: 'HVAC' }]);
      }
      return JSON.stringify({
        classifications: requestedIds(req).map((id) => ({ itemId: id, packageCode: 'WP-HVAC', confidence: 0.9 })),
      });
    };

    await classifyAll(items, { useLlm: true, transport });
    expect(proposalPrompt).toContain('VRF air conditioning outdoor condensing unit');
  });
});

describe('identical descriptions stay in one package', () => {
  const REPEATED = 'Reinforced concrete C35 to suspended slabs';

  /** Answers with a different package per batch, which used to split repeated items. */
  const alternatingTransport = () => {
    let batch = 0;
    return async (req: LlmRequest): Promise<string> => {
      if (isProposal(req)) {
        return proposal([{ code: 'WP-CONCRETE', nameEn: 'Concrete' }, { code: 'WP-OTHER', nameEn: 'Other' }]);
      }
      const code = batch++ % 2 === 0 ? 'WP-CONCRETE' : 'WP-OTHER';
      return JSON.stringify({
        classifications: requestedIds(req).map((id) => ({ itemId: id, packageCode: code, confidence: 0.9 })),
      });
    };
  };

  it('gives every occurrence of a description the same package', async () => {
    // 150 copies of one line plus 150 distinct lines: enough groups to span batches.
    const items = [
      ...Array.from({ length: 150 }, (_, i) => item(i + 1, REPEATED, 'm3')),
      ...Array.from({ length: 150 }, (_, i) => item(200 + i, `Distinct line ${i}`)),
    ];
    const all = await classifyAll(items, { useLlm: true, transport: alternatingTransport() });

    const repeated = all.filter((c) => c.itemId <= 150);
    expect(repeated).toHaveLength(150);
    expect(new Set(repeated.map((c) => c.packageCode)).size).toBe(1);
  });

  it('asks the model once per distinct description, not once per item', async () => {
    const items = Array.from({ length: 400 }, (_, i) => item(i + 1, REPEATED, 'm3'));
    let classifyCalls = 0;
    const transport = async (req: LlmRequest): Promise<string> => {
      if (isProposal(req)) return proposal([{ code: 'WP-CONCRETE', nameEn: 'Concrete' }]);
      classifyCalls++;
      return JSON.stringify({
        classifications: requestedIds(req).map((id) => ({ itemId: id, packageCode: 'WP-CONCRETE', confidence: 0.9 })),
      });
    };

    const all = await classifyAll(items, { useLlm: true, transport });
    // 400 identical lines are one decision, so one batch — not four.
    expect(classifyCalls).toBe(1);
    expect(all).toHaveLength(400);
    expect(all.every((c) => c.packageCode === 'WP-CONCRETE' && c.source === 'llm')).toBe(true);
  });

  it('returns classifications in the caller\u2019s item order', async () => {
    const items = [item(1, 'Alpha'), item(2, REPEATED, 'm3'), item(3, 'Beta'), item(4, REPEATED, 'm3')];
    const transport = async (req: LlmRequest): Promise<string> => {
      if (isProposal(req)) return proposal([{ code: 'WP-X', nameEn: 'X' }]);
      return JSON.stringify({
        classifications: requestedIds(req).map((id) => ({ itemId: id, packageCode: 'WP-X', confidence: 0.9 })),
      });
    };
    const all = await classifyAll(items, { useLlm: true, transport });
    expect(all.map((c) => c.itemId)).toEqual([1, 2, 3, 4]);
  });
});

describe('missing confidence is treated as unknown', () => {
  it('scores an omitted confidence at 0 so the item reaches human review', async () => {
    const items = [item(1, 'Reinforced concrete to footings', 'm3')];
    const transport = async (req: LlmRequest): Promise<string> => {
      if (isProposal(req)) return proposal([{ code: 'WP-CONCRETE', nameEn: 'Concrete' }]);
      // No confidence field at all — the case that used to silently become 0.8.
      return JSON.stringify({ classifications: [{ itemId: 1, packageCode: 'WP-CONCRETE' }] });
    };
    const all = await classifyAll(items, { useLlm: true, transport });
    expect(all[0]).toMatchObject({ packageCode: 'WP-CONCRETE', source: 'llm', confidence: 0 });
  });
});
