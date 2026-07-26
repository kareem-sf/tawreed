// Dynamic XLSX ingestion: discovers a BOQ table from workbook structure, not a fixed template.
import ExcelJS from 'exceljs';
import type { BoqItem, ColumnMapping, InspectionResult, SourceKind, Unit } from '../shared/types';
import { canonicalUnit, normalizeText, parseNumber } from './normalize';
import {
  detectDocumentLanguage, detectProjectName, filterMeaningfulComments,
  type ProjectNameCandidate,
} from './document-intelligence';

type Field = keyof Omit<ColumnMapping, 'confidence'>;

const HEADER_TOKENS: Record<Field, string[]> = {
  code: [
    'code', 'item no', 'item number', 'line no', 'line number', 'serial no', 'serial',
    's/n', 'sr no', 'reference', 'ref', 'boq no', 'رقم البند', 'رقم', 'كود', 'الرقم', 'مرجع',
  ],
  description: [
    'description', 'item description', 'work description', 'item details', 'details', 'scope of work',
    'scope', 'particulars', 'specification', 'designation', 'activity', 'material description', 'service description',
    'الوصف', 'وصف البند', 'البيان', 'تفاصيل البند', 'تفاصيل', 'الاعمال', 'الأعمال', 'المواصفات', 'الصنف',
  ],
  unit: [
    'unit of measure', 'unit', 'uom', 'u/m', 'measure', 'measuring unit', 'الوحدة', 'وحده', 'وحدة القياس',
  ],
  qty: [
    'quantity', 'qty', 'offered qty', 'boq qty', 'bill qty', 'estimated qty', 'tender qty',
    'الكمية', 'كميه', 'كمية العقد', 'كمية',
  ],
  rate: [
    'unit rate', 'unit price', 'unit cost', 'rate', 'price', 'cost per unit', 'offered rate',
    'السعر', 'سعر الوحدة', 'الفئة', 'فئة', 'السعر الافرادي', 'تكلفة الوحدة',
  ],
  total: [
    'extended price', 'line total', 'total amount', 'total price', 'net amount', 'amount', 'total', 'value',
    'extension', 'الإجمالي', 'الاجمالي', 'اجمالي السعر', 'المبلغ', 'القيمة', 'المجموع',
  ],
  remarks: [
    'remarks', 'remark', 'comments', 'comment', 'notes', 'note', 'clarification', 'exclusions',
    'ملاحظات', 'ملاحظة', 'تعليقات', 'تعليق', 'بيان توضيحي', 'استثناءات',
  ],
};

const headerTokenCache = new Map<string, string>();

const MAX_HEADER_SCAN = 100;
const MAX_HEADER_SPAN = 3;
const MAX_INFER_COLUMNS = 80;
const MAX_DATA_ROW = 10_000;
const TOTAL_WORDS = [
  'total', 'subtotal', 'sub total', 'grand total', 'carried forward', 'brought forward', 'page total',
  'الاجمالي', 'الإجمالي', 'المجموع', 'اجمالي الصفحه', 'منقول',
].map(normalizeText);

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return v.result != null ? String(v.result) : '';
    if (v instanceof Date) return '';
    return '';
  }
  return String(v);
}

function cellNumber(v: ExcelJS.CellValue): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && v !== null && 'result' in v) {
    const r = (v as { result?: unknown }).result;
    if (typeof r === 'number') return Number.isFinite(r) ? r : null;
    if (typeof r === 'string') return cellNumber(r); // re-route through the text path
    return null;
  }
  const text = cellText(v).trim();
  if (!text) return null;
  // Never turn embedded specification digits ("Concrete C30", "Cable 4x25") into prices.
  const numericText = text
    .replace(/\b(?:egp|usd|eur|gbp|sar|aed|qar|kwd|omr)\b/gi, '')
    .replace(/(?:ج\.?\s?م|ريال|دولار|درهم)/g, '')
    .trim();
  if (!/^[\d٠-٩۰-۹\s.,٬٫()\-+%]+$/.test(numericText)) return null;
  return parseNumber(numericText);
}

