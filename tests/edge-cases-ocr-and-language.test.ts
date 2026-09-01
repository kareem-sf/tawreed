import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { inspectPdf, ocrRecognizeTokens, ocrWordsToTokens, type OcrWorkerLike } from '../engine/pdf-ingest';
import { inspectWorkbook } from '../engine/ingest';
import { detectDocumentKind, inspectDocument } from '../engine/inspect-document';
import { detectDocumentLanguage } from '../engine/document-intelligence';
import { AR_ROWS, arFixture, makeWorkbook } from './fixtures';

// Arabic BOQ headers/rows deliberately malformed: header row present but every data row is blank
// (as if OCR/extraction produced nothing usable) — simulates a "scanned, unreadable" Arabic document.
async function malformedArabicFixture(): Promise<Uint8Array> {
  return makeWorkbook({
    rows: [],
    headers: ['رقم البند', 'الوصف', 'الوحدة', 'الكمية', 'الفئة', 'الإجمالي'],
    titleRows: ['شركة المقاولات — جدول الكميات'],
  });
}

describe('corrupted / truncated PDF handling', () => {
  it('fails gracefully with a clear error for a truncated PDF instead of hanging or throwing an unhandled exception', async () => {
    // Valid "%PDF-" signature (so it routes as a PDF) followed by garbage — pdfjs can't parse it.
    const truncated = new TextEncoder().encode('%PDF-1.4\nthis is not a real pdf body, just noise after the header');
    await expect(inspectPdf(truncated, 'truncated.pdf', { enableOcr: false }))
      .rejects.toThrow(/Could not open PDF/i);
  }, 20_000);

  it('detectDocumentKind still routes truncated-but-signed bytes as pdf (failure surfaces later, during parse)', () => {
    const truncated = new TextEncoder().encode('%PDF-1.4\nnoise');
    expect(detectDocumentKind(truncated, 'truncated.pdf')).toBe('pdf');
  });

  it('rejects a zero-byte file with a clear message rather than routing it anywhere', () => {
    expect(() => detectDocumentKind(new Uint8Array(0), 'empty.pdf')).toThrow(/empty/i);
  });
});

describe('password-protected PDF handling', () => {
  // pdf-lib (used elsewhere in these tests) cannot author encrypted PDFs, so the password path is
  // exercised by mocking the underlying pdfjs-dist loader, matching the mocking style already used
  // in tests/encrypted-ingest.test.ts (mock the library the engine wraps, not the engine itself).
  it('turns a pdfjs "password required" rejection into a clear, actionable error', async () => {
    vi.resetModules();
    vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
      getDocument: () => ({
        promise: Promise.reject(new Error('No password given')),
        destroy: () => Promise.resolve(),
      }),
      GlobalWorkerOptions: {},
    }));
    try {
      const { inspectPdf: mockedInspectPdf } = await import('../engine/pdf-ingest');
      await expect(mockedInspectPdf(new Uint8Array([1]), 'secret.pdf', { enableOcr: false }))
        .rejects.toThrow(/password-protected/i);
    } finally {
      vi.doUnmock('pdfjs-dist/legacy/build/pdf.mjs');
      vi.resetModules();
    }
  }, 20_000);
});

