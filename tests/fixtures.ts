// Fixture builders — synthetic BOQ workbooks covering real-world messiness.
import ExcelJS from 'exceljs';

export interface FixtureRow {
  code: string;
  description: string;
  unit: string;
  qty: number;
  rate?: number | null;
  total?: number | null;
}

export const EN_ROWS: FixtureRow[] = [
  { code: 'A1', description: 'Reinforced concrete C30 for foundations', unit: 'm3', qty: 240, rate: 3650, total: 876000 },
  { code: 'A2', description: 'High-yield rebar B500DWR supply & fix', unit: 'ton', qty: 38, rate: 40500, total: 1539000 },
  { code: 'A3', description: 'Cement block walls 200mm internal', unit: 'm2', qty: 1400, rate: 280, total: 392000 },
  { code: 'A4', description: 'Interior emulsion paint 3 coats', unit: 'm2', qty: 3200, rate: 95, total: 304000 },
  { code: 'A5', description: 'Aluminium windows thermal break', unit: 'm2', qty: 180, rate: 6400, total: 1152000 },
  { code: 'A6', description: 'Bituminous membrane 4mm torch-applied', unit: 'm2', qty: 520, rate: 380, total: 197600 },
  { code: 'A7', description: 'PPR water supply network incl insulation', unit: 'm', qty: 900, rate: 470, total: 423000 },
  { code: 'A8', description: 'VRF air conditioning system', unit: 'TR', qty: 42, rate: 73000, total: 3066000 },
  { code: 'A9', description: 'Power cabling XLPE/SWA laid & terminated', unit: 'm', qty: 2400, rate: 690, total: 1656000 },
  { code: 'A10', description: 'Interlock paving 80mm external', unit: 'm2', qty: 800, rate: 320, total: 256000 },
  { code: 'A11', description: 'Zqx unrecognizable item with no keywords', unit: 'nr', qty: 5, rate: 100, total: 500 },
];

export const AR_ROWS: FixtureRow[] = [
  { code: 'ب1', description: 'خرسانة مسلحة للقواعد', unit: 'م3', qty: 180, rate: 3700, total: 666000 },
  { code: 'ب2', description: 'حديد تسليح عالي المقاومة', unit: 'طن', qty: 25, rate: 41000, total: 1025000 },
  { code: 'ب3', description: 'مباني بلوك أسمنتي 20 سم', unit: 'م2', qty: 900, rate: 300, total: 270000 },
  { code: 'ب4', description: 'دهانات داخلية ثلاثة أوجه', unit: 'م2', qty: 2100, rate: 100, total: 210000 },
  { code: 'ب5', description: 'أعمال سباكة تغذية وصرف', unit: 'م', qty: 600, rate: 500, total: 300000 },
  { code: 'ب6', description: 'كابلات كهرباء جهد منخفض', unit: 'م', qty: 1500, rate: 720, total: 1080000 },
];

