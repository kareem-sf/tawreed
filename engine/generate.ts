import ExcelJS from 'exceljs';
import type { BoqItem, DocumentLanguage, WorkPackage } from '../shared/types';
import {
  containsArabic,
  estimateWrappedRowHeight,
  filterMeaningfulComments,
} from './document-intelligence';
import { itemTotal } from './item-total';

export interface GenerateInput {
  packages: WorkPackage[];
  items: BoqItem[];
  projectName: string;
  revision: number;
  locale: 'en' | 'ar';
  documentLanguage?: DocumentLanguage;
  sourceFileName?: string;
}

export interface GeneratedArtifact {
  kind: 'master' | 'package';
  packageCode?: string;
  fileName: string;
  relativePath: string;
  bytes: Uint8Array;
}

const NAVY = 'FF172033';
const NAVY_LIGHT = 'FF25324A';
const GOLD = 'FFE8B54A';
const GOLD_LIGHT = 'FFF5D58A';
const INK = 'FF20242D';
const MUTED = 'FF687386';
const LINE = 'FFD9DEE7';
const MONEY_FMT = '#,##0.00';
const QTY_FMT = '#,##0.00';

function solid(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function safeSheetName(raw: string, used: Set<string>): string {
  // Excel forbids [ ] : * ? / \ anywhere in the name and apostrophes at either end.
  const base = raw.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31).replace(/^'+|'+$/g, '') || 'Sheet';
  let name = base;
  let suffix = 2;
  while (used.has(name)) {
    const suffixStr = String(suffix++);
    name = `${base.slice(0, 31 - suffixStr.length - 1)}-${suffixStr}`;
  }
  used.add(name);
  return name;
}

export function safeFileComponent(raw: string, maxLength = 100): string {
  const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  let value = raw
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!value) value = 'Untitled Project';
  if (reserved.test(value)) value = `Project ${value}`;
  if (value.length > maxLength) value = value.slice(0, maxLength).replace(/[. ]+$/g, '');
  return value;
}

function revisionLabel(revision: number): string {
  return `Rev ${String(Math.max(1, revision)).padStart(2, '0')}`;
}

export function masterFileName(projectName: string, revision: number): string {
  return `${safeFileComponent(projectName)} - Work Packages - ${revisionLabel(revision)}.xlsx`;
}

export function packageFileName(projectName: string, p: WorkPackage, revision: number, ar: boolean): string {
  const packageName = safeFileComponent(ar ? p.nameAr : p.nameEn, 80);
  return `${safeFileComponent(projectName)} - ${safeFileComponent(p.code, 32)} - ${packageName} - ${revisionLabel(revision)}.xlsx`;
}

function createWorkbook(projectName: string): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const now = new Date();
  wb.creator = 'Tawreed';
  wb.lastModifiedBy = 'Tawreed';
  wb.company = 'Tawreed';
  wb.title = `${projectName} · Work Packages`;
  wb.subject = 'Construction procurement work packages';
  wb.description = 'Generated locally by Tawreed · kareemsafwat.com';
  wb.keywords = 'Tawreed, BOQ, procurement, work packages, construction';
  wb.created = now;
  wb.modified = now;
  wb.calcProperties.fullCalcOnLoad = true;
  return wb;
}

function headerSafe(text: string): string {
  // Header/footer strings can't contain newlines or control chars; && escapes a literal ampersand.
  return text.replace(/[\r\n]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').replace(/&/g, '&&').slice(0, 180);
}

function configurePrint(ws: ExcelJS.Worksheet, projectName: string, printArea: string, repeatRows?: string) {
  ws.pageSetup.paperSize = 9;
  ws.pageSetup.orientation = 'portrait';
  ws.pageSetup.fitToPage = true;
  ws.pageSetup.fitToWidth = 1;
  ws.pageSetup.fitToHeight = 0;
  ws.pageSetup.horizontalCentered = true;
  ws.pageSetup.margins = { left: 0.25, right: 0.25, top: 0.45, bottom: 0.4, header: 0.2, footer: 0.2 };
  ws.pageSetup.printArea = printArea;
  if (repeatRows) ws.pageSetup.printTitlesRow = repeatRows;
  ws.headerFooter.oddHeader = `&C&10 ${headerSafe(projectName)}`;
  ws.headerFooter.evenHeader = ws.headerFooter.oddHeader;
  ws.headerFooter.oddFooter = '&LTawreed · kareemsafwat.com&RPage &P of &N';
  ws.headerFooter.evenFooter = ws.headerFooter.oddFooter;
}

function styleTableHeader(row: ExcelJS.Row) {
  row.height = 27;
  row.eachCell((cell) => {
    cell.fill = solid(NAVY);
    cell.font = { bold: true, color: { argb: GOLD_LIGHT }, size: 10 };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: GOLD } } };
  });
}