describe('OCR producing garbage or empty text', () => {
  it('maps an empty OCR result (no blocks) to zero tokens instead of throwing', async () => {
    const worker: OcrWorkerLike = {
      recognize: vi.fn().mockResolvedValue({ data: { blocks: [] } }),
    };
    const tokens = await ocrRecognizeTokens(worker, {} as never, 1);
    expect(tokens).toEqual([]);
  });

  it('maps a null blocks payload (OCR engine returned nothing usable) to zero tokens', async () => {
    const worker: OcrWorkerLike = {
      recognize: vi.fn().mockResolvedValue({ data: { blocks: null } }),
    };
    const tokens = await ocrRecognizeTokens(worker, {} as never, 1);
    expect(tokens).toEqual([]);
  });

  it('keeps garbage/noise OCR text as tokens (no validation of content) but reports it as unknown-language', () => {
    // ocrWordsToTokens does not attempt to validate recognized text — garbage in, garbage tokens out.
    // This documents current behavior: quality filtering, if any, happens downstream (language/classification).
    const garbageWords = [
      { text: '###@@@', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
      { text: '□□□', bbox: { x0: 12, y0: 0, x1: 20, y1: 10 } },
    ];
    const tokens = ocrWordsToTokens(garbageWords, 1);
    expect(tokens).toHaveLength(2);
    expect(detectDocumentLanguage(tokens.map((t) => t.text))).toBe('unknown');
  });

  it('drops whitespace-only OCR words entirely rather than emitting empty tokens', () => {
    const words = [
      { text: '   ', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
      { text: 'قيمة', bbox: { x0: 12, y0: 0, x1: 30, y1: 10 } },
    ];
    const tokens = ocrWordsToTokens(words, 1);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.text).toBe('قيمة');
  });

  it('a native-text PDF with enableOcr:true still succeeds in the Node test runtime, where OCR is intentionally skipped', async () => {
    // pdf-ingest.ts gates the OCR branch on `!nodeRuntime` — under Node (this test runner), OCR
    // never engages regardless of the enableOcr option. This documents that real Tesseract OCR
    // is unreachable from this unit-test environment, confirming the OCR unit-seam tests above
    // (ocrRecognizeTokens / ocrWordsToTokens) are the correct place to cover OCR-text edge cases.
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([720, 200]);
    const columns = [34, 95, 250, 320, 390, 460];
    const headers = ['Code', 'Description', 'Unit', 'Qty', 'Rate', 'Total'];
    headers.forEach((text, index) => page.drawText(text, { x: columns[index], y: 160, size: 9, font, color: rgb(0, 0, 0) }));
    const rows = [
      ['C-01', 'Reinforced concrete foundations', 'm3', '12', '4100', '49200'],
      ['E-01', 'Low voltage power cabling', 'm', '250', '75', '18750'],
    ];
    rows.forEach((row, rowIndex) => row.forEach((text, columnIndex) => {
      page.drawText(text, { x: columns[columnIndex], y: 130 - rowIndex * 24, size: 8, font, color: rgb(0, 0, 0) });
    }));
    const bytes = await pdf.save();
    const result = await inspectPdf(bytes, 'sparse.pdf', { enableOcr: true });
    expect(result.ocrPages).toBe(0);
    expect(result.warnings.some((w) => /OCR failed/i.test(w))).toBe(false);
  }, 20_000);
});

describe('Arabic-only (RTL) BOQ documents', () => {
  it('detects an Arabic-only workbook as language "ar" and parses its items correctly', async () => {
    const res = await inspectWorkbook(await arFixture(), 'ar-only.xlsx');
    expect(res.language).toBe('ar');
    expect(res.items).toHaveLength(AR_ROWS.length);
    expect(res.items[0]!.description).toContain('خرسانة');
  });

  it('inspectDocument dispatches an Arabic-only xlsx the same way as inspectWorkbook (top-level entry point)', async () => {
    const bytes = await arFixture();
    const res = await inspectDocument(bytes, 'ar-only.xlsx');
    expect(res.language).toBe('ar');
    expect(res.sourceKind).toBe('xlsx');
    expect(res.items.length).toBeGreaterThan(0);
  });
});

describe('combined failure: Arabic-language document that is also malformed/incomplete', () => {
  it('an Arabic-headed workbook with no data rows fails with a "no BOQ structure" style error, not a language-attributed or cryptic one', async () => {
    const bytes = await malformedArabicFixture();
    // No mis-attribution: the failure message must be about missing/insufficient table structure,
    // not phrased as a language problem (e.g. must not say anything like "unsupported language").
    await expect(inspectWorkbook(bytes, 'ar-broken.xlsx')).rejects.toThrow();
    await expect(inspectWorkbook(bytes, 'ar-broken.xlsx')).rejects.not.toThrow(/language/i);
  });

  it('a genuinely corrupted file that happens to be named with Arabic-suggestive text still reports a corruption error, not a language error', async () => {
    // Byte-level corruption is language-agnostic — the file name and any Arabic content are
    // irrelevant to detectDocumentKind / WorkbookParseError, so the failure reason must stay
    // about the bytes, never get reinterpreted as "wrong language".
    const truncated = new TextEncoder().encode('%PDF-1.4\nnoise, not a real pdf body');
    await expect(inspectPdf(truncated, 'جدول-الكميات.pdf', { enableOcr: false }))
      .rejects.toThrow(/Could not open PDF/i);
    await expect(inspectPdf(truncated, 'جدول-الكميات.pdf', { enableOcr: false }))
      .rejects.not.toThrow(/language/i);
  }, 20_000);
});