export async function makeWorkbook(opts: {
  rows: FixtureRow[];
  headers: string[];
  titleRows?: string[];
  sheetName?: string;
  includeTotal?: boolean;
  extraSheet?: boolean;
}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  if (opts.extraSheet) {
    const notes = wb.addWorksheet('Notes');
    notes.addRow(['This is a notes sheet with no BOQ content.']);
    notes.addRow(['It should not be picked.']);
  }
  const ws = wb.addWorksheet(opts.sheetName ?? 'BOQ');
  for (const t of opts.titleRows ?? []) ws.addRow([t]);
  ws.addRow(opts.headers);
  for (const r of opts.rows) {
    const base: unknown[] = [r.code, r.description, r.unit, r.qty, r.rate ?? null];
    if (opts.includeTotal !== false) base.push(r.total ?? (r.rate != null ? r.qty * r.rate : null));
    ws.addRow(base);
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

export async function enFixture(): Promise<Uint8Array> {
  return makeWorkbook({
    rows: EN_ROWS,
    headers: ['Item No', 'Description', 'Unit', 'Quantity', 'Rate (EGP)', 'Amount (EGP)'],
    titleRows: ['ACME CONTRACTING — TOWER C', 'Bill of Quantities — Rev 3'],
    extraSheet: true,
  });
}

export async function arFixture(): Promise<Uint8Array> {
  return makeWorkbook({
    rows: AR_ROWS,
    headers: ['رقم البند', 'الوصف', 'الوحدة', 'الكمية', 'الفئة', 'الإجمالي'],
    titleRows: ['شركة المقاولات — جدول الكميات'],
  });
}

export async function noTotalFixture(): Promise<Uint8Array> {
  return makeWorkbook({
    rows: EN_ROWS.slice(0, 5),
    headers: ['Code', 'Description', 'Unit', 'Qty', 'Rate'],
    includeTotal: false,
  });
}

export async function largeFixture(n: number): Promise<Uint8Array> {
  const rows: FixtureRow[] = [];
  for (let i = 0; i < n; i++) {
    const src = EN_ROWS[i % 10]!;
    rows.push({ ...src, code: `L${i}`, description: `${src.description} — zone ${i % 12}`, qty: 10 + (i % 50) });
  }
  return makeWorkbook({ rows, headers: ['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Total'] });
}

/** Commercial offer layout: cover sheet, 30 title rows, merged two-row headers, sparse sections. */
export async function offerStyleFixture(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const cover = wb.addWorksheet('Cover');
  cover.addRow(['COMMERCIAL OFFER']);
  cover.addRow(['Client information and tender notes only']);

  const ws = wb.addWorksheet('Price Offer');
  for (let i = 1; i <= 30; i++) ws.addRow([i === 1 ? 'PROJECT COMMERCIAL OFFER' : '']);
  ws.mergeCells('A31:A32');
  ws.mergeCells('B31:B32');
  ws.mergeCells('C31:C32');
  ws.mergeCells('D31:F31');
  ws.getCell('A31').value = 'S/N';
  ws.getCell('B31').value = 'Item Details';
  ws.getCell('C31').value = 'UOM';
  ws.getCell('D31').value = 'Commercial Pricing';
  ws.getCell('D32').value = 'Offered Qty';
  ws.getCell('E32').value = 'Unit Cost';
  ws.getCell('F32').value = 'Extended Price';
  ws.addRow(['01', 'Supply and install reinforced concrete foundations C35', 'm3', 12, 4100, 49200]);
  ws.addRow(['02', 'Supply and install high yield reinforcement steel', 'ton', 6, 42000, 252000]);
  ws.addRow([]);
  ws.addRow(['S/N', 'Item Details', 'UOM', 'Offered Qty', 'Unit Cost', 'Extended Price']);
  ws.addRow(['03', 'Supply and install porcelain floor tiles', 'm2', 140, 780, 109200]);
  ws.addRow(['04', 'Addressable fire alarm devices and commissioning', 'nr', 25, 2400, 60000]);
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

/** No recognizable header vocabulary: roles must be inferred from content and qty × rate = total. */
export async function unknownStructureFixture(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data Export');
  ws.addRow(['Vendor Export']);
  ws.addRow(['Generated fields below']);
  ws.addRow([]);
  ws.addRow(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta']);
  ws.addRow(['X-001', 'm3', 'Reinforced concrete for retaining walls C40', 8, 36000, 4500]);
  ws.addRow(['X-002', 'ton', 'Reinforcing steel bars grade B500', 3, 123000, 41000]);
  ws.addRow([]);
  ws.addRow(['X-003', 'm2', 'External waterproofing membrane system', 18, 7560, 420]);
  ws.addRow(['X-004', 'nr', 'Electrical distribution panel complete', 2, 560000, 280000]);
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

/** Remarks column, native Excel notes, standalone notes, and incomplete non-item rows. */
export async function commentsFixture(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Detailed BOQ');
  ws.addRow(['Code', 'Description', 'Unit', 'Qty', 'Rate', 'Total', 'Remarks']);
  ws.addRow(['', 'Note: concrete works include all required testing', '', '', '', '', '']);
  const concrete = ws.addRow([
    'C-01', 'Reinforced concrete foundations C35', 'm3', 12, 4100, 49200,
    'Use approved ready-mix supplier',
  ]);
  concrete.getCell(2).note = 'Coordinate pours with the structural consultant';
  ws.addRow(['X-01', 'Narrative row without a source unit', '', 3, 20, 60, '']);
  ws.addRow(['', 'Remark: protect completed concrete until handover', '', '', '', '', '']);
  ws.addRow(['X-02', 'Row without source quantity', 'm2', '', 100, '', '']);
  ws.addRow([
    'E-01', 'Low voltage power cabling and termination', 'm', 250, 75, 18750,
    'Allow for identification labels at both ends',
  ]);
  ws.addRow(['', 'Comment: final cable routes require engineer approval', '', '', '', '', '']);
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
