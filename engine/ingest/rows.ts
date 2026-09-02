// Row-level classification: locating the contiguous block of "data-like" rows that
// make up the BOQ table, plus the summary/comment text heuristics used to decide
// whether a given row is a real line item, a total, or a note.
import ExcelJS from 'exceljs';
import type { BoqItem } from '../../shared/types';
import { canonicalUnit, normalizeText } from '../normalize';
import { filterMeaningfulComments } from '../document-intelligence';
import { cellText, cellNumber, isNumericLike } from './cells';
import { MAX_DATA_ROW } from './constants';

const TOTAL_WORDS = [
  'total', 'subtotal', 'sub total', 'grand total', 'carried forward', 'brought forward', 'page total',
  'الاجمالي', 'الإجمالي', 'المجموع', 'اجمالي الصفحه', 'منقول',
].map(normalizeText);

export interface RowShape {
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

export interface DataBlock { start: number; end: number; rows: number[]; }

export function findDataBlock(sheet: ExcelJS.Worksheet, minRow = 1): DataBlock | null {
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

export function isSummaryDescription(text: string): boolean {
  const normalized = normalizeText(text);
  return TOTAL_WORDS.some((word) => normalized === word || normalized.startsWith(`${word} `));
}

const COMMENT_PREFIXES = [
  'note', 'notes', 'remark', 'remarks', 'comment', 'comments', 'clarification', 'exclusion',
  'ملاحظه', 'ملاحظات', 'تعليق', 'تعليقات', 'تنويه', 'ملحوظه', 'استثناء',
].map(normalizeText);

export function isExplicitComment(text: string): boolean {
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

export function uniqueComments(values: string[]): string[] {
  return filterMeaningfulComments(values);
}

export function rowNotes(row: ExcelJS.Row): string[] {
  const notes: string[] = [];
  row.eachCell({ includeEmpty: true }, (cell) => {
    const text = noteText(cell.note);
    if (text) notes.push(text);
  });
  return notes;
}

export function addComments(item: BoqItem, comments: string[]) {
  const merged = uniqueComments([...(item.comments ?? []), ...comments]);
  if (merged.length) item.comments = merged;
}
