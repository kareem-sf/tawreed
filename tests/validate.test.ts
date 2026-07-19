import { describe, it, expect } from 'vitest';
import { runPipeline } from '../engine/pipeline';
import { enFixture } from './fixtures';
import { hasBlockingErrors } from '../engine/validate';
import type { BoqItem } from '../shared/types';
import { inspectWorkbook } from '../engine/ingest';
import { classifyAll } from '../engine/classify';
import { buildPackages, validate } from '../engine/validate';

async function baseItems(): Promise<BoqItem[]> {
  return (await inspectWorkbook(await enFixture(), 'en.xlsx')).items;
}

describe('validation rules', () => {
  it('clean fixture produces no errors', async () => {
    const result = await runPipeline(await enFixture(), 'en.xlsx', { useLlm: false });
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(hasBlockingErrors(result.issues)).toBe(false);
  });

  it('flags zero/negative quantities as blocking errors', async () => {
    const items = await baseItems();
    items[0].qty = 0;
    const cls = await classifyAll(items, { useLlm: false });
    const issues = validate(items, cls, buildPackages(items, cls));
    const rule = issues.find((i) => i.code === 'ZERO_QTY')!;
    expect(rule.severity).toBe('error');
    expect(rule.itemIds).toContain(items[0].id);
    expect(hasBlockingErrors(issues)).toBe(true);
  });

  it('flags total ≠ qty × rate beyond tolerance', async () => {
    const items = await baseItems();
    items[1].total = items[1].qty * items[1].rate! * 1.2; // 20% drift
    const cls = await classifyAll(items, { useLlm: false });
    const issues = validate(items, cls, buildPackages(items, cls));
    expect(issues.some((i) => i.code === 'TOTAL_MISMATCH' && i.itemIds.includes(items[1].id))).toBe(true);
  });

  it('flags duplicate descriptions', async () => {
    const items = await baseItems();
    items.push({ ...items[0], id: 999, code: 'DUP-1' });
    const cls = await classifyAll(items, { useLlm: false });
    const issues = validate(items, cls, buildPackages(items, cls));
    expect(issues.some((i) => i.code === 'DUPLICATE_DESC')).toBe(true);
  });

  it('flags unclassified WP-99 items as warnings', async () => {
    const items = await baseItems();
    const cls = await classifyAll(items, { useLlm: false });
    cls[10].packageCode = 'WP-99'; // force the gibberish item
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
});