function applyTextDirection(cell: ExcelJS.Cell, value: string, defaultArabic: boolean) {
  const rtl = containsArabic(value) || (defaultArabic && !/[A-Za-z]/.test(value));
  cell.alignment = {
    ...cell.alignment,
    horizontal: rtl ? 'right' : 'left',
    readingOrder: rtl ? 'rtl' : 'ltr',
    vertical: 'top',
    wrapText: true,
  };
}

interface PackageSheetInfo {
  package: WorkPackage;
  sheetName: string;
  totalRow: number;
  calculatedTotal: number;
}

function addPackageSheet(
  wb: ExcelJS.Workbook,
  p: WorkPackage,
  byItem: Map<number, BoqItem>,
  usedNames: Set<string>,
  projectName: string,
  ar: boolean,
): PackageSheetInfo {
  const name = safeSheetName(`${p.code} ${ar ? p.nameAr : p.nameEn}`, usedNames);
  const ws = wb.addWorksheet(name, {
    views: [{ rightToLeft: ar, state: 'frozen', ySplit: 4, showGridLines: false }],
  });
  ws.columns = [
    { key: 'code', width: 10 },
    { key: 'description', width: 38 },
    { key: 'unit', width: 8 },
    { key: 'qty', width: 10 },
    { key: 'rate', width: 13 },
    { key: 'total', width: 15 },
    { key: 'remarks', width: 24 },
  ];

  ws.mergeCells('A1:G1');
  const projectCell = ws.getCell('A1');
  projectCell.value = projectName;
  projectCell.fill = solid(NAVY);
  projectCell.font = { bold: true, color: { argb: GOLD_LIGHT }, size: 17 };
  projectCell.alignment = { horizontal: ar ? 'right' : 'left', readingOrder: ar ? 'rtl' : 'ltr', vertical: 'middle', wrapText: true };
  ws.getRow(1).height = estimateWrappedRowHeight([projectName], [100], 17);

  ws.mergeCells('A2:G2');
  const packageCell = ws.getCell('A2');
  packageCell.value = `${p.code} · ${ar ? p.nameAr : p.nameEn}`;
  packageCell.fill = solid(NAVY_LIGHT);
  packageCell.font = { bold: true, color: { argb: 'FFE7EAF0' }, size: 11 };
  applyTextDirection(packageCell, String(packageCell.value), ar);
  packageCell.alignment = { ...packageCell.alignment, vertical: 'middle' };
  ws.getRow(2).height = 24;
  ws.addRow([]);

  const header = ws.addRow([
    ar ? 'الكود' : 'Code',
    ar ? 'الوصف' : 'Description',
    ar ? 'الوحدة' : 'Unit',
    ar ? 'الكمية' : 'Qty',
    ar ? 'الفئة' : 'Rate',
    ar ? 'الإجمالي' : 'Total',
    ar ? 'الملاحظات' : 'Remarks',
  ]);
  styleTableHeader(header);

  let calculatedTotal = 0;
  for (const id of p.itemIds) {
    const item = byItem.get(id);
    if (!item) continue;
    const comments = filterMeaningfulComments(item.comments ?? []);
    const remarks = comments.join('\n');
    const result = itemTotal(item);
    calculatedTotal += result;
    const qty = Number.isFinite(item.qty) ? item.qty : 0;
    const rate = item.rate !== null && Number.isFinite(item.rate) ? item.rate : null;
    // Provenance flags set by ingest when a value is derived rather than sourced (absent for older callers).
    const { rateDerived, totalDerived } = item as BoqItem & { rateDerived?: boolean; totalDerived?: boolean };
    // 'other' is ingest's sentinel for "no unit column in source" — never display it as unit text.
    const unitText = item.unitLabel === 'other' ? '' : item.unitLabel || item.unit;
    const row = ws.addRow([
      item.code,
      item.description,
      unitText,
      qty,
      rate,
      null,
      remarks || null,
    ]);
    // A derived rate stays a live formula so the workbook reconciles against the source total.
    if (rateDerived && rate !== null) {
      row.getCell(5).value = { formula: `ROUND(F${row.number}/D${row.number},2)`, result: rate };
    }
    if (totalDerived && item.total !== null && Number.isFinite(item.total)) {
      // A derived total stays a live formula instead of a static number.
      row.getCell(6).value = { formula: `ROUND(E${row.number}*D${row.number},2)`, result };
    } else if (item.total !== null && Number.isFinite(item.total)) {
      row.getCell(6).value = item.total;
    } else if (rate !== null) {
      row.getCell(6).value = { formula: `ROUND(E${row.number}*D${row.number},2)`, result };
    }
    // Unpriced lines (no rate, no total) keep a blank total cell, matching the ingest contract.
    row.getCell(4).numFmt = QTY_FMT;
    row.getCell(5).numFmt = MONEY_FMT;
    row.getCell(6).numFmt = MONEY_FMT;
    row.height = Math.max(23, estimateWrappedRowHeight([item.description, remarks], [38, 24], 9.5));
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.font = { color: { argb: INK }, size: 9.5 };
      cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
      if (column === 2 || column === 7) applyTextDirection(cell, cell.text, ar);
      else cell.alignment = { vertical: 'top', horizontal: column >= 4 ? 'right' : (ar ? 'right' : 'left'), readingOrder: ar && column < 4 ? 'rtl' : 'ltr' };
    });
    if (comments.length) row.getCell(2).note = comments.join('\n\n');
  }

  const dataEnd = ws.rowCount;
  const totalRow = ws.addRow([ar ? 'إجمالي الحزمة' : 'PACKAGE TOTAL', null, null, null, null, null, null]);
  ws.mergeCells(totalRow.number, 1, totalRow.number, 5);
  if (dataEnd >= 5) {
    totalRow.getCell(6).value = { formula: `SUM(F5:F${dataEnd})`, result: calculatedTotal };
  } else {
    totalRow.getCell(6).value = 0;
  }
  totalRow.getCell(6).numFmt = MONEY_FMT;
  totalRow.height = 28;
  totalRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = solid(NAVY);
    cell.font = { bold: true, color: { argb: GOLD_LIGHT }, size: 10 };
    cell.alignment = { vertical: 'middle', horizontal: 'right', readingOrder: ar ? 'rtl' : 'ltr' };
    cell.border = { top: { style: 'medium', color: { argb: GOLD } } };
  });

  ws.autoFilter = { from: 'A4', to: `G${Math.max(4, dataEnd)}` };
  configurePrint(ws, projectName, `A1:G${totalRow.number}`, '1:4');
  return { package: p, sheetName: name, totalRow: totalRow.number, calculatedTotal };
}

