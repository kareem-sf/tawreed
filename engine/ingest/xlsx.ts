// XLSX format detector and top-level orchestrator: picks the best-scoring sheet/table
// candidate in a workbook and assembles the final InspectionResult.
import ExcelJS from 'exceljs';
import type { BoqItem, ColumnMapping, InspectionResult, SourceKind } from '../../shared/types';
import { normalizeText } from '../normalize';
import {
  detectDocumentLanguage, detectProjectName,
  type ProjectNameCandidate,
} from '../document-intelligence';
import { cellText } from './cells';
import { detectHeaders } from './headers';
import { findDataBlock } from './rows';
import { inferMapping } from './columns';
import { extractItems } from './extract';
import { MAX_DATA_ROW } from './constants';

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
    const workbookBytes = bytes instanceof Uint8Array ? Uint8Array.from(bytes).buffer : bytes;
    await wb.xlsx.load(workbookBytes);
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
