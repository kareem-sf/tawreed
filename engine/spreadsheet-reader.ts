// Tolerant spreadsheet reader — the rescue path for anything the strict ExcelJS reader cannot open.
// Reads every format the SheetJS engine understands (legacy .xls, .ods, .csv, .xlsb, malformed .xlsx)
// and rebuilds a plain ExcelJS workbook so the existing BOQ analysis runs unchanged.
import * as XLSX from '@e965/xlsx';
import ExcelJS from 'exceljs';

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

/**
 * Read any spreadsheet the tolerant engine supports and return an in-memory ExcelJS workbook
 * holding the same cell values. Styling/merges are intentionally dropped — the rescue path
 * favors recovering data over preserving formatting.
 */
export function readSpreadsheetToWorkbook(bytes: Uint8Array): ExcelJS.Workbook {
  let source: XLSX.WorkBook;
  try {
    source = XLSX.read(bytes, { type: 'array' });
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
