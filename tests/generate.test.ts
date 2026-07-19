import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { runPipeline } from '../engine/pipeline';
import {
  buildWorkbook,
  buildWorkbooks,
  masterFileName,
  packageFileName,
  safeFileComponent,
} from '../engine/generate';
import { arFixture, commentsFixture, enFixture, largeFixture } from './fixtures';

function isFormula(value: ExcelJS.CellValue, pattern: RegExp): boolean {
  return !!value && typeof value === 'object' && 'formula' in value &&
    typeof value.formula === 'string' && pattern.test(value.formula);
}

describe('workbook generation', () => {
  it('creates the final Cover layout with project KPIs, no source block, and no Items summary column', async () => {
    const result = await runPipeline(await enFixture(), 'en.xlsx', { useLlm: false });
    const bytes = await buildWorkbook({
      packages: result.packages,
      items: result.inspection.items,
      projectName: 'Green Avenue',
      revision: 1,
      locale: 'en',
      documentLanguage: 'en',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer as ArrayBuffer);
    expect(wb.worksheets[0]!.name).toBe('Cover');
    expect(wb.worksheets.some((sheet) => sheet.name.includes('Validation'))).toBe(false);

    const cover = wb.worksheets[0]!;
    const allText: string[] = [];
    cover.eachRow((row) => row.eachCell((cell) => allText.push(cell.text)));
    const text = allText.join(' ');
    expect(text).toContain('Green Avenue');
    expect(text).toContain('TAWREED');
    expect(text).toContain('ITEMS');
    expect(text).toContain(`© ${new Date().getFullYear()} Tawreed · kareemsafwat.com`);
    expect(text).not.toContain('SOURCE BOQ');
    expect(text).not.toContain('GENERATED');
    expect(text).not.toContain('SCOPE');
    expect(cover.getRow(10).values).toEqual(expect.arrayContaining(['Code', 'Work Package', 'Total', 'Share']));
    expect(cover.getRow(10).values).not.toContain('Items');
  });

  it('creates formula-driven package sheets with A4 portrait print settings', async () => {
    const result = await runPipeline(await enFixture(), 'en.xlsx', { useLlm: false });
    const bytes = await buildWorkbook({
      packages: result.packages,
      items: result.inspection.items,
      projectName: 'Green Avenue',
      revision: 1,
      locale: 'en',
      documentLanguage: 'en',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer as ArrayBuffer);
    const packageSheets = wb.worksheets.filter((sheet) => sheet.name.startsWith('WP-'));
    expect(packageSheets).toHaveLength(result.packages.length);
    let totalCells = 0;
    for (const sheet of packageSheets) {
      expect(sheet.getCell('A1').text).toBe('Green Avenue');
      expect(sheet.pageSetup.paperSize).toBe(9);
      expect(sheet.pageSetup.orientation).toBe('portrait');
      expect(sheet.pageSetup.fitToWidth).toBe(1);
      const sheetText: string[] = [];
      sheet.eachRow((row) => {
        row.eachCell((cell) => sheetText.push(cell.text));
        const cellValue = row.getCell(6).value;
        // Items with source totals get static values; computed totals get ROUND formulas.
        if (typeof cellValue === 'number' || isFormula(cellValue, /^ROUND\(E\d+\*D\d+,2\)$/)) totalCells++;
      });
      expect(sheetText.join(' ')).not.toContain('Source:');
    }
    expect(totalCells).toBe(result.inspection.items.length);
  });

  it('places only meaningful comments in Remarks and native notes without visible NOTE rows', async () => {
    const result = await runPipeline(await commentsFixture(), 'comments.xlsx', { useLlm: false });
    result.inspection.items[0]!.comments = [...(result.inspection.items[0]!.comments ?? []), '-', 'THANK YOU'];
    const bytes = await buildWorkbook({
      packages: result.packages,
      items: result.inspection.items,
      projectName: 'Factory Extension',
      revision: 1,
      locale: 'en',
      documentLanguage: 'en',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer as ArrayBuffer);
    const concrete = result.inspection.items.find((item) => item.code === 'C-01')!;
    const concretePackage = result.packages.find((p) => p.itemIds.includes(concrete.id))!;
    const sheet = wb.worksheets.find((candidate) => candidate.name.startsWith(concretePackage.code))!;
    const values: string[] = [];
    sheet.eachRow((row) => row.eachCell((cell) => values.push(cell.text)));
    expect(values).not.toContain('NOTE');
    expect(values).not.toContain('THANK YOU');
    expect(values).not.toContain('-');
    const itemRow = sheet.findRow(5)!;
    expect(itemRow.getCell(7).text).toContain('approved ready-mix supplier');
    const note = itemRow.getCell(2).note;
    const noteText = typeof note === 'string' ? note : note.texts?.map((part: ExcelJS.RichText) => part.text).join('');
    expect(noteText).toContain('structural consultant');
  });

  it('right-aligns Arabic cells and expands wrapped rows for long text', async () => {
    const result = await runPipeline(await arFixture(), 'ar.xlsx', { useLlm: false });
    result.inspection.items[0]!.description = `${result.inspection.items[0]!.description} `.repeat(14).trim();
    result.inspection.items[0]!.comments = ['يجب التنسيق مع الاستشاري واعتماد المواد قبل بدء التنفيذ '.repeat(7).trim()];
    const bytes = await buildWorkbook({
      packages: result.packages,
      items: result.inspection.items,
      projectName: 'مشروع المصنع الجديد',
      revision: 1,
      locale: 'ar',
      documentLanguage: 'ar',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer as ArrayBuffer);
    expect(wb.worksheets[0]!.views[0]?.rightToLeft).toBe(true);
    const sheet = wb.worksheets.find((candidate) => candidate.name.startsWith('WP-'))!;
    const row = sheet.findRow(5)!;
    expect(row.getCell(2).alignment.horizontal).toBe('right');
    expect(row.getCell(2).alignment.readingOrder).toBe('rtl');
    expect(row.getCell(7).alignment.readingOrder).toBe('rtl');
    expect(row.height).toBeGreaterThan(70);
  });

  it('generates a professionally named master and standalone package files', async () => {
    const result = await runPipeline(await enFixture(), 'en.xlsx', { useLlm: false });
    const artifacts = await buildWorkbooks({
      packages: result.packages,
      items: result.inspection.items,
      projectName: 'Green Avenue',
      revision: 2,
      locale: 'en',
      documentLanguage: 'en',
    });
    expect(artifacts).toHaveLength(result.packages.length + 1);
    expect(artifacts[0]!.fileName).toBe('Green Avenue - Work Packages - Rev 02.xlsx');
    expect(artifacts[0]!.relativePath).toBe(artifacts[0]!.fileName);
    expect(artifacts.slice(1).every((artifact) => artifact.relativePath.startsWith('Packages/'))).toBe(true);
    expect(artifacts.slice(1).every((artifact) => artifact.fileName.includes(' - WP-'))).toBe(true);

    const packageArtifact = artifacts[1]!;
    const packageWb = new ExcelJS.Workbook();
    await packageWb.xlsx.load(packageArtifact.bytes.buffer as ArrayBuffer);
    expect(packageWb.worksheets.map((sheet) => sheet.name)[0]).toBe('Cover');
    expect(packageWb.worksheets).toHaveLength(2);
  });

  it('sanitizes Windows names and applies the selected naming policy', () => {
    expect(safeFileComponent('Gas: Ovens / Factory. ')).toBe('Gas Ovens Factory');
    expect(masterFileName('Green Avenue', 3)).toBe('Green Avenue - Work Packages - Rev 03.xlsx');
    expect(packageFileName('Green Avenue', {
      code: 'WP-07', nameEn: 'Plumbing & Fire Fighting', nameAr: 'أعمال السباكة', itemIds: [1], itemCount: 1, totalCost: 10,
    }, 3, false)).toBe('Green Avenue - WP-07 - Plumbing & Fire Fighting - Rev 03.xlsx');
  });

  it('handles a 5,000-row BOQ end-to-end within 30s', async () => {
    const bytes = await largeFixture(5000);
    const started = Date.now();
    const result = await runPipeline(bytes, 'large.xlsx', { useLlm: false });
    const output = await buildWorkbook({
      packages: result.packages,
      items: result.inspection.items,
      projectName: 'Large Development',
      revision: 1,
      locale: 'en',
      documentLanguage: 'en',
    });
    expect(result.inspection.items.length).toBe(5000);
    expect(output.byteLength).toBeGreaterThan(100_000);
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 60_000);
});
