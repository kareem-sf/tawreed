// Single source of truth for an item's display total, so the review screen
// (buildPackages) and the emitted workbooks always agree.
import type { BoqItem } from '../shared/types';

/** Source total when present; else qty × rate rounded to 2dp when a rate exists; else 0. */
export function itemTotal(item: BoqItem): number {
  if (item.total !== null && Number.isFinite(item.total)) return item.total;
  if (item.rate === null || !Number.isFinite(item.rate) || !Number.isFinite(item.qty)) return 0;
  return Math.round(item.qty * item.rate * 100) / 100;
}
