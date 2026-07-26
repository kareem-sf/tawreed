// Tolerant spreadsheet reader — the rescue path for anything the strict ExcelJS reader cannot open.
// Reads every format the SheetJS engine understands (legacy .xls, .ods, .csv, .xlsb, malformed .xlsx)
// and rebuilds a plain ExcelJS workbook so the existing BOQ analysis runs unchanged.
import * as XLSX from '@e965/xlsx';
import * as codepageModule from '@e965/xlsx/dist/cpexcel';
import ExcelJS from 'exceljs';

const codepageExports = codepageModule as unknown as {
  cptable: Record<number, unknown>;
  utils: unknown;
};
if (typeof XLSX.set_cptable === 'function') {
  XLSX.set_cptable({
    ...codepageExports.cptable,
    utils: codepageExports.utils,
  });
}

/** Thrown when a workbook is encrypted and the community engine cannot open it without a password. */
export class EncryptedWorkbookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptedWorkbookError';
  }
}

const INVALID_SHEET_CHARS = /[\[\]:*?/\\]/g;

function safeSheetName(raw: string, used: Set<string>, index: number): string {
  const base = (raw.replace(INVALID_SHEET_CHARS, ' ').trim() || `Sheet${index + 1}`).slice(0, 31);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    const tail = `~${suffix}`;
    candidate = base.slice(0, 31 - tail.length) + tail;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function isEncryptionError(error: unknown): boolean {
  return error instanceof Error && /encrypt|password|cipher/i.test(error.message);
}

/** Strict UTF-8 check — Arabic CSVs saved as Windows-1256 without a BOM fail this and need a codepage. */
function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read any spreadsheet the tolerant engine supports and return an in-memory ExcelJS workbook
 * holding the same cell values. Styling is intentionally dropped — the rescue path
 * favors recovering data over preserving formatting. Cells covered by a merge range are
 * forward-filled with the top-left value so merged rows survive downstream analysis.
 */
export function readSpreadsheetToWorkbook(bytes: Uint8Array): ExcelJS.Workbook {
  let source: XLSX.WorkBook;
  try {
    // A file that is not valid UTF-8 may be a legacy Arabic text export (Windows-1256, no BOM).
    source = XLSX.read(bytes, isValidUtf8(bytes) ? { type: 'array' } : { type: 'array', codepage: 1256 });
  } catch (error) {
    if (isEncryptionError(error)) {
      throw new EncryptedWorkbookError(
        'This workbook is password-protected. Remove the password in Excel (File → Info → Protect Workbook) and save a copy, then try again.',
      );
    }
    throw error;
  }

  const target = new ExcelJS.Workbook();
  const usedNames = new Set<string>();
  source.SheetNames.forEach((name, index) => {
    const sheet = source.Sheets[name];
    if (!sheet) return;
    // sheet_to_json yields null for merge-covered cells; forward-fill the top-left value so
    // items keyed by vertically merged unit/description cells are not dropped by the analysis.
    for (const merge of sheet['!merges'] ?? []) {
      const topLeft = sheet[XLSX.utils.encode_cell(merge.s)];
      if (!topLeft) continue;
      for (let r = merge.s.r; r <= merge.e.r; r++) {
        for (let c = merge.s.c; c <= merge.e.c; c++) {
          if (r === merge.s.r && c === merge.s.c) continue;
          const ref = XLSX.utils.encode_cell({ r, c });
          if (!sheet[ref]) sheet[ref] = { t: topLeft.t, v: topLeft.v, w: topLeft.w };
        }
      }
    }
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: false });
    if (!rows.length) return;
    const worksheet = target.addWorksheet(safeSheetName(name, usedNames, index));
    for (const row of rows) worksheet.addRow(row as ExcelJS.CellValue[]);
  });

  if (target.worksheets.length === 0) {
    throw new Error('No readable worksheet data was found in this file.');
  }
  return target;
}