/** Shared numeric classifier — aligned with cellNumber's currency stripping + Arabic-Indic digit/separator handling. */
function isNumericLike(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === 'number') return Number.isFinite(raw);
  if (typeof raw === 'object' && raw !== null && 'result' in raw) return isNumericLike((raw as Record<string, unknown>).result);
  const text = String(raw).trim();
  if (!text) return false;
  // Strip the same currency tokens as cellNumber, then separators/symbols (incl. Arabic decimal ٫ and thousands ٬)
  const stripped = text
    .replace(/\b(?:egp|usd|eur|gbp|sar|aed|qar|kwd|omr)\b/gi, '')
    .replace(/(?:ج\.?\s?م|ريال|دولار|درهم)/g, '')
    .replace(/[\s,.$€£¥%()\-+٬٫]/g, '')
    .replace(/[ًٌٍَُِّْـ]/g, '');
  return /^[\d٠-٩۰-۹.]+$/.test(stripped) && stripped.length > 0;
}

function cleanHeader(raw: string): string {
  return normalizeText(raw).replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function tokenScore(raw: string, token: string, cache: Map<string, string>): number {
  const text = cache.get(raw) ?? cleanHeader(raw);
  cache.set(raw, text);
  const wanted = cache.get(token) ?? cleanHeader(token);
  cache.set(token, wanted);
  if (!text || !wanted) return 0;
  if (text === wanted) return 8;
  if (wanted.length >= 4 && text.includes(wanted)) return 5;
  const words = new Set(text.split(' '));
  if (wanted.length >= 2 && words.has(wanted)) return 3;
  return 0;
}

function bestFieldForHeader(text: string, cache: Map<string, string>): { field: Field; score: number } | null {
  let best: { field: Field; score: number } | null = null;
  for (const [field, tokens] of Object.entries(HEADER_TOKENS) as [Field, string[]][]) {
    const score = Math.max(0, ...tokens.map((token) => tokenScore(text, token, cache)));
    if (score > 0 && (!best || score > best.score)) best = { field, score };
  }
  return best;
}

function combinedHeaderText(sheet: ExcelJS.Worksheet, start: number, end: number, col: number): string {
  const unique = new Set<string>();
  for (let row = start; row <= end; row++) {
    const text = cellText(sheet.getRow(row).getCell(col).value).trim();
    if (text) unique.add(text);
  }
  return [...unique].join(' ');
}

interface HeaderHit {
  row: number; // final row of a possibly multi-row header
  mapping: ColumnMapping;
  lexicalScore: number;
}

function detectHeaders(sheet: ExcelJS.Worksheet): HeaderHit[] {
  const hits: HeaderHit[] = [];
  const last = Math.min(sheet.rowCount, MAX_HEADER_SCAN);
  const maxCol = Math.min(Math.max(sheet.columnCount, sheet.actualColumnCount), MAX_INFER_COLUMNS);
  const cleanCache = new Map<string, string>();

  for (let start = 1; start <= last; start++) {
    for (let span = 1; span <= MAX_HEADER_SPAN && start + span - 1 <= last; span++) {
      const end = start + span - 1;
      const choices = new Map<Field, { col: number; score: number }>();
      for (let col = 1; col <= maxCol; col++) {
        const choice = bestFieldForHeader(combinedHeaderText(sheet, start, end, col), cleanCache);
        if (!choice) continue;
        const current = choices.get(choice.field);
        if (!current || choice.score > current.score) choices.set(choice.field, { col, score: choice.score });
      }
      const desc = choices.get('description');
      if (!desc || choices.size < 2) continue;
      const mapping: ColumnMapping = {
        code: choices.get('code')?.col ?? null,
        description: desc.col,
        unit: choices.get('unit')?.col ?? null,
        qty: choices.get('qty')?.col ?? null,
        rate: choices.get('rate')?.col ?? null,
        total: choices.get('total')?.col ?? null,
        remarks: choices.get('remarks')?.col ?? null,
        confidence: 0,
      };
      const lexicalScore = [...choices.values()].reduce((sum, c) => sum + c.score, 0) + choices.size * 4;
      hits.push({ row: end, mapping, lexicalScore });
    }
  }
  const seen = new Set<string>();
  return hits
    .sort((a, b) => b.lexicalScore - a.lexicalScore)
    .filter((hit) => {
      const key = JSON.stringify(hit.mapping);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

interface RowShape {
  row: number;
  nonEmpty: number;
  textCells: number;
  numericCells: number;
  unitCells: number;
  longestText: number;
}

function rowShape(sheet: ExcelJS.Worksheet, rowNumber: number): RowShape {
  const row = sheet.getRow(rowNumber);
  if (row.hidden) return { row: rowNumber, nonEmpty: 0, textCells: 0, numericCells: 0, unitCells: 0, longestText: 0 };
  let nonEmpty = 0;
  let textCells = 0;
  let numericCells = 0;
  let unitCells = 0;
  let longestText = 0;
  row.eachCell({ includeEmpty: false }, (cell) => {
    const text = cellText(cell.value).trim();
    const number = cellNumber(cell.value);
    if (!text && number === null) return;
    nonEmpty++;
    if (number !== null && isNumericLike(cell.value)) {
      numericCells++;
    } else if (text) {
      textCells++;
      longestText = Math.max(longestText, text.length);
      if (canonicalUnit(text) !== 'other') unitCells++;
    }
  });
  return { row: rowNumber, nonEmpty, textCells, numericCells, unitCells, longestText };
}

function isDataLike(shape: RowShape): boolean {
  return shape.nonEmpty >= 2 && shape.textCells >= 1 && shape.longestText >= 3 &&
    (shape.numericCells >= 1 || shape.unitCells >= 1);
}

interface DataBlock { start: number; end: number; rows: number[]; }

function findDataBlock(sheet: ExcelJS.Worksheet, minRow = 1): DataBlock | null {
  const candidates: number[] = [];
  for (let row = Math.max(1, minRow); row <= Math.min(sheet.rowCount, MAX_DATA_ROW); row++) {
    if (isDataLike(rowShape(sheet, row))) candidates.push(row);
  }
  if (candidates.length < 1) return null;

  const groups: number[][] = [];
  let current: number[] = [];
  for (const row of candidates) {
    if (current.length === 0 || row - current[current.length - 1]! <= 4) current.push(row);
    else { groups.push(current); current = [row]; }
  }
  if (current.length) groups.push(current);
  const best = groups.sort((a, b) => b.length - a.length || (b[b.length - 1]! - b[0]!) - (a[a.length - 1]! - a[0]!))[0];
  if (!best || best.length < 1) return null;
  return { start: best[0]!, end: best[best.length - 1]!, rows: best };
}

interface ColumnStats {
  col: number;
  nonEmpty: number;
  numeric: number;
  text: number;
  units: number;
  codeLike: number;
  integerNumbers: number;
  textLength: number;
  distinct: Set<string>;
  numbers: number[];
}

function profileColumns(sheet: ExcelJS.Worksheet, rows: number[]): ColumnStats[] {
  const maxCol = Math.min(Math.max(sheet.columnCount, sheet.actualColumnCount), MAX_INFER_COLUMNS);
  const stats: ColumnStats[] = Array.from({ length: maxCol }, (_, i) => ({
    col: i + 1, nonEmpty: 0, numeric: 0, text: 0, units: 0, codeLike: 0,
    integerNumbers: 0, textLength: 0, distinct: new Set(), numbers: [],
  }));
  for (const rowNumber of rows) {
    const row = sheet.getRow(rowNumber);
    for (const stat of stats) {
      if (sheet.getColumn(stat.col).hidden) continue;
      const value = row.getCell(stat.col).value;
      const text = cellText(value).trim();
      const number = cellNumber(value);
      if (!text && number === null) continue;
      stat.nonEmpty++;
      if (number !== null && isNumericLike(value)) {
        stat.numeric++;
        stat.numbers.push(number);
        if (Number.isInteger(number)) stat.integerNumbers++;
      } else if (text) {
        stat.text++;
        stat.textLength += text.length;
        stat.distinct.add(normalizeText(text));
        if (canonicalUnit(text) !== 'other') stat.units++;
        if (/^[\p{L}\p{N}][\p{L}\p{N}./_-]{0,20}$/u.test(text)) stat.codeLike++;
      }
    }
  }
  return stats.filter((s) => s.nonEmpty > 0);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function inferArithmeticColumns(
  sheet: ExcelJS.Worksheet,
  rows: number[],
  numericCols: number[],
): { qty: number; rate: number; total: number; score: number } | null {
  // Cell values don't change across candidate triples — read each numeric column once up front.
  const colValues = new Map<number, (number | null)[]>();
  for (const col of numericCols) {
    colValues.set(col, rows.map((r) => cellNumber(sheet.getRow(r).getCell(col).value)));
  }
  let best: { qty: number; rate: number; total: number; score: number } | null = null;
  for (let i = 0; i < numericCols.length; i++) {
    for (let j = i + 1; j < numericCols.length; j++) {
      for (let k = 0; k < numericCols.length; k++) {
        const a = numericCols[i]!, b = numericCols[j]!, total = numericCols[k]!;
        if (total === a || total === b) continue;
        const aVals = colValues.get(a)!, bVals = colValues.get(b)!, tVals = colValues.get(total)!;
        let compared = 0;
        let matched = 0;
        let errorSum = 0;
        for (let ri = 0; ri < rows.length; ri++) {
          const av = aVals[ri], bv = bVals[ri], tv = tVals[ri];
          if (av == null || bv == null || tv == null) continue;
          compared++;
          const error = Math.abs(tv - av * bv) / Math.max(1, Math.abs(tv));
          errorSum += Math.min(error, 10);
          if (error <= 0.03) matched++;
        }
        if (compared < 2) continue;
        const score = matched * 12 + compared * 2 - (errorSum / compared) * 10;
        if (!best || score > best.score) {
          const aValues = aVals.filter((v): v is number => v !== null);
          const bValues = bVals.filter((v): v is number => v !== null);
          const aIntegers = aValues.filter(v => Number.isInteger(v)).length;
          const bIntegers = bValues.filter(v => Number.isInteger(v)).length;
          const aMedian = median(aValues);
          const bMedian = median(bValues);
          // Prefer the column with more integers as qty; break ties by smaller median
          const qty = aIntegers > bIntegers ? a : bIntegers > aIntegers ? b : (aMedian <= bMedian ? a : b);
          best = { qty, rate: qty === a ? b : a, total, score };
        }
      }
    }
  }
  return best && best.score > 15 ? best : null;
}

function inferMapping(
  sheet: ExcelJS.Worksheet,
  block: DataBlock,
  seed?: ColumnMapping,
): ColumnMapping | null {
  const stats = profileColumns(sheet, block.rows);
  if (!stats.length) return null;

  const description = seed?.description || stats
    .filter((s) => s.text >= 1)
    .sort((a, b) => {
      const score = (s: ColumnStats) => {
        const avg = s.textLength / Math.max(1, s.text);
        const unique = s.distinct.size / Math.max(1, s.text);
        const unitPenalty = s.units / Math.max(1, s.text);
        return s.text * Math.min(avg, 80) * unique * (1 - unitPenalty);
      };
      return score(b) - score(a);
    })[0]?.col;
  if (!description) return null;

  const unit = seed?.unit ?? stats
    .filter((s) => s.col !== description && s.units >= 2)
    .sort((a, b) => b.units - a.units)[0]?.col ?? null;

  const numericStats = stats.filter((s) => s.numeric >= Math.max(2, Math.floor(block.rows.length * 0.3)));
  const numericCols = numericStats.map((s) => s.col);
  const arithmetic = numericCols.length >= 3 ? inferArithmeticColumns(sheet, block.rows, numericCols) : null;

  let qty = seed?.qty ?? arithmetic?.qty ?? null;
  let rate = seed?.rate ?? arithmetic?.rate ?? null;
  let total = seed?.total ?? arithmetic?.total ?? null;
  const unused = numericStats
    .filter((s) => ![qty, rate, total].includes(s.col))
    .sort((a, b) => median(a.numbers) - median(b.numbers));
  if (qty === null && unused.length) qty = unused.shift()!.col;
  if (rate === null && unused.length) rate = unused.shift()!.col;
  if (total === null && unused.length) total = unused.pop()!.col;

  const code = seed?.code ?? stats
    .filter((s) => s.col !== description && s.col !== unit && s.col !== seed?.remarks && s.text >= 1)
    .sort((a, b) => {
      const score = (s: ColumnStats) => s.codeLike * (s.distinct.size / Math.max(1, s.text)) - s.textLength / Math.max(1, s.text) * 0.05;
      return score(b) - score(a);
    })[0]?.col ?? null;

  const remarks = seed?.remarks ?? null;
  const found = [code, unit, qty, rate, total, remarks].filter((v) => v !== null).length;
  const confidence = Math.min(0.95, 0.35 + found * 0.09 + (arithmetic ? 0.15 : 0) + (seed ? 0.1 : 0));
  return { code, description, unit, qty, rate, total, remarks, confidence };
}

function isHeaderLike(text: string): boolean {
  const normalized = normalizeText(text);
  if (normalized.length > 40) return false;
  const choice = bestFieldForHeader(text, headerTokenCache);
  if (!choice) return false;
  return choice.score >= 6;
}

function isSummaryDescription(text: string): boolean {
  const normalized = normalizeText(text);
  return TOTAL_WORDS.some((word) => normalized === word || normalized.startsWith(`${word} `));
}

const COMMENT_PREFIXES = [
  'note', 'notes', 'remark', 'remarks', 'comment', 'comments', 'clarification', 'exclusion',
  'ملاحظه', 'ملاحظات', 'تعليق', 'تعليقات', 'تنويه', 'ملحوظه', 'استثناء',
].map(normalizeText);

function isExplicitComment(text: string): boolean {
  const normalized = normalizeText(text).replace(/^[-–—*•:]+\s*/, '');
  return COMMENT_PREFIXES.some((prefix) =>
    normalized === prefix || normalized.startsWith(`${prefix}:`) || normalized.startsWith(`${prefix} `),
  );
}

function noteText(note: string | ExcelJS.Comment | undefined): string {
  if (!note) return '';
  if (typeof note === 'string') return note.trim();
  return (note.texts ?? []).map((part) => part.text).join('').trim();
}

function uniqueComments(values: string[]): string[] {
  return filterMeaningfulComments(values);
}

function rowNotes(row: ExcelJS.Row): string[] {
  const notes: string[] = [];
  row.eachCell({ includeEmpty: true }, (cell) => {
    const text = noteText(cell.note);
    if (text) notes.push(text);
  });
  return notes;
}

function addComments(item: BoqItem, comments: string[]) {
  const merged = uniqueComments([...(item.comments ?? []), ...comments]);
  if (merged.length) item.comments = merged;
}

function extractItems(
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

interface SheetCandidate {
  sheet: ExcelJS.Worksheet;
  headerRow: number;
  mapping: ColumnMapping;
  items: BoqItem[];
  rejectedCount: number;
  score: number;
  inferred: boolean;
}

function candidateScore(items: BoqItem[], mapping: ColumnMapping, lexicalScore: number): number {
  if (items.length < 1) return -Infinity;
  const priced = items.filter((i) => i.total !== null || i.rate !== null).length;
  const distinct = new Set(items.map((i) => normalizeText(i.description))).size;
  const duplicatePenalty = Math.max(0, items.length - distinct) * 3;
  return items.length * 6 + priced * 2 + mapping.confidence * 30 + lexicalScore - duplicatePenalty;
}

function analyzeSheet(sheet: ExcelJS.Worksheet): SheetCandidate | null {
  let best: SheetCandidate | null = null;

  for (const hit of detectHeaders(sheet)) {
    const block = findDataBlock(sheet, hit.row + 1);
    if (!block) continue;
    const mapping = inferMapping(sheet, block, hit.mapping) ?? hit.mapping;
    const { items, rejectedCount } = extractItems(sheet, mapping, hit.row + 1, Math.min(block.end + 5, MAX_DATA_ROW));
    const score = candidateScore(items, mapping, hit.lexicalScore);
    if (!best || score > best.score) {
      best = { sheet, headerRow: hit.row, mapping, items, rejectedCount, score, inferred: false };
    }
  }

  // Headerless / unknown-language fallback: infer the table entirely from its data.
  const block = findDataBlock(sheet);
  if (block) {
    const mapping = inferMapping(sheet, block);
    if (mapping) {
      const { items, rejectedCount } = extractItems(sheet, mapping, block.start, Math.min(block.end + 5, MAX_DATA_ROW));
      const score = candidateScore(items, mapping, 0);
      if (!best || score > best.score) {
        best = { sheet, headerRow: Math.max(0, block.start - 1), mapping, items, rejectedCount, score, inferred: true };
      }
    }
  }
  return best;
}

/** Thrown when the strict ExcelJS reader cannot load the workbook bytes at all (as opposed to finding no BOQ table inside). */
export class WorkbookParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkbookParseError';
  }
}

export async function inspectWorkbook(
  bytes: ArrayBuffer | Uint8Array,
  fileName: string,
  sourceKind: SourceKind = 'xlsx',
): Promise<InspectionResult> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes);
  } catch {
    // ExcelJS throws a cryptic "reading 'sheets'" on malformed xl/workbook.xml; surface a clear, actionable error.
    throw new WorkbookParseError('The standard Excel reader could not open this workbook. It may be corrupt or saved in an unsupported format.');
  }
  return analyzeLoadedWorkbook(wb, fileName, sourceKind);
}

export function analyzeLoadedWorkbook(wb: ExcelJS.Workbook, fileName: string, sourceKind: SourceKind): InspectionResult {
  const candidates: SheetCandidate[] = [];
  wb.eachSheet((sheet) => {
    if (sheet.state === 'veryHidden') return;
    const candidate = analyzeSheet(sheet);
    if (candidate) candidates.push(candidate);
  });
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) {
    throw new Error('Could not infer a BOQ table from this workbook. No sheet contained a repeated description-and-quantity structure.');
  }

  const warnings: string[] = [];
  if (best.inferred) warnings.push('Column roles were inferred from workbook data because no recognized headers were found.');
  if (best.mapping.qty === null) warnings.push('No quantity column detected — rows without source quantities were excluded.');
  if (best.mapping.unit === null) warnings.push('No unit column detected — rows without source units were excluded.');
  if (best.mapping.rate === null) warnings.push('No unit-rate column detected — unpriced lines remain blank.');
  if (best.mapping.total === null && best.mapping.qty !== null && best.mapping.rate !== null) {
    warnings.push('No total column detected — totals were computed as quantity × rate.');
  }
  if (best.mapping.confidence < 0.6) warnings.push('Low structural confidence — review validation warnings before generating.');
  if (best.sheet.rowCount > MAX_DATA_ROW) {
    warnings.push(`Sheet has ${best.sheet.rowCount} rows — only the first ${MAX_DATA_ROW} were scanned.`);
  }

  const projectCandidates: ProjectNameCandidate[] = [];
  if (wb.title) projectCandidates.push({ text: wb.title, source: 'workbook-metadata', prominence: 0.9, order: 0 });
  if (wb.subject) projectCandidates.push({ text: wb.subject, source: 'workbook-metadata', prominence: 0.6, order: 1 });
  projectCandidates.push({ text: best.sheet.name, source: 'sheet-name', prominence: 0.25, order: 10 });
  // Headerless sheets whose data block starts at row 1 have no title region — row 1 is data,
  // so scanning it would turn a long first description into the project name.
  const titleEnd = best.inferred && best.headerRow === 0 ? 0 : Math.max(1, best.headerRow - 1);
  for (let rowNumber = 1; rowNumber <= titleEnd; rowNumber++) {
    const row = best.sheet.getRow(rowNumber);
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = cellText(cell.value).trim();
      if (!text) return;
      projectCandidates.push({
        text,
        source: rowNumber <= 8 ? 'title' : 'header',
        order: rowNumber * 100 + colNumber,
        prominence: Math.min(1, ((cell.font?.size ?? 11) - 8) / 14 + (cell.font?.bold ? 0.2 : 0)),
        fontSize: cell.font?.size,
        bold: cell.font?.bold,
        merged: cell.isMerged,
        row: rowNumber,
        column: colNumber,
      });
    });
  }
  const project = detectProjectName(projectCandidates, fileName);
  const language = detectDocumentLanguage([
    project.value,
    ...best.items.slice(0, 100).flatMap((item) => [item.description, ...(item.comments ?? [])]),
  ]);

  return {
    fileName,
    sourceKind,
    projectName: project.value,
    projectNameConfidence: project.confidence,
    projectNameCandidates: [...new Set(projectCandidates.map((candidate) => candidate.text.trim()).filter(Boolean))].slice(0, 40),
    language,
    pageCount: wb.worksheets.length,
    ocrPages: 0,
    annotationCount: best.items.reduce((sum, item) => sum + (item.comments?.length ?? 0), 0),
    rejectedCount: best.rejectedCount,
    sheetName: best.sheet.name,
    headerRow: best.headerRow,
    mapping: best.mapping,
    items: best.items,
    warnings,
  };
}
