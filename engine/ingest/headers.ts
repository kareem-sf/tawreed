// Bilingual (English/Arabic) header-token matching: finds the row(s) that look like
// a BOQ table header and maps each header cell to a ColumnMapping field.
import ExcelJS from 'exceljs';
import type { ColumnMapping } from '../../shared/types';
import { normalizeText } from '../normalize';
import { cellText } from './cells';
import { MAX_HEADER_SCAN, MAX_HEADER_SPAN, MAX_INFER_COLUMNS } from './constants';

export type Field = keyof Omit<ColumnMapping, 'confidence'>;

export const HEADER_TOKENS: Record<Field, string[]> = {
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

export function bestFieldForHeader(text: string, cache: Map<string, string>): { field: Field; score: number } | null {
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

export interface HeaderHit {
  row: number; // final row of a possibly multi-row header
  mapping: ColumnMapping;
  lexicalScore: number;
}

export function detectHeaders(sheet: ExcelJS.Worksheet): HeaderHit[] {
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

export function isHeaderLike(text: string): boolean {
  const normalized = normalizeText(text);
  if (normalized.length > 40) return false;
  const choice = bestFieldForHeader(text, headerTokenCache);
  if (!choice) return false;
  return choice.score >= 6;
}