function populateProjectCover(
  cover: ExcelJS.Worksheet,
  input: GenerateInput,
  packageSheets: PackageSheetInfo[],
) {
  const { projectName, items, packages } = input;
  const ar = containsArabic(projectName) || input.documentLanguage === 'ar';
  cover.columns = [{ width: 15 }, { width: 44 }, { width: 19 }, { width: 14 }];

  cover.mergeCells('A1:D1');
  const brand = cover.getCell('A1');
  brand.value = 'TAWREED';
  brand.fill = solid(NAVY);
  brand.font = { bold: true, color: { argb: GOLD_LIGHT }, size: 15 };
  brand.alignment = { horizontal: 'center', vertical: 'middle' };
  cover.getRow(1).height = 28;

  cover.mergeCells('A3:D4');
  const title = cover.getCell('A3');
  title.value = projectName;
  title.font = { bold: true, color: { argb: NAVY }, size: 22 };
  title.alignment = { horizontal: 'center', readingOrder: ar ? 'rtl' : 'ltr', vertical: 'middle', wrapText: true };
  const projectHeight = estimateWrappedRowHeight([projectName], [88], 22);
  cover.getRow(3).height = Math.max(32, projectHeight / 2);
  cover.getRow(4).height = Math.max(32, projectHeight / 2);

  const grandTotal = packageSheets.reduce((sum, info) => sum + info.calculatedTotal, 0);
  const kpis = [
    { label: ar ? 'البنود' : 'ITEMS', value: items.length },
    { label: ar ? 'حزم العمل' : 'WORK PACKAGES', value: packages.length },
    { label: ar ? 'الإجمالي' : 'GRAND TOTAL', value: grandTotal },
  ];
  const kpiRanges = [['A6:A7', 'A6'], ['B6:B7', 'B6'], ['C6:D7', 'C6']] as const;
  kpis.forEach((kpi, index) => {
    const [range, address] = kpiRanges[index]!;
    cover.mergeCells(range);
    const cell = cover.getCell(address);
    cell.value = `${kpi.label}\n${index === 2 ? grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : kpi.value}`;
    cell.fill = solid(index === 2 ? NAVY : 'FFF1F3F6');
    cell.font = { bold: true, color: { argb: index === 2 ? GOLD_LIGHT : NAVY }, size: index === 2 ? 12 : 11 };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: ar ? 'rtl' : 'ltr' };
    cell.border = { top: { style: 'thin', color: { argb: LINE } }, bottom: { style: 'thin', color: { argb: LINE } }, left: { style: 'thin', color: { argb: LINE } }, right: { style: 'thin', color: { argb: LINE } } };
  });
  cover.getRow(6).height = 24;
  cover.getRow(7).height = 24;

  cover.mergeCells('A9:D9');
  const summaryTitle = cover.getCell('A9');
  summaryTitle.value = ar ? 'ملخص حزم الأعمال' : 'WORK PACKAGE SUMMARY';
  summaryTitle.font = { bold: true, color: { argb: NAVY }, size: 12 };
  summaryTitle.alignment = { horizontal: ar ? 'right' : 'left', readingOrder: ar ? 'rtl' : 'ltr', vertical: 'middle' };
  cover.getRow(9).height = 25;

  const header = cover.getRow(10);
  header.values = [ar ? 'الكود' : 'Code', ar ? 'حزمة العمل' : 'Work Package', ar ? 'الإجمالي' : 'Total', ar ? 'النسبة' : 'Share'];
  styleTableHeader(header);
  const summaryStart = 11;
  for (const info of packageSheets) {
    const packageName = ar ? info.package.nameAr : info.package.nameEn;
    const row = cover.addRow([
      info.package.code,
      { text: packageName, hyperlink: `#'${info.sheetName.replace(/'/g, "''")}'!A1` },
      null,
      null,
    ]);
    row.getCell(3).value = { formula: `'${info.sheetName.replace(/'/g, "''")}'!F${info.totalRow}`, result: info.calculatedTotal };
    row.getCell(3).numFmt = MONEY_FMT;
    row.height = Math.max(22, estimateWrappedRowHeight([packageName], [44], 9));
    row.eachCell((cell, column) => {
      cell.font = { color: { argb: column === 2 ? 'FF9A6500' : INK }, size: 9 };
      if (column === 2) applyTextDirection(cell, packageName, ar);
      else cell.alignment = { vertical: 'middle', horizontal: column >= 3 ? 'right' : (ar ? 'right' : 'left'), readingOrder: ar ? 'rtl' : 'ltr' };
      cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
    });
  }

  const summaryEnd = cover.rowCount;
  const totalRow = cover.addRow([ar ? 'الإجمالي العام' : 'GRAND TOTAL', null, null, null]);
  cover.mergeCells(totalRow.number, 1, totalRow.number, 2);
  if (summaryEnd >= summaryStart) {
    totalRow.getCell(3).value = { formula: `SUM(C${summaryStart}:C${summaryEnd})`, result: grandTotal };
  } else {
    totalRow.getCell(3).value = 0;
  }
  totalRow.getCell(3).numFmt = MONEY_FMT;
  totalRow.getCell(4).value = { formula: grandTotal > 0 ? `C${totalRow.number}/C${totalRow.number}` : '0', result: grandTotal > 0 ? 1 : 0 };
  totalRow.getCell(4).numFmt = '0.0%';
  totalRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = solid(NAVY);
    cell.font = { bold: true, color: { argb: GOLD_LIGHT }, size: 10 };
    cell.alignment = { vertical: 'middle', horizontal: 'right', readingOrder: ar ? 'rtl' : 'ltr' };
  });
  totalRow.height = 26;

  for (let rowNumber = summaryStart; rowNumber < totalRow.number; rowNumber++) {
    cover.getCell(`D${rowNumber}`).value = {
      formula: `IFERROR(C${rowNumber}/$C$${totalRow.number},0)`,
      result: grandTotal > 0 ? packageSheets[rowNumber - summaryStart]!.calculatedTotal / grandTotal : 0,
    };
    cover.getCell(`D${rowNumber}`).numFmt = '0.0%';
  }

  const copyrightRow = totalRow.number + 3;
  cover.mergeCells(copyrightRow, 1, copyrightRow, 4);
  const copyright = cover.getCell(copyrightRow, 1);
  copyright.value = `© ${new Date().getFullYear()} Tawreed · kareemsafwat.com`;
  copyright.font = { color: { argb: MUTED }, size: 8.5 };
  copyright.alignment = { horizontal: 'center', vertical: 'middle' };
  cover.getRow(copyrightRow).height = 20;
  configurePrint(cover, projectName, `A1:D${copyrightRow}`);
}

