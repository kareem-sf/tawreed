import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { inspectPdf } from '../engine/pdf-ingest';
import { detectDocumentKind } from '../engine/inspect-document';

async function searchableBoqPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Green Avenue Factory Extension');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([720, 800]);
  page.drawText('Project Name: Green Avenue Factory Extension', { x: 34, y: 755, size: 18, font, color: rgb(0.1, 0.14, 0.2) });
  page.drawText('BILL OF QUANTITIES', { x: 34, y: 725, size: 12, font });
  const columns = [34, 95, 390, 445, 500, 570, 640];
  const headers = ['Code', 'Description', 'Unit', 'Qty', 'Rate', 'Total', 'Remarks'];
  headers.forEach((text, index) => page.drawText(text, { x: columns[index], y: 680, size: 9, font }));
  const rows = [
    ['C-01', 'Reinforced concrete foundations C35', 'm3', '12', '4100', '49200', 'Testing'],
    ['E-01', 'Low voltage power cabling installation', 'm', '250', '75', '18750', 'Labels'],
    ['X-01', 'Incomplete narrative without quantity', 'm2', '', '20', '', 'THANK YOU'],
  ];
  rows.forEach((row, rowIndex) => row.forEach((text, columnIndex) => {
    if (text) page.drawText(text, { x: columns[columnIndex], y: 650 - rowIndex * 28, size: 8, font });
  }));
  return pdf.save();
}

describe('PDF ingestion', () => {
  it('extracts quantified rows and project metadata from a searchable PDF', async () => {
    const bytes = await searchableBoqPdf();
    const result = await inspectPdf(bytes, 'factory-boq.pdf', { enableOcr: false });
    expect(result.sourceKind).toBe('pdf');
    expect(result.pageCount).toBe(1);
    expect(result.ocrPages).toBe(0);
    expect(result.projectName).toBe('Green Avenue Factory Extension');
    expect(result.items.map((item) => item.code)).toEqual(['C-01', 'E-01']);
    expect(result.items[0]!.qty).toBe(12);
    expect(result.items[0]!.unitLabel).toBe('m3');
    expect(result.items[0]!.comments).toContain('Testing');
    expect(result.items.flatMap((item) => item.comments ?? [])).not.toContain('THANK YOU');
  }, 20_000);

  it('validates PDF and XLSX signatures rather than trusting extensions', async () => {
    const pdf = await searchableBoqPdf();
    expect(detectDocumentKind(pdf, 'offer.pdf')).toBe('pdf');
    expect(() => detectDocumentKind(new Uint8Array([1, 2, 3]), 'offer.pdf')).toThrow(/valid/i);
  });

  it('rejects PDFs that exceed the 250-page processing limit', async () => {
    const pdf = await PDFDocument.create();
    for (let i = 0; i < 251; i++) pdf.addPage([200, 200]);
    const bytes = await pdf.save();
    await expect(inspectPdf(bytes, 'huge.pdf', { enableOcr: false })).rejects.toThrow(/250/);
  }, 60_000);

  it('routes a ZIP-signed file by content even with a .pdf extension', () => {
    const zipMagic = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    expect(detectDocumentKind(zipMagic, 'sheet.pdf')).toBe('xlsx');
  });

  it('routes a PDF-signed file by content even with an .xlsx extension', () => {
    const pdfMagic = new TextEncoder().encode('%PDF-1.4\n%trailing bytes');
    expect(detectDocumentKind(pdfMagic, 'sheet.xlsx')).toBe('pdf');
  });

  it('accepts .xlsm files as xlsx', () => {
    const zipMagic = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    expect(detectDocumentKind(zipMagic, 'macro.xlsm')).toBe('xlsx');
  });
});
