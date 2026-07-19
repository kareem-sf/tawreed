import ExcelJS from 'exceljs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { InspectionResult } from '../shared/types';
import {
  detectDocumentLanguage,
  detectProjectName,
  filterMeaningfulComments,
  type ProjectNameCandidate,
} from './document-intelligence';
import { inspectWorkbook } from './ingest';

export interface PdfProgress {
  phase: 'pdf' | 'ocr' | 'analyze';
  page: number;
  total: number;
  progress?: number;
}

export interface PdfInspectOptions {
  onProgress?: (progress: PdfProgress) => void;
  enableOcr?: boolean;
}

interface PositionedToken {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
  fontSize: number;
}

interface PdfAnnotation {
  text: string;
  page: number;
  y: number;
}

interface LineCell {
  text: string;
  x: number;
  end: number;
  height: number;
}

interface PositionedLine {
  page: number;
  y: number;
  cells: LineCell[];
  fontSize: number;
}

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function groupLines(tokens: PositionedToken[]): PositionedLine[] {
  const sorted = [...tokens].filter((token) => token.text).sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const lines: PositionedToken[][] = [];
  const BUCKET_SIZE = 3;
  const bucketMap = new Map<number, PositionedToken[]>();
  for (const token of sorted) {
    const tolerance = Math.max(3, token.height * 0.45);
    const bucketKey = token.page * 100000 + Math.round(token.y / BUCKET_SIZE);
    const range = Math.ceil(tolerance / BUCKET_SIZE);
    let line: PositionedToken[] | undefined;
    for (let b = bucketKey - range; b <= bucketKey + range; b++) {
      const candidate = bucketMap.get(b);
      const first = candidate?.[0];
      if (first && first.page === token.page && Math.abs(first.y - token.y) <= tolerance) {
        line = candidate;
        break;
      }
    }
    if (!line) {
      line = [];
      lines.push(line);
      bucketMap.set(bucketKey, line);
    }
    line.push(token);
  }

  return lines
    .map((line) => {
      line.sort((a, b) => a.x - b.x);
      const cells: LineCell[] = [];
      for (const token of line) {
        const current = cells[cells.length - 1];
        const gap = current ? token.x - current.end : Infinity;
        const splitGap = Math.max(12, token.height * 1.25);
        if (!current || gap > splitGap) {
          cells.push({ text: token.text, x: token.x, end: token.x + token.width, height: token.height });
        } else {
          current.text = `${current.text} ${token.text}`.replace(/\s+/g, ' ').trim();
          current.end = Math.max(current.end, token.x + token.width);
          current.height = Math.max(current.height, token.height);
        }
      }
      return {
        page: line[0]!.page,
        y: line.reduce((sum, token) => sum + token.y, 0) / line.length,
        cells,
        fontSize: Math.max(...line.map((token) => token.fontSize)),
      };
    })
    .sort((a, b) => a.page - b.page || a.y - b.y);
}

function columnAnchors(lines: PositionedLine[]): number[] {
  const clusters: Array<{ x: number; count: number }> = [];
  for (const line of lines.filter((candidate) => candidate.cells.length >= 3)) {
    for (const cell of line.cells) {
      const match = clusters.find((cluster) => Math.abs(cluster.x - cell.x) <= 18);
      if (match) {
        match.x = (match.x * match.count + cell.x) / (match.count + 1);
        match.count++;
      } else {
        clusters.push({ x: cell.x, count: 1 });
      }
    }
  }
  const frequent = clusters.filter((cluster) => cluster.count >= 2).sort((a, b) => a.x - b.x);
  const fallback = clusters.sort((a, b) => b.count - a.count).slice(0, 12).sort((a, b) => a.x - b.x);
  return (frequent.length >= 3 ? frequent : fallback).slice(0, 20).map((cluster) => cluster.x);
}

function linesToGrid(lines: PositionedLine[]): { rows: string[][]; rowSources: Map<number, { page: number; y: number }> } {
  const anchors = columnAnchors(lines);
  const rows: string[][] = [];
  const rowSources = new Map<number, { page: number; y: number }>();
  let lastPage = 0;

  for (const line of lines) {
    if (lastPage && line.page !== lastPage) rows.push([]);
    lastPage = line.page;
    let values: string[];
    if (anchors.length < 3 || line.cells.length === 1) {
      values = line.cells.map((cell) => cell.text);
    } else {
      values = Array.from({ length: anchors.length }, () => '');
      for (const cell of line.cells) {
        let best = 0;
        let distance = Infinity;
        anchors.forEach((anchor, index) => {
          const current = Math.abs(anchor - cell.x);
          if (current < distance) { distance = current; best = index; }
        });
        values[best] = values[best] ? `${values[best]} ${cell.text}` : cell.text;
      }
      while (values.length && !values[values.length - 1]) values.pop();
    }
    rows.push(values);
    rowSources.set(rows.length, { page: line.page, y: line.y });
  }
  return { rows, rowSources };
}

