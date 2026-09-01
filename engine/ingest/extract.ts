// Row-by-row extraction of BOQ line items from a resolved ColumnMapping.
import ExcelJS from 'exceljs';
import type { BoqItem, ColumnMapping, Unit } from '../../shared/types';
import { canonicalUnit } from '../normalize';
import { cellText, cellNumber } from './cells';
import { isHeaderLike } from './headers';
import { addComments, isExplicitComment, isSummaryDescription, rowNotes, uniqueComments } from './rows';
import { MAX_DATA_ROW } from './constants';

export function extractItems(
  sheet: ExcelJS.Worksheet,
  mapping: ColumnMapping,
  startRow: number,
  endRow: number,
): { items: BoqItem[]; rejectedCount: number } {
  const items: BoqItem[] = [];
  let rejectedCount = 0;
  let pendingComments: string[] = [];
  for (let r = startRow; r <= Math.min(endRow, MAX_DATA_ROW); r++) {
    const row = sheet.getRow(r);
    if (row.hidden) continue; // hidden rows are excluded from BOQ extraction (and are not counted as rejections)
    const get = (col: number | null) => col === null ? null : row.getCell(col).value;
    const description = cellText(get(mapping.description)).trim();
    const remarks = mapping.remarks !== null ? cellText(get(mapping.remarks)).trim() : '';
    const notes = rowNotes(row);
    const rowComments = uniqueComments([remarks, ...notes]);
    const explicitComment = isExplicitComment(description);
    const qty = cellNumber(get(mapping.qty));
    // "Real content" = a parseable quantity, or a description that is not a structural line
    // (blank / repeated header / summary total / explicit comment) — only those count as rejected.
    const headerLike = isHeaderLike(description);
    const summary = isSummaryDescription(description);
    const meaningful = description ? !headerLike && !summary && !explicitComment : qty !== null;
    if (!description || (headerLike && !explicitComment) || summary) {
      if (meaningful) rejectedCount++;
      if (rowComments.length) {
        if (items.length) addComments(items[items.length - 1]!, rowComments);
        else pendingComments = uniqueComments([...pendingComments, ...rowComments]);
      }
      continue;
    }

    const codeText = mapping.code !== null ? cellText(get(mapping.code)).trim() : '';
    const hasUnitColumn = mapping.unit !== null;
    const rawUnit = get(mapping.unit);
    const unitLabel = hasUnitColumn ? cellText(rawUnit).trim() : 'other';
    const unit: Unit = hasUnitColumn ? canonicalUnit(rawUnit) : 'other';
    let rate = cellNumber(get(mapping.rate));
    let total = cellNumber(get(mapping.total));

    // Procurement items must have a description and a source quantity (negative quantities represent deductions and are kept).
    if ((hasUnitColumn && !unitLabel) || qty === null) {
      if (meaningful) rejectedCount++;
      const comments = uniqueComments([...(explicitComment ? [description] : []), ...rowComments]);
      if (comments.length) {
        if (items.length) addComments(items[items.length - 1]!, comments);
        else pendingComments = uniqueComments([...pendingComments, ...comments]);
      }
      continue;
    }

    let rateDerived = false;
    let totalDerived = false;
    if (rate === null && qty !== null && total !== null && qty !== 0) { rate = total / qty; rateDerived = true; }
    if (total === null && qty !== null && rate !== null) { total = qty * rate; totalDerived = true; }

    const item: BoqItem = {
      id: items.length + 1,
      code: codeText || `${sheet.name}-${r}`,
      description,
      unit,
      unitLabel,
      qty,
      rate,
      total,
      row: r,
    };
    if (rateDerived) item.rateDerived = true;
    if (totalDerived) item.totalDerived = true;
    addComments(item, [...pendingComments, ...rowComments]);
    pendingComments = [];
    items.push(item);
  }
  if (pendingComments.length && items.length) addComments(items[items.length - 1]!, pendingComments);
  return { items, rejectedCount };
}
