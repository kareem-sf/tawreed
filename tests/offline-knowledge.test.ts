import { describe, expect, it } from 'vitest';
import { classifyPlan } from '../engine/classify';
import type { BoqItem } from '../shared/types';

const item = (id: number, description: string, code = '', unit: BoqItem['unit'] = 'm2'): BoqItem => ({
  id,
  code,
  description,
  unit,
  qty: 1,
  rate: 100,
  total: 100,
  row: id + 1,
});

const golden = [
  item(1, 'Demolition and strip-out of existing internal partitions'),
  item(2, 'Bored piles including reinforcement and concrete', '', 'm'),
  item(3, 'Structural steel frame beams and columns', '', 'ton'),
  item(4, 'Torch applied bituminous waterproofing membrane'),
  item(5, 'Unitized curtain wall facade and aluminium composite cladding'),
  item(6, 'Luxury vinyl tile LVT flooring'),
  item(7, 'Automatic sprinkler and fire pump system'),
  item(8, 'CAT6 structured cabling and data outlets'),
  item(9, 'CCTV cameras and access control card readers'),
  item(10, 'Testing commissioning and air balancing'),
  item(11, 'أعمال محارة ولياسة أسمنتية للحوائط'),
  item(12, 'توريد وتركيب أسقف معلقة من الجبس بورد'),
  item(13, 'شبكة إنذار حريق تشمل كواشف الدخان ولوحة الإنذار'),
  item(14, 'أعمال طرق أسفلت وبردورات وإنترلوك'),
  item(15, 'تنظيف نهائي عميق قبل التسليم'),
];

describe('offline construction knowledge pack', () => {
  it('groups English and Arabic specialist trades into evidenced packages', async () => {
    const plan = await classifyPlan(golden, { useLlm: false });
    const byItem = new Map(plan.classifications.map((entry) => [entry.itemId, entry.packageCode]));

    expect(byItem.get(1)).toBe('WP-DEMOLITION');
    expect(byItem.get(2)).toBe('WP-PILING');
    expect(byItem.get(3)).toBe('WP-STRUCTURAL-STEEL');
    expect(byItem.get(4)).toBe('WP-WATERPROOFING');
    expect(byItem.get(5)).toBe('WP-FACADE');
    expect(byItem.get(6)).toBe('WP-RESILIENT-FLOORING');
    expect(byItem.get(7)).toBe('WP-FIRE-FIGHTING');
    expect(byItem.get(8)).toBe('WP-ICT');
    expect(byItem.get(9)).toBe('WP-SECURITY');
    expect(byItem.get(10)).toBe('WP-COMMISSIONING');
    expect(byItem.get(11)).toBe('WP-PLASTER');
    expect(byItem.get(12)).toBe('WP-CEILINGS');
    expect(byItem.get(13)).toBe('WP-FIRE-ALARM');
    expect(byItem.get(14)).toBe('WP-ROADS');
    expect(byItem.get(15)).toBe('WP-CLEANING');

    expect(plan.catalog.map((definition) => definition.code).sort()).toEqual(
      [...new Set(plan.classifications.map((entry) => entry.packageCode))].sort(),
    );
  });

  it('uses exclusions to separate similar construction terms', async () => {
    const samples = [
      item(1, 'Concrete block masonry wall'),
      item(2, 'Fire alarm cable and smoke detector'),
      item(3, 'Acoustic ceiling tiles on suspended grid'),
      item(4, 'Kitchen cabinets and timber joinery'),
    ];
    const plan = await classifyPlan(samples, { useLlm: false });
    const codes = plan.classifications.map((entry) => entry.packageCode);
    expect(codes).toEqual(['WP-03', 'WP-FIRE-ALARM', 'WP-CEILINGS', 'WP-JOINERY']);
  });

  it('is deterministic and leaves unintelligible data visibly unresolved', async () => {
    const samples = [...golden, item(99, 'Zqx 71 unknown proprietary scope')];
    const first = await classifyPlan(samples, { useLlm: false });
    const second = await classifyPlan(samples, { useLlm: false });
    expect(second).toEqual(first);
    expect(first.classifications.find((entry) => entry.itemId === 99)).toMatchObject({
      packageCode: 'WP-99',
      source: 'fallback',
    });
  });
});
