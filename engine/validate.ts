// Validation rule engine — errors block generation, warnings don't.
import type { BoqItem, Classification, ValidationIssue, WorkPackage } from '../shared/types';
import { TAXONOMY, UNCLASSIFIED } from './classify/taxonomy';

const TOTAL_TOLERANCE_PCT = 0.015; // 1.5%
const TOTAL_TOLERANCE_ABS = 100; // EGP
const OUTLIER_Z = 2.5;

export function buildPackages(items: BoqItem[], classifications: Classification[]): WorkPackage[] {
  const byItem = new Map(items.map((i) => [i.id, i]));
  const groups = new Map<string, number[]>();
  for (const c of classifications) {
    const arr = groups.get(c.packageCode) ?? [];
    arr.push(c.itemId);
    groups.set(c.packageCode, arr);
  }
  const packages: WorkPackage[] = [];
  for (const [code, itemIds] of groups) {
    const dynamic = classifications.find((c) => c.packageCode === code);
    const def = TAXONOMY.find((p) => p.code === code) ?? {
      code,
      nameEn: dynamic?.packageNameEn || (code === 'WP-99' ? UNCLASSIFIED.nameEn : code),
      nameAr: dynamic?.packageNameAr || dynamic?.packageNameEn || (code === 'WP-99' ? UNCLASSIFIED.nameAr : code),
    };
    const totalCost = itemIds.reduce((s, id) => s + (byItem.get(id)?.total ?? 0), 0);
    packages.push({
      code, nameEn: def.nameEn, nameAr: def.nameAr,
      itemIds: [...itemIds].sort((a, b) => a - b),
      totalCost, itemCount: itemIds.length,
    });
  }
  return packages.sort((a, b) => a.code.localeCompare(b.code));
}

export function validate(items: BoqItem[], classifications: Classification[], packages: WorkPackage[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byItem = new Map(items.map((i) => [i.id, i]));
  const classByItem = new Map(classifications.map((c) => [c.itemId, c]));

  // 1. Unclassified items
  const unclassified = classifications.filter((c) => c.packageCode === 'WP-99').map((c) => c.itemId);
  if (unclassified.length > 0) {
    issues.push({
      severity: 'warning', code: 'UNCLASSIFIED',
      messageEn: `${unclassified.length} item(s) could not be classified — review the WP-99 package.`,
      messageAr: `${unclassified.length} بند لم يتم تصنيفه — راجع حزمة WP-99.`,
      itemIds: unclassified,
    });
  }

  // 2. Low-confidence classifications
  const lowConf = classifications.filter((c) => c.source !== 'heuristic' && c.confidence < 0.5).map((c) => c.itemId);
  if (lowConf.length > 0) {
    issues.push({
      severity: 'warning', code: 'LOW_CONFIDENCE',
      messageEn: `${lowConf.length} item(s) classified with low confidence (<50%).`,
      messageAr: `${lowConf.length} بند مصنف بثقة منخفضة (أقل من 50%).`,
      itemIds: lowConf,
    });
  }

  // 3. Non-positive quantities — hard error
  const badQty = items.filter((i) => i.qty <= 0).map((i) => i.id);
  if (badQty.length > 0) {
    issues.push({
      severity: 'error', code: 'ZERO_QTY',
      messageEn: `${badQty.length} item(s) have zero or negative quantity — fix the source BOQ.`,
      messageAr: `${badQty.length} بند بكمية صفرية أو سالبة — صحح جدول الكميات المصدر.`,
      itemIds: badQty,
    });
  }

  // 4. Total ≠ qty × rate beyond tolerance
  const mismatch = items
    .filter((i) => {
      if (i.rate === null || i.total === null) return false;
      const expected = i.qty * i.rate;
      return Math.abs(i.total - expected) > Math.max(TOTAL_TOLERANCE_ABS, Math.abs(expected) * TOTAL_TOLERANCE_PCT);
    })
    .map((i) => i.id);
  if (mismatch.length > 0) {
    issues.push({
      severity: 'warning', code: 'TOTAL_MISMATCH',
      messageEn: `${mismatch.length} item(s) where total ≠ qty × rate beyond tolerance.`,
      messageAr: `${mismatch.length} بند الإجمالي فيه لا يساوي الكمية × الفئة.`,
      itemIds: mismatch,
    });
  }

  // 5. Duplicate descriptions
  const seen = new Map<string, number[]>();
  for (const i of items) {
    const key = i.description.trim().toLowerCase();
    seen.set(key, [...(seen.get(key) ?? []), i.id]);
  }
  const dups = [...seen.values()].filter((ids) => ids.length > 1).flat();
  if (dups.length > 0) {
    issues.push({
      severity: 'warning', code: 'DUPLICATE_DESC',
      messageEn: `${dups.length} item(s) share identical descriptions — possible double-counting.`,
      messageAr: `${dups.length} بند بوصف مكرر — احتمال تكرار في الحصر.`,
      itemIds: dups,
    });
  }

  // 6. Rate outliers within each package (z-score)
  const outliers: number[] = [];
  for (const pkg of packages) {
    const priced = pkg.itemIds.map((id) => byItem.get(id)!).filter((i) => i.rate !== null && i.rate > 0);
    if (priced.length < 5) continue;
    const rates = priced.map((i) => i.rate!);
    const mean = rates.reduce((s, r) => s + r, 0) / rates.length;
    const sd = Math.sqrt(rates.reduce((s, r) => s + (r - mean) ** 2, 0) / rates.length);
    if (sd === 0) continue;
    for (const i of priced) if ((i.rate! - mean) / sd > OUTLIER_Z) outliers.push(i.id);
  }
  if (outliers.length > 0) {
    issues.push({
      severity: 'warning', code: 'RATE_OUTLIER',
      messageEn: `${outliers.length} item(s) with rates >${OUTLIER_Z}σ above their package mean.`,
      messageAr: `${outliers.length} بند بأسعار أعلى من متوسط الحزمة بأكثر من ${OUTLIER_Z} انحراف معياري.`,
      itemIds: outliers,
    });
  }

  return issues;
}

export function hasBlockingErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
