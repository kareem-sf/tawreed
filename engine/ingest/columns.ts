// Column-level profiling and arithmetic inference: figures out which columns hold
// qty/rate/total (and description/unit/code) purely from the shape of the data,
// used both to seed a lexical header hit and as the headerless fallback.
import ExcelJS from 'exceljs';
import type { ColumnMapping } from '../../shared/types';
import { canonicalUnit, normalizeText } from '../normalize';
import { cellText, cellNumber, isNumericLike } from './cells';
import { MAX_INFER_COLUMNS } from './constants';
import type { DataBlock } from './rows';

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

export function inferMapping(
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
