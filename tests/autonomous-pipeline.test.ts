import { describe, expect, it } from 'vitest';
import { runPipeline } from './pipeline-harness';
import { enFixture } from './fixtures';
import { classifyAll } from '../engine/classify';
import { buildPackages, validate } from '../engine/validate';
import { autopilotVerdict } from '../engine/autopilot';
import type { BoqItem, Classification } from '../shared/types';

async function cleanContext() {
  const result = await runPipeline(await enFixture(), 'en.xlsx', { useLlm: false });
  const items = result.inspection.items;
  const raw = await classifyAll(items, { useLlm: false });
  // The synthetic fixture deliberately ships one unclassifiable line; a "clean"
  // pipeline for verdict purposes has every item placed with review-grade confidence.
  const classifications: Classification[] = raw.map((c) =>
    c.packageCode === 'WP-99'
      ? { ...c, packageCode: 'WP-02', packageNameEn: 'Concrete', packageNameAr: 'خرسانة', confidence: 0.9, source: 'heuristic' as const }
      : c,
  );
  const packages = buildPackages(items, classifications);
  return { items, classifications, issues: validate(items, classifications, packages) };
}

describe('autopilotVerdict', () => {
  it('passes a clean pipeline with no reasons', async () => {
    const { classifications, issues } = await cleanContext();
    const verdict = autopilotVerdict(issues, classifications);
    expect(verdict.clean).toBe(true);
    expect(verdict.reasonsEn).toEqual([]);
    expect(verdict.reasonsAr).toEqual([]);
  });

  it('blocks on error-severity issues', async () => {
    const { classifications, items } = await cleanContext();
    items[0]!.qty = 0;
    const packages = buildPackages(items, classifications);
    const verdict = autopilotVerdict(validate(items, classifications, packages), classifications);
    expect(verdict.clean).toBe(false);
    expect(verdict.reasonsEn.length).toBeGreaterThan(0);
    expect(verdict.reasonsAr.length).toBe(verdict.reasonsEn.length);
  });

  it('blocks on unclassified WP-99 items', async () => {
    const { classifications, items } = await cleanContext();
    const cls: Classification[] = classifications.map((c, i) => (i === 0 ? { ...c, packageCode: 'WP-99' } : c));
    const packages = buildPackages(items, cls);
    const verdict = autopilotVerdict(validate(items, cls, packages), cls);
    expect(verdict.clean).toBe(false);
  });

  it('blocks on low-confidence classifications', async () => {
    const item: BoqItem = {
      id: 1, code: 'X1', description: 'Door supply', unit: 'm3',
      qty: 2, rate: 3000, total: 6000, row: 2,
    };
    const cls: Classification[] = [{ itemId: 1, packageCode: 'WP-02', confidence: 0.3, source: 'llm' }];
    const verdict = autopilotVerdict(validate([item], cls, buildPackages([item], cls)), cls);
    expect(verdict.clean).toBe(false);
  });

  it('passes warnings-only findings (mismatch, outliers, duplicates)', async () => {
    const { classifications, items } = await cleanContext();
    items[1]!.total = items[1]!.qty * items[1]!.rate! * 1.2; // 20% drift: warning, not error
    const packages = buildPackages(items, classifications);
    const issues = validate(items, classifications, packages);
    expect(issues.some((i) => i.code === 'TOTAL_MISMATCH')).toBe(true);
    expect(autopilotVerdict(issues, classifications).clean).toBe(true);
  });
});