function annotationText(annotation: Record<string, unknown>): string {
  const contents = annotation.contentsObj as { str?: string } | undefined;
  const title = annotation.titleObj as { str?: string } | undefined;
  return clean(contents?.str || annotation.contents || annotation.richText || title?.str || '');
}

async function nativePageTokens(page: any, pageNumber: number): Promise<PositionedToken[]> {
  const content = await page.getTextContent({ includeMarkedContent: false });
  const pageHeight = page.view[3] - page.view[1];
  return content.items.flatMap((item: any) => {
    if (!item || typeof item.str !== 'string' || !item.str.trim() || !Array.isArray(item.transform)) return [];
    const fontSize = Math.max(1, Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0));
    return [{
      text: clean(item.str),
      x: Number(item.transform[4] ?? 0),
      y: pageHeight - Number(item.transform[5] ?? 0),
      width: Math.max(Number(item.width ?? 0), item.str.length * fontSize * 0.35),
      height: Math.max(Number(item.height ?? 0), fontSize),
      page: pageNumber,
      fontSize,
    }];
  });
}

async function ocrPageTokens(
  page: any,
  pageNumber: number,
  total: number,
  worker: any,
  onProgress?: (progress: PdfProgress) => void,
): Promise<PositionedToken[]> {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('Scanned PDF OCR requires a WebView with OffscreenCanvas support.');
  }
  const baseViewport = page.getViewport({ scale: 1 });
  const maxDim = Math.max(baseViewport.width, baseViewport.height);
  const scale = maxDim > 0 ? Math.min(2, 3000 / maxDim) : 1;
  const viewport = page.getViewport({ scale });
  const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create an OCR canvas.');
  await page.render({ canvasContext: context as any, viewport }).promise;

  const result = await worker.recognize(canvas, {}, { blocks: true, text: true });
  const words = (result.data.blocks ?? []).flatMap((block: any) =>
    block.paragraphs.flatMap((paragraph: any) => paragraph.lines.flatMap((line: any) => line.words)),
  );
  // Release the canvas bitmap to free memory in long OCR runs
  canvas.width = 0;
  canvas.height = 0;

  return words.filter((word: any) => clean(word.text)).map((word: any) => ({
    text: clean(word.text),
    x: word.bbox.x0,
    y: word.bbox.y0,
    width: Math.max(1, word.bbox.x1 - word.bbox.x0),
    height: Math.max(1, word.bbox.y1 - word.bbox.y0),
    page: pageNumber,
    fontSize: Math.max(8, word.bbox.y1 - word.bbox.y0),
  }));
}

