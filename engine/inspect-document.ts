import type { InspectionResult } from '../shared/types';
import type { PdfProgress } from './pdf-ingest';

export interface InspectDocumentOptions {
  onProgress?: (progress: PdfProgress) => void;
}

export function detectDocumentKind(bytes: Uint8Array, fileName: string): 'xlsx' | 'pdf' {
  const lower = fileName.toLowerCase();
  const pdfMagic = bytes.length >= 5 && new TextDecoder('ascii').decode(bytes.subarray(0, 5)) === '%PDF-';
  const zipMagic = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]);
  if (pdfMagic && lower.endsWith('.pdf')) return 'pdf';
  if (zipMagic && lower.endsWith('.xlsx')) return 'xlsx';
  throw new Error('The selected file is not a valid .xlsx workbook or PDF document.');
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
  const { inspectWorkbook } = await import('./ingest');
  return inspectWorkbook(bytes, fileName);
}
