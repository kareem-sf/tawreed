import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { inspectWorkbook } from '../engine/ingest';
import {
  enFixture, arFixture, noTotalFixture, offerStyleFixture, unknownStructureFixture,
  commentsFixture, makeWorkbook, EN_ROWS, AR_ROWS,
} from './fixtures';

describe('inspectWorkbook', () => {
  it('parses an English BOQ past title rows and a decoy sheet', async () => {
    const res = await inspectWorkbook(await enFixture(), 'en.xlsx');
    expect(res.sheetName).toBe('BOQ');
    expect(res.headerRow).toBe(3); // two title rows above
    expect(res.items).toHaveLength(EN_ROWS.length);
    expect(res.items[0]!.description).toContain('concrete');
    expect(res.items[0]!.unit).toBe('m3');
    expect(res.items[1]!.unit).toBe('ton');
    expect(res.mapping.confidence).toBeGreaterThan(0.4);
  });

  it('parses an Arabic BOQ with RTL headers', async () => {
    const res = await inspectWorkbook(await arFixture(), 'ar.xlsx');
    expect(res.items).toHaveLength(AR_ROWS.length);
    expect(res.items[0]!.unit).toBe('m3'); // م3
    expect(res.items[1]!.unit).toBe('ton'); // طن
    expect(res.items[0]!.total).toBe(666000);
  });

  it('computes totals when the total column is missing', async () => {
    const res = await inspectWorkbook(await noTotalFixture(), 'nototal.xlsx');
    expect(res.items[0]!.total).toBe(240 * 3650);
    expect(res.warnings.some((w) => w.includes('total'))).toBe(true);
  });

  it('preserves source row numbers for traceability', async () => {
    const res = await inspectWorkbook(await enFixture(), 'en.xlsx');
    expect(res.items[0]!.row).toBe(4);
  });

  it('discovers an offer table after row 25 with merged multi-row headers and repeated section headers', async () => {
    const res = await inspectWorkbook(await offerStyleFixture(), 'Offer.xlsx');
    expect(res.sheetName).toBe('Price Offer');
    expect(res.headerRow).toBe(32);
    expect(res.items).toHaveLength(4);
    expect(res.items.map((i) => i.description)).toContain('Supply and install porcelain floor tiles');
    expect(res.items[0]!.qty).toBe(12);
    expect(res.items[0]!.rate).toBe(4100);
    expect(res.items[0]!.total).toBe(49200);
  });

  it('infers reordered columns from unknown headers and arithmetic relationships', async () => {
    const res = await inspectWorkbook(await unknownStructureFixture(), 'unknown.xlsx');
    expect(res.items).toHaveLength(4);
    expect(res.mapping.description).toBe(3);
    expect(res.mapping.unit).toBe(2);
    expect(res.mapping.qty).toBe(4);
    expect(res.mapping.total).toBe(5);
    expect(res.mapping.rate).toBe(6);
    expect(res.items[3]!.total).toBe(560000);
    expect(res.warnings.some((w) => w.includes('inferred'))).toBe(true);
  });

  it('keeps only quantified items and attaches BOQ comments to their related items', async () => {
    const res = await inspectWorkbook(await commentsFixture(), 'comments.xlsx');
    expect(res.items).toHaveLength(2);
    expect(res.items.map((item) => item.code)).toEqual(['C-01', 'E-01']);
    expect(res.items.every((item) => item.description && item.unitLabel && item.qty > 0)).toBe(true);
    expect(res.mapping.remarks).toBe(7);
    expect(res.items[0]!.comments).toEqual(expect.arrayContaining([
      'Note: concrete works include all required testing',
      'Use approved ready-mix supplier',
      'Coordinate pours with the structural consultant',
      'Remark: protect completed concrete until handover',
    ]));
    expect(res.items[1]!.comments).toEqual(expect.arrayContaining([
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

  it('keeps negative-quantity rows (deduction lines) instead of filtering them out', async () => {
    const bytes = await makeWorkbook({
      rows: [
        { code: 'A1', description: 'Reinforced concrete C30 for foundations', unit: 'm3', qty: 100, rate: 1000, total: 100000 },
        { code: 'A2', description: 'Deduction for omitted concrete kerb', unit: 'm3', qty: -5, rate: 1000, total: -5000 },
      ],
      headers: ['Item No', 'Description', 'Unit', 'Quantity', 'Rate', 'Amount'],
    });
    const res = await inspectWorkbook(bytes, 'negative.xlsx');
    const deduction = res.items.find((i) => i.code === 'A2')!;
    expect(deduction).toBeTruthy();
    expect(deduction.qty).toBe(-5);
  });

  it('treats formula-injection in a description as inert text', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('BOQ');
    ws.addRow(['Item No', 'Description', 'Unit', 'Quantity', 'Rate', 'Amount']);
    // richText forces ExcelJS to store the leading "=" as literal text, not a formula.
    ws.addRow(['A1', { richText: [{ text: '=HYPERLINK("http://evil.com","Click")' }] }, 'm3', 10, 100, 1000]);
    ws.addRow(['A2', 'Reinforced concrete foundations C35', 'm3', 20, 200, 4000]);
    const buf = await wb.xlsx.writeBuffer();
    const res = await inspectWorkbook(new Uint8Array(buf as ArrayBuffer), 'inject.xlsx');
    const injected = res.items.find((i) => i.code === 'A1')!;
    expect(injected).toBeTruthy();
    expect(injected.description).toBe('=HYPERLINK("http://evil.com","Click")');
    expect(injected.description).toContain('HYPERLINK');
  });

  it('reads a #REF! rate cell as null rather than a number', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('BOQ');
    ws.addRow(['Item No', 'Description', 'Unit', 'Quantity', 'Rate', 'Amount']);
    // Leave the amount blank too so the rate is not back-computed from qty × total.
    ws.addRow(['A1', 'Reinforced concrete foundations C35', 'm3', 10, '#REF!', null]);
    ws.addRow(['A2', 'High-yield rebar B500DWR supply & fix', 'ton', 4, 200, 800]);
    const buf = await wb.xlsx.writeBuffer();
    const res = await inspectWorkbook(new Uint8Array(buf as ArrayBuffer), 'ref.xlsx');
    const broken = res.items.find((i) => i.code === 'A1')!;
    expect(broken).toBeTruthy();
    expect(broken.rate).toBeNull();
  });

  it('excludes hidden rows from the extracted items', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('BOQ');
    ws.addRow(['Item No', 'Description', 'Unit', 'Quantity', 'Rate', 'Amount']);
    ws.addRow(['A1', 'Reinforced concrete foundations C35', 'm3', 10, 1000, 10000]);
    const hidden = ws.addRow(['A2', 'Hidden omitted line item', 'm3', 5, 200, 1000]);
    hidden.hidden = true;
    ws.addRow(['A3', 'High-yield rebar B500 supply and fix', 'ton', 4, 300, 1200]);
    const buf = await wb.xlsx.writeBuffer();
    const res = await inspectWorkbook(new Uint8Array(buf as ArrayBuffer), 'hidden.xlsx');
    expect(res.items.map((i) => i.code)).toEqual(['A1', 'A3']);
    expect(res.items.some((i) => i.description.includes('Hidden'))).toBe(false);
  });

  it('does not emit a truncation warning for small workbooks', async () => {
    const res = await inspectWorkbook(await enFixture(), 'en.xlsx');
    expect(res.warnings.some(w => w.includes('10,000') || w.includes('10000'))).toBe(false);
  });

  it('ingests a single-item BOQ', async () => {
    const bytes = await makeWorkbook({
      rows: [{ code: 'A1', description: 'Reinforced concrete C30', unit: 'm3', qty: 10, rate: 1000, total: 10000 }],
      headers: ['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Total'],
    });
    const res = await inspectWorkbook(bytes, 'single.xlsx');
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.description).toContain('concrete');
  });

  it('keeps items with unit "other" when no unit column is detected', async () => {
    const bytes = await makeWorkbook({
      rows: [
        { code: 'A1', description: 'Reinforced concrete foundations C35', unit: 'm3', qty: 10, rate: 1000, total: 10000 },
        { code: 'A2', description: 'High-yield rebar B500 supply and fix', unit: 'ton', qty: 4, rate: 200, total: 800 },
      ],
      headers: ['Ref', 'Description', 'Qty', 'Rate', 'Amount'], // no unit header
    });
    const res = await inspectWorkbook(bytes, 'nunit.xlsx');
    expect(res.items.length).toBeGreaterThan(0);
  });
});
