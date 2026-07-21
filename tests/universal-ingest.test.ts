import { describe, expect, it } from 'vitest';
import * as XLSX from '@e965/xlsx';
import { detectDocumentKind, inspectDocument } from '../engine/inspect-document';
import { enFixture } from './fixtures';

const BOQ_ROWS: unknown[][] = [
  ['Code', 'Description', 'Unit', 'Qty', 'Rate', 'Total'],
  ['C-01', 'Reinforced concrete foundations C35', 'm3', 12, 4100, 49200],
  ['E-01', 'Low voltage power cabling installation', 'm', 250, 75, 18750],
];

function buildSheetBytes(bookType: 'xls' | 'ods'): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(BOQ_ROWS);
  XLSX.utils.book_append_sheet(wb, ws, 'BOQ');
  return new Uint8Array(XLSX.write(wb, { bookType, type: 'array' }));
}

function buildCsvBytes(): Uint8Array {
  const csv = BOQ_ROWS.map((row) => row.join(',')).join('\n');
  return new TextEncoder().encode(csv);
}

describe('content-based format detection', () => {
  it('detects CSV by text content', () => {
    expect(detectDocumentKind(buildCsvBytes(), 'boq.csv')).toBe('csv');
  });

  it('detects legacy Excel by its CFB container', () => {
    const cfbMagic = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(detectDocumentKind(cfbMagic, 'legacy.xls')).toBe('xls');
  });

  it('detects ODS by ZIP container plus extension', () => {
    const zipMagic = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
    expect(detectDocumentKind(zipMagic, 'boq.ods')).toBe('ods');
  });

  it('rejects an empty file', () => {
    expect(() => detectDocumentKind(new Uint8Array([]), 'empty.xlsx')).toThrow(/empty/i);
  });

  it('rejects unrecognizable binary content', () => {
    expect(() => detectDocumentKind(new Uint8Array([1, 2, 3, 4]), 'junk.dat')).toThrow(/valid/i);
  });
});

describe('universal workbook ingestion', () => {
  it('still reads a standard .xlsx through the strict reader', async () => {
    const result = await inspectDocument(await enFixture(), 'en.xlsx');
    expect(result.sourceKind).toBe('xlsx');
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('reads a CSV BOQ', async () => {
    const result = await inspectDocument(buildCsvBytes(), 'boq.csv');
    expect(result.sourceKind).toBe('csv');
    expect(result.items.map((item) => item.code)).toEqual(['C-01', 'E-01']);
    expect(result.items[0]!.qty).toBe(12);
    expect(result.items[0]!.rate).toBe(4100);
  });

  it('reads a legacy .xls BOQ', async () => {
    const result = await inspectDocument(buildSheetBytes('xls'), 'legacy.xls');
    expect(result.sourceKind).toBe('xls');
    expect(result.items.map((item) => item.code)).toEqual(['C-01', 'E-01']);
  });

  it('reads an .ods BOQ', async () => {
    const result = await inspectDocument(buildSheetBytes('ods'), 'boq.ods');
    expect(result.sourceKind).toBe('ods');
    expect(result.items.map((item) => item.code)).toEqual(['C-01', 'E-01']);
  });

  it('never surfaces the cryptic ExcelJS crash on an unreadable workbook', async () => {
    const corrupt = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(inspectDocument(corrupt, 'broken.xlsx')).rejects.toSatisfy(
      (error) => error instanceof Error && !/sheets/i.test(error.message) && error.message.length > 0,
    );
  });
});