export async function inspectPdf(
  bytes: ArrayBuffer | Uint8Array,
  fileName: string,
  options: PdfInspectOptions = {},
): Promise<InspectionResult> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const nodeWorkerUrl = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href;
  const nodeRuntime = (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node;
  pdfjs.GlobalWorkerOptions.workerSrc = nodeRuntime ? nodeWorkerUrl : pdfWorkerUrl;
  const origin = typeof self !== 'undefined' && self.location?.origin
    ? (self.location.origin.endsWith('/') ? self.location.origin : `${self.location.origin}/`)
    : import.meta.url;
  const loadingTask = pdfjs.getDocument({
    data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    standardFontDataUrl: nodeRuntime ? undefined : new URL('pdfjs/standard_fonts/', origin).href,
    cMapUrl: nodeRuntime ? undefined : new URL('pdfjs/cmaps/', origin).href,
    cMapPacked: true,
    wasmUrl: nodeRuntime ? undefined : new URL('pdfjs/wasm/', origin).href,
  });
  let pdf: any;
  const tokens: PositionedToken[] = [];
  const annotations: PdfAnnotation[] = [];
  const projectCandidates: ProjectNameCandidate[] = [];
  let ocrPages = 0;
  let ocrWorker: any = null;
  let ocrCurrentPage = 0;

  try {
    try {
      pdf = await loadingTask.promise;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/password/i.test(message)) throw new Error('Password-protected PDFs are not supported. Remove the password and try again.');
      throw new Error(`Could not open PDF: ${message}`);
    }
    if (pdf.numPages > 250) throw new Error('PDF exceeds the 250-page processing limit.');

    const metadata = await pdf.getMetadata().catch(() => null);
    const info = metadata?.info as Record<string, unknown> | undefined;
    if (info?.Title) projectCandidates.push({ text: clean(info.Title), source: 'document-metadata', prominence: 1, order: 0 });
    if (info?.Subject) projectCandidates.push({ text: clean(info.Subject), source: 'document-metadata', prominence: 0.7, order: 1 });

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      options.onProgress?.({ phase: 'pdf', page: pageNumber, total: pdf.numPages });
      const page = await pdf.getPage(pageNumber);
      try {
        let pageTokens = await nativePageTokens(page, pageNumber);
        const nativeText = pageTokens.map((token) => token.text).join(' ');
        let usedOcr = false;
        if (options.enableOcr !== false && !nodeRuntime && (pageTokens.length < 8 || nativeText.length < 80)) {
          if (!ocrWorker) {
            const Tesseract = await import('tesseract.js');
            const ocrOrigin = self.location.origin.endsWith('/') ? self.location.origin : `${self.location.origin}/`;
            ocrWorker = await Tesseract.createWorker(['eng', 'ara'], Tesseract.OEM.LSTM_ONLY, {
              workerPath: new URL('ocr/worker.min.js', ocrOrigin).href,
              langPath: new URL('ocr/lang', ocrOrigin).href,
              corePath: new URL('ocr/core', ocrOrigin).href,
              workerBlobURL: false,
              logger: (message) => options.onProgress?.({
                phase: 'ocr',
                page: ocrCurrentPage,
                total: pdf.numPages,
                progress: message.progress,
              }),
            });
            await ocrWorker.setParameters({
              tessedit_pageseg_mode: Tesseract.PSM.AUTO,
              preserve_interword_spaces: '1',
            });
          }
          try {
            ocrCurrentPage = pageNumber;
            pageTokens = await ocrPageTokens(page, pageNumber, pdf.numPages, ocrWorker, options.onProgress);
            ocrPages++;
            usedOcr = true;
          } catch {
            // OCR failed for this page — keep the sparse native tokens
          }
        }
        tokens.push(...pageTokens);

        const pageHeight = page.view[3] - page.view[1];
        const pageAnnotations = await page.getAnnotations({ intent: 'display' }).catch(() => []);
        for (const annotation of pageAnnotations as Array<Record<string, unknown>>) {
          const text = annotationText(annotation);
          const filtered = filterMeaningfulComments([text]);
          if (!filtered.length) continue;
          const rect = Array.isArray(annotation.rect) ? annotation.rect as number[] : [];
          annotations.push({ text: filtered[0]!, page: pageNumber, y: rect.length >= 4 ? pageHeight - rect[3]! : pageHeight / 2 });
        }

        if (pageNumber <= 3) {
          const pageLines = groupLines(pageTokens).slice(0, 25);
          pageLines.forEach((line, index) => {
            const text = line.cells.map((cell) => cell.text).join(' ').trim();
            if (text) projectCandidates.push({
              text,
              source: usedOcr ? 'ocr' : 'title',
              order: pageNumber * 100 + index,
              fontSize: line.fontSize,
              prominence: Math.min(1, line.fontSize / 24 + (index < 8 ? 0.2 : 0)),
            });
          });
        }
      } finally {
        page.cleanup();
      }
    }

    options.onProgress?.({ phase: 'analyze', page: pdf.numPages, total: pdf.numPages });
    const lines = groupLines(tokens);
    const { rows, rowSources } = linesToGrid(lines);
    const synthetic = new ExcelJS.Workbook();
    const sheet = synthetic.addWorksheet('PDF BOQ');
    rows.forEach((row) => sheet.addRow(row));
    const syntheticBytes = new Uint8Array(await synthetic.xlsx.writeBuffer() as ArrayBuffer);
    const result = await inspectWorkbook(syntheticBytes, fileName);

    const itemPositions = result.items.map((item) => ({ item, source: rowSources.get(item.row) }));
    const annotationAssignments = new Map<number, string[]>();
    for (const annotation of annotations) {
      const nearest = itemPositions
        .filter((candidate) => candidate.source?.page === annotation.page)
        .map((candidate) => ({ candidate, distance: Math.abs(annotation.y - (candidate.source?.y ?? annotation.y)) }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (!nearest || nearest.distance > 100) continue; // don't assign annotations more than 100 units away
      const current = annotationAssignments.get(nearest.candidate.item.id) ?? [];
      current.push(annotation.text);
      annotationAssignments.set(nearest.candidate.item.id, current);
    }
    for (const { item, source } of itemPositions) {
      if (source) item.page = source.page;
      const assigned = annotationAssignments.get(item.id) ?? [];
      if (assigned.length) item.comments = filterMeaningfulComments([...(item.comments ?? []), ...assigned]);
    }

    const project = detectProjectName(projectCandidates, fileName);
    const language = detectDocumentLanguage([
      project.value,
      ...result.items.slice(0, 100).flatMap((item) => [item.description, ...(item.comments ?? [])]),
    ]);
    return {
      ...result,
      sourceKind: 'pdf',
      projectName: project.value,
      projectNameConfidence: project.confidence,
      projectNameCandidates: [...new Set(projectCandidates.map((candidate) => candidate.text.trim()).filter(Boolean))].slice(0, 40),
      language,
      pageCount: pdf.numPages,
      ocrPages,
      annotationCount: annotations.length,
      sheetName: 'PDF BOQ',
    };
  } finally {
    if (ocrWorker) await ocrWorker.terminate().catch(() => {});
    await loadingTask.destroy().catch(() => {});
  }
}
