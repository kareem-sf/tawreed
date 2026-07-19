import { describe, it, expect } from 'vitest';
import { inspectWorkbook } from '../engine/ingest';
import {
  enFixture, arFixture, noTotalFixture, offerStyleFixture, unknownStructureFixture,
  commentsFixture, EN_ROWS, AR_ROWS,
} from './fixtures';

describe('inspectWorkbook', () => {
  it('parses an English BOQ past title rows and a decoy sheet', async () => {
    const res = await inspectWorkbook(await enFixture(), 'en.xlsx');
    expect(res.sheetName).toBe('BOQ');
    expect(res.headerRow).toBe(3); // two title rows above
    expect(res.items).toHaveLength(EN_ROWS.length);
    expect(res.items[0].description).toContain('concrete');
    expect(res.items[0].unit).toBe('m3');
    expect(res.items[1].unit).toBe('ton');
    expect(res.mapping.confidence).toBeGreaterThan(0.4);
  });

  it('parses an Arabic BOQ with RTL headers', async () => {
    const res = await inspectWorkbook(await arFixture(), 'ar.xlsx');
    expect(res.items).toHaveLength(AR_ROWS.length);
    expect(res.items[0].unit).toBe('m3'); // م3
    expect(res.items[1].unit).toBe('ton'); // طن
    expect(res.items[0].total).toBe(666000);
  });

  it('computes totals when the total column is missing', async () => {
    const res = await inspectWorkbook(await noTotalFixture(), 'nototal.xlsx');
    expect(res.items[0].total).toBe(240 * 3650);
    expect(res.warnings.some((w) => w.includes('total'))).toBe(true);
  });

  it('preserves source row numbers for traceability', async () => {
    const res = await inspectWorkbook(await enFixture(), 'en.xlsx');
    expect(res.items[0].row).toBe(4);
  });

  it('discovers an offer table after row 25 with merged multi-row headers and repeated section headers', async () => {
    const res = await inspectWorkbook(await offerStyleFixture(), 'Offer.xlsx');
    expect(res.sheetName).toBe('Price Offer');
    expect(res.headerRow).toBe(32);
    expect(res.items).toHaveLength(4);
    expect(res.items.map((i) => i.description)).toContain('Supply and install porcelain floor tiles');
    expect(res.items[0].qty).toBe(12);
    expect(res.items[0].rate).toBe(4100);
    expect(res.items[0].total).toBe(49200);
  });

  it('infers reordered columns from unknown headers and arithmetic relationships', async () => {
    const res = await inspectWorkbook(await unknownStructureFixture(), 'unknown.xlsx');
    expect(res.items).toHaveLength(4);
    expect(res.mapping.description).toBe(3);
    expect(res.mapping.unit).toBe(2);
    expect(res.mapping.qty).toBe(4);
    expect(res.mapping.total).toBe(5);
    expect(res.mapping.rate).toBe(6);
    expect(res.items[3].total).toBe(560000);
    expect(res.warnings.some((w) => w.includes('inferred'))).toBe(true);
  });

  it('keeps only quantified items and attaches BOQ comments to their related items', async () => {
    const res = await inspectWorkbook(await commentsFixture(), 'comments.xlsx');
    expect(res.items).toHaveLength(2);
    expect(res.items.map((item) => item.code)).toEqual(['C-01', 'E-01']);
    expect(res.items.every((item) => item.description && item.unitLabel && item.qty > 0)).toBe(true);
    expect(res.mapping.remarks).toBe(7);
    expect(res.items[0].comments).toEqual(expect.arrayContaining([
      'Note: concrete works include all required testing',
      'Use approved ready-mix supplier',
      'Coordinate pours with the structural consultant',
      'Remark: protect completed concrete until handover',
    ]));
    expect(res.items[1].comments).toEqual(expect.arrayContaining([
      'Allow for identification labels at both ends',
      'Comment: final cable routes require engineer approval',
    ]));
  });

  it('throws a clear error on a workbook with no BOQ header', async () => {
    const wb = new (await import('exceljs')).default.Workbook();
    const ws = wb.addWorksheet('Data');
    ws.addRow(['just', 'some', 'random', 'words']);
    ws.addRow([1, 2, 3, 4]);
    const buf = await wb.xlsx.writeBuffer();
    await expect(inspectWorkbook(new Uint8Array(buf as ArrayBuffer), 'bad.xlsx')).rejects.toThrow(/BOQ table/i);
  });
});
