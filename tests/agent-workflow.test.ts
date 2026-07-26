import { describe, expect, it } from 'vitest';
import {
  applyClassificationMemory,
  memoryFromApprovedReview,
  reviseClassification,
  workflowEvent,
} from '../engine/agent-workflow';
import type { BoqItem, Classification, WorkPackage } from '../shared/types';

const items: BoqItem[] = [
  {
    id: 1,
    code: 'A1',
    description: 'Reinforced concrete walls',
    unit: 'm3',
    qty: 10,
    rate: 100,
    total: 1_000,
    row: 12,
  },
  {
    id: 2,
    code: 'A2',
    description: 'Internal paint',
    unit: 'm2',
    qty: 50,
    rate: 10,
    total: 500,
    row: 13,
  },
];

const classifications: Classification[] = items.map((item) => ({
  itemId: item.id,
  packageCode: 'WP-99',
  confidence: 0,
  source: 'fallback',
}));

const concrete: WorkPackage = {
  code: 'WP-CONCRETE',
  nameEn: 'Concrete',
  nameAr: 'خرسانة',
  itemIds: [1],
  totalCost: 1_000,
  itemCount: 1,
};

describe('agent workflow guardrails', () => {
  it('applies only exact normalized project-memory matches', () => {
    const result = applyClassificationMemory(items, classifications, [{
      descriptionKey: 'reinforced concrete walls',
      packageCode: concrete.code,
      packageNameEn: concrete.nameEn,
      packageNameAr: concrete.nameAr,
    }]);
    expect(result.applied).toBe(1);
    expect(result.classifications[0]).toMatchObject({
      packageCode: 'WP-CONCRETE',
      confidence: 1,
      source: 'memory',
    });
    expect(result.classifications[1]?.packageCode).toBe('WP-99');
  });

  it('marks a human revision as authoritative and auditable', () => {
    const result = reviseClassification(classifications, 1, concrete);
    expect(result[0]).toMatchObject({
      packageCode: 'WP-CONCRETE',
      confidence: 1,
      source: 'user',
    });
    expect(workflowEvent('human-review', 'completed', 'approved')).toMatchObject({
      stage: 'human-review',
      status: 'completed',
      detail: 'approved',
    });
  });

  it('persists approved decisions but never memorizes unclassified fallbacks', () => {
    const reviewed = reviseClassification(classifications, 1, concrete);
    const memory = memoryFromApprovedReview(
      items,
      reviewed,
      [
        concrete,
        {
          code: 'WP-99',
          nameEn: 'Unclassified',
          nameAr: 'غير مصنف',
          itemIds: [2],
          totalCost: 500,
          itemCount: 1,
        },
      ],
    );
    expect(memory).toEqual([expect.objectContaining({
      descriptionKey: 'reinforced concrete walls',
      packageCode: 'WP-CONCRETE',
    })]);
  });
});
