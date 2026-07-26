import type { Workbook } from 'exceljs';
import type { InspectionResult, SourceKind } from '../shared/types';
import type { PdfProgress } from './pdf-ingest';

export interface InspectDocumentOptions {
  onProgress?: (progress: PdfProgress) => void;
}

// Detected by content (magic bytes), not by file name, so a mislabeled file still routes correctly.
export type DocumentKind = 'pdf' | 'xlsx' | 'xls' | 'ods' | 'csv';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // legacy Excel, or an encrypted OOXML container

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return bytes.length >= magic.length && magic.every((value, index) => bytes[index] === value);
}

// The PDF spec allows the "%PDF-" header anywhere within the first 1024 bytes.
function containsPdfMagic(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - PDF_MAGIC.length + 1, 1024);
  for (let offset = 0; offset < limit; offset++) {
    if (PDF_MAGIC.every((value, index) => bytes[offset + index] === value)) return true;
  }
  return false;
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]!);
}

function looksLikeText(bytes: Uint8Array): boolean {
  // UTF-16 text is ~50% NUL bytes and fails the printable check below — sniff the BOM and
  // treat a decodable BOM-tagged document as text without further sampling.
  if (bytes.length >= 4) {
    const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : null;
    if (utf16) return new TextDecoder(utf16).decode(bytes).length > 0;
  }
  const sample = bytes.subarray(0, 1024);
  if (!sample.length) return false;
  let printable = 0;
  for (const byte of sample) {
    // tab / line-feed / carriage-return or printable ASCII; high bytes are tolerated (UTF-8, Arabic).
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d || byte >= 0x20) printable += 1;
  }
  return printable / sample.length >= 0.9;
}

export function detectDocumentKind(bytes: Uint8Array, fileName: string): DocumentKind {
  if (bytes.length === 0) {
    throw new Error('The selected file is empty.');
  }
  if (containsPdfMagic(bytes)) return 'pdf';
  if (isZip(bytes)) return fileName.toLowerCase().endsWith('.ods') ? 'ods' : 'xlsx';
  if (startsWith(bytes, CFB_MAGIC)) return 'xls'; // encrypted OOXML is flagged later with a clear message
  if (looksLikeText(bytes)) return 'csv';
  throw new Error('The selected file is not a valid spreadsheet or PDF document.');
}

export async function inspectDocument(
  bytes: Uint8Array,
  fileName: string,
  options: InspectDocumentOptions = {},
): Promise<InspectionResult> {
  const kind = detectDocumentKind(bytes, fileName);
  if (kind === 'pdf') {
    const { inspectPdf } = await import('./pdf-ingest');
    return inspectPdf(bytes, fileName, { onProgress: options.onProgress, enableOcr: true });
  }

  // Standard .xlsx: try the strict reader first (it preserves styling cues used for project-name detection).
  if (kind === 'xlsx') {
    const { inspectWorkbook, WorkbookParseError } = await import('./ingest');
    try {
      return await inspectWorkbook(bytes, fileName, 'xlsx');
    } catch (error) {
      // Only a load/parse failure justifies the tolerant rescue reader — an analysis error
      // ("no BOQ structure found") is authoritative and must not trigger a second full read.
      if (!(error instanceof WorkbookParseError)) throw error;
    }
  }

  const sourceKind: SourceKind = kind;
  const reader = await import('./spreadsheet-reader');
  const { analyzeLoadedWorkbook } = await import('./ingest');
  let workbook: Workbook;
  try {
    workbook = reader.readSpreadsheetToWorkbook(bytes);
  } catch (error) {
    if (error instanceof reader.EncryptedWorkbookError) throw error;
    throw new Error(
      'This file could not be read. It appears to be corrupt or in an unsupported format.',
      { cause: error },
    );
  }
  return analyzeLoadedWorkbook(workbook, fileName, sourceKind);
}
