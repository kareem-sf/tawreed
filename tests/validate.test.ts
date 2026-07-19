import { describe, it, expect } from 'vitest';
import { runPipeline } from '../engine/pipeline';
import { enFixture } from './fixtures';
import { hasBlockingErrors } from '../engine/validate';
import type { BoqItem, Classification } from '../shared/types';
import { inspectWorkbook } from '../engine/ingest';
import { classifyAll } from '../engine/classify';
import { buildPackages, validate } from '../engine/validate';

async function baseItems(): Promise<BoqItem[]> {
  return (await inspectWorkbook(await enFixture(), 'en.xlsx')).items;
}

function mkItem(id: number, over: Partial<BoqItem> = {}): BoqItem {
  return { id, code: `X${id}`, description: `Item ${id}`, unit: 'nr', qty: 1, rate: 100, total: 100, row: id, ...over };
}

function mkCls(itemId: number, over: Partial<Classification> = {}): Classification {
  return { itemId, packageCode: 'WP-02', confidence: 0.9, source: 'heuristic', ...over };
}

describe('validation rules', () => {
  it('clean fixture produces no errors', async () => {
    const result = await runPipeline(await enFixture(), 'en.xlsx', { useLlm: false });
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(hasBlockingErrors(result.issues)).toBe(false);
  });

  it('flags zero/negative quantities as blocking errors', async () => {
    const items = await baseItems();
    items[0]!.qty = 0;
    const cls = await classifyAll(items, { useLlm: false });
    const issues = validate(items, cls, buildPackages(items, cls));
    const rule = issues.find((i) => i.code === 'ZERO_QTY')!;
    expect(rule.severity).toBe('error');
    expect(rule.itemIds).toContain(items[0]!.id);
    expect(hasBlockingErrors(issues)).toBe(true);
  });

  it('flags total ≠ qty × rate beyond tolerance', async () => {
    const items = await baseItems();
    items[1]!.total = items[1]!.qty * items[1]!.rate! * 1.2; // 20% drift
    const cls = await classifyAll(items, { useLlm: false });
    const issues = validate(items, cls, buildPackages(items, cls));
    expect(issues.some((i) => i.code === 'TOTAL_MISMATCH' && i.itemIds.includes(items[1]!.id))).toBe(true);
  });

  it('flags duplicate descriptions', async () => {
    const items = await baseItems();
    items.push({ ...items[0]!, id: 999, code: 'DUP-1' });
    const cls = await classifyAll(items, { useLlm: false });
    const issues = validate(items, cls, buildPackages(items, cls));
    expect(issues.some((i) => i.code === 'DUPLICATE_DESC')).toBe(true);
  });

  it('flags unclassified WP-99 items as warnings', async () => {
    const items = await baseItems();
    const cls = await classifyAll(items, { useLlm: false });
    cls[10]!.packageCode = 'WP-99'; // force the gibberish item
    const issues = validate(items, cls, buildPackages(items, cls));
    expect(issues.some((i) => i.code === 'UNCLASSIFIED')).toBe(true);
  });

  it('packages carry correct item counts and costs', async () => {
    const result = await runPipeline(await enFixture(), 'en.xlsx', { useLlm: false });
    const totalItems = result.packages.reduce((s, p) => s + p.itemCount, 0);
    expect(totalItems).toBe(result.inspection.items.length);
    const concrete = result.packages.find((p) => p.code === 'WP-02')!;
    expect(concrete.itemCount).toBeGreaterThanOrEqual(2);
  });

  it('flags rate outliers within a package (z-score)', () => {
    // The z-score of a single high value among k equal low values is sqrt(k),
    // independent of the rate magnitudes. The rule fires above 2.5σ, so we need
    // k >= 7 low-rate peers (sqrt(8) ≈ 2.83 here) around the 100 vs 10000 split.
    const items: BoqItem[] = [];
    for (let i = 1; i <= 8; i++) items.push(mkItem(i, { rate: 100, total: 100 }));
    const outlier = mkItem(9, { rate: 10000, total: 10000 });
    items.push(outlier);
    const cls = items.map((i) => mkCls(i.id));
    const issues = validate(items, cls, buildPackages(items, cls));
    const rule = issues.find((i) => i.code === 'RATE_OUTLIER')!;
    expect(rule).toBeTruthy();
    expect(rule.severity).toBe('warning');
    expect(rule.itemIds).toContain(outlier.id);
    expect(rule.itemIds).not.toContain(items[0]!.id);
  });

  it('does not flag rate outlier with fewer than 8 priced items', () => {
    const items: BoqItem[] = [];
    for (let i = 1; i <= 6; i++) items.push(mkItem(i, { rate: 100, total: 100 }));
    items.push(mkItem(7, { rate: 10000, total: 10000 }));
    const cls = items.map((i) => mkCls(i.id));
    const issues = validate(items, cls, buildPackages(items, cls));
    expect(issues.some((i) => i.code === 'RATE_OUTLIER')).toBe(false);
  });

  it('flags low-confidence LLM classifications', () => {
    const items = [mkItem(1)];
    const cls = [mkCls(1, { source: 'llm', confidence: 0.3 })];
    const issues = validate(items, cls, buildPackages(items, cls));
    const rule = issues.find((i) => i.code === 'LOW_CONFIDENCE')!;
    expect(rule).toBeTruthy();
    expect(rule.severity).toBe('warning');
    expect(rule.itemIds).toContain(1);
  });

  it('flags negative quantities as a bilingual warning', () => {
    const items = [mkItem(1, { qty: -5, total: -500 })];
    const cls = [mkCls(1)];
    const issues = validate(items, cls, buildPackages(items, cls));
    const rule = issues.find((i) => i.code === 'NEGATIVE_QTY')!;
    expect(rule).toBeTruthy();
    expect(rule.severity).toBe('warning');
    expect(rule.itemIds).toContain(1);
    expect(rule.messageEn.length).toBeGreaterThan(0);
    expect(rule.messageAr.length).toBeGreaterThan(0);
  });
});