function populateMiniCover(cover: ExcelJS.Worksheet, input: GenerateInput, p: WorkPackage, calculatedTotal: number) {
  const ar = containsArabic(input.projectName) || input.documentLanguage === 'ar';
  cover.columns = [{ width: 18 }, { width: 52 }, { width: 18 }];
  cover.mergeCells('A1:C1');
  cover.getCell('A1').value = 'TAWREED';
  cover.getCell('A1').fill = solid(NAVY);
  cover.getCell('A1').font = { bold: true, color: { argb: GOLD_LIGHT }, size: 15 };
  cover.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  cover.getRow(1).height = 28;
  cover.mergeCells('A3:C4');
  cover.getCell('A3').value = input.projectName;
  cover.getCell('A3').font = { bold: true, color: { argb: NAVY }, size: 21 };
  cover.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: ar ? 'rtl' : 'ltr' };
  cover.getRow(3).height = 34;
  cover.getRow(4).height = 34;
  cover.mergeCells('A6:C6');
  cover.getCell('A6').value = `${p.code} · ${ar ? p.nameAr : p.nameEn}`;
  cover.getCell('A6').fill = solid(NAVY_LIGHT);
  cover.getCell('A6').font = { bold: true, color: { argb: GOLD_LIGHT }, size: 13 };
  cover.getCell('A6').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: ar ? 'rtl' : 'ltr' };
  cover.getRow(6).height = 32;
  cover.mergeCells('A8:B8');
  cover.getCell('A8').value = `${ar ? 'البنود' : 'ITEMS'}\n${p.itemIds.length}`;
  cover.mergeCells('C8:C8');
  cover.getCell('C8').value = `${ar ? 'الإجمالي' : 'TOTAL'}\n${calculatedTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  for (const address of ['A8', 'C8']) {
    const cell = cover.getCell(address);
    cell.fill = solid(address === 'C8' ? NAVY : 'FFF1F3F6');
    cell.font = { bold: true, color: { argb: address === 'C8' ? GOLD_LIGHT : NAVY }, size: 11 };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: ar ? 'rtl' : 'ltr' };
  }
  cover.getRow(8).height = 42;
  cover.mergeCells('A12:C12');
  cover.getCell('A12').value = `© ${new Date().getFullYear()} Tawreed · kareemsafwat.com`;
  cover.getCell('A12').font = { color: { argb: MUTED }, size: 8.5 };
  cover.getCell('A12').alignment = { horizontal: 'center' };
  configurePrint(cover, input.projectName, 'A1:C12');
}

async function workbookBytes(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  return new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer);
}

export async function buildWorkbooks(input: GenerateInput): Promise<GeneratedArtifact[]> {
  const displayProjectName = input.projectName || 'Untitled Project';
  const fileProjectName = safeFileComponent(input.projectName);
  const ar = containsArabic(displayProjectName) || input.documentLanguage === 'ar';
  const byItem = new Map(input.items.map((item) => [item.id, item]));

  const master = createWorkbook(displayProjectName);
  const masterNames = new Set<string>();
  const masterCover = master.addWorksheet(safeSheetName('Cover', masterNames), {
    views: [{ rightToLeft: ar, showGridLines: false }],
  });
  const packageSheets = input.packages.map((p) => addPackageSheet(master, p, byItem, masterNames, displayProjectName, ar));
  populateProjectCover(masterCover, { ...input, projectName: displayProjectName }, packageSheets);
  const masterName = masterFileName(fileProjectName, input.revision);
  const artifacts: GeneratedArtifact[] = [{
    kind: 'master',
    fileName: masterName,
    relativePath: masterName,
    bytes: await workbookBytes(master),
  }];

  for (const p of input.packages) {
    const wb = createWorkbook(displayProjectName);
    const used = new Set<string>();
    const cover = wb.addWorksheet(safeSheetName('Cover', used), { views: [{ rightToLeft: ar, showGridLines: false }] });
    const info = addPackageSheet(wb, p, byItem, used, displayProjectName, ar);
    populateMiniCover(cover, { ...input, projectName: displayProjectName }, p, info.calculatedTotal);
    const fileName = packageFileName(fileProjectName, p, input.revision, ar);
    artifacts.push({
      kind: 'package',
      packageCode: p.code,
      fileName,
      relativePath: `Packages/${fileName}`,
      bytes: await workbookBytes(wb),
    });
  }
  return artifacts;
}

/** Compatibility helper used by headless callers: returns the master workbook. */
export async function buildWorkbook(input: GenerateInput): Promise<Uint8Array> {
  return (await buildWorkbooks({ ...input, revision: input.revision || 1 }))[0]!.bytes;
}

export function suggestedFileName(projectName: string, revision = 1): string {
  return masterFileName(projectName, revision);
}
