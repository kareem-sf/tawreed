import { describe, expect, it } from 'vitest';
import {
  containsArabic,
  detectDocumentLanguage,
  detectProjectName,
  estimateWrappedRowHeight,
  filterMeaningfulComments,
  isMeaningfulComment,
  type ProjectNameCandidate,
} from '../engine/document-intelligence';

describe('detectProjectName', () => {
  it('prefers an explicitly labeled English project over prominent generic titles', () => {
    const candidates: ProjectNameCandidate[] = [
      { text: 'BILL OF QUANTITIES', source: 'title', prominence: 1, fontSize: 24, bold: true, order: 0 },
      { text: 'Atlas Contracting Company', source: 'header', fontSize: 18, bold: true, order: 1 },
      { text: 'Project Name: North Harbor Expansion', source: 'cell', order: 8 },
      { text: 'Supply and install 200 mm pipe', source: 'cell', order: 20 },
    ];

    expect(detectProjectName(candidates, 'harbor-boq.xlsx')).toEqual({
      value: 'North Harbor Expansion',
      confidence: expect.any(Number),
      language: 'en',
      method: 'labeled-candidate',
    });
  });

  it('uses Arabic labels and reports Arabic language', () => {
    const result = detectProjectName([
      { text: 'جدول الكميات', source: 'title', fontSize: 22, bold: true },
      { label: 'اسم المشروع', text: 'تطوير مستشفى النور', source: 'cell', order: 3 },
    ], 'hospital.xlsx');

    expect(result.value).toBe('تطوير مستشفى النور');
    expect(result.language).toBe('ar');
    expect(result.method).toBe('labeled-candidate');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('ranks title metadata, prominence, and document order', () => {
    const result = detectProjectName([
      { text: 'Basement waterproofing work', source: 'cell', order: 50, prominence: 0.1 },
      { text: 'Coastal Research Campus', source: 'document-metadata', order: 2, prominence: 0.8 },
      { text: 'THANK YOU', source: 'title', order: 0, prominence: 1 },
    ], 'fallback.xlsx');

    expect(result.value).toBe('Coastal Research Campus');
    expect(result.method).toBe('ranked-candidate');
  });

  it('falls back to a sanitized filename when candidates are boilerplate', () => {
    const result = detectProjectName([
      { text: 'BOQ', source: 'title', prominence: 1 },
      { text: 'Commercial Offer', source: 'header' },
      { text: 'Example LLC', source: 'header' },
    ], 'C:\\incoming\\New_Cairo_Medical_Center_BOQ_Rev-03.xlsx');

    expect(result).toEqual({
      value: 'New Cairo Medical Center',
      confidence: 0.3,
      language: 'en',
      method: 'filename-fallback',
    });
  });
});

describe('meaningful comment filtering', () => {
  it.each([
    '', '---', '... / ---', 'N/A', 'none', 'THANK YOU', 'Kind regards',
    'Prepared by John Smith', 'GRAND TOTAL: 12,500', 'Page 2 of 8',
    'Description | Unit | Qty | Rate | Amount', 'Confidential and proprietary',
    'لا يوجد', 'مع خالص التحيات', 'الإجمالي: ١٢٥٠٠',
    'الوصف | الوحدة | الكمية | السعر | الإجمالي',
  ])('rejects boilerplate %j', (value) => {
    expect(isMeaningfulComment(value)).toBe(false);
  });

  it.each([
    'Use sulphate-resistant cement below ground level.',
    'Total thickness shall be 150 mm including the screed.',
    'Coordinate sleeve locations with the MEP contractor before casting.',
    'يجب اعتماد العينة قبل بدء أعمال التوريد.',
    'تنفيذ طبقتين عزل مع اختبار الغمر لمدة ٤٨ ساعة.',
  ])('preserves technical comment %j', (value) => {
    expect(isMeaningfulComment(value)).toBe(true);
  });

  it('normalizes whitespace, removes non-strings and deduplicates equivalent comments', () => {
    expect(filterMeaningfulComments([
      null,
      '  Use approved   ready-mix supplier.  ',
      'use approved ready-mix supplier!',
      '---',
      'Protect completed work.\r\nCoordinate with site team.',
      'THANK YOU',
    ])).toEqual([
      'Use approved ready-mix supplier.',
      'Protect completed work.\nCoordinate with site team.',
    ]);
  });

  it('deduplicates normalized Arabic spelling and punctuation', () => {
    expect(filterMeaningfulComments([
      'يجب إعتماد العينة قبل التوريد.',
      'يجب اعتماد العينه قبل التوريد',
    ])).toEqual(['يجب إعتماد العينة قبل التوريد.']);
  });
});

describe('language detection', () => {
  it('detects Arabic across the Arabic Unicode ranges', () => {
    expect(containsArabic('Project مشروع 12')).toBe(true);
    expect(containsArabic('Project 12')).toBe(false);
  });

  it.each([
    ['Concrete and reinforcement', 'en'],
    ['أعمال الخرسانة المسلحة', 'ar'],
    ['Project مشروع', 'mixed'],
    ['1234 - /', 'unknown'],
    [['Project', 'اسم المشروع'], 'mixed'],
  ] as const)('classifies %j as %s', (value, expected) => {
    expect(detectDocumentLanguage(value)).toBe(expected);
  });
});

describe('estimateWrappedRowHeight', () => {
  it('grows as English content wraps', () => {
    const short = estimateWrappedRowHeight(['Short text'], [30]);
    const long = estimateWrappedRowHeight(['A long technical description '.repeat(20)], [30]);
    expect(long).toBeGreaterThan(short * 4);
  });

  it('accounts for explicit newlines even in short text', () => {
    const oneLine = estimateWrappedRowHeight(['A'], [40]);
    const fourLines = estimateWrappedRowHeight(['A\nB\nC\nD'], [40]);
    expect(fourLines).toBeGreaterThan(oneLine * 2.5);
  });

  it('wraps unbroken tokens and Arabic or mixed-script text', () => {
    const plain = estimateWrappedRowHeight(['abcdefghij'], [10]);
    const token = estimateWrappedRowHeight(['x'.repeat(160)], [10]);
    const mixed = estimateWrappedRowHeight(['تنفيذ waterproofing للأدوار السفلية '.repeat(8)], [10]);
    expect(token).toBeGreaterThan(plain * 8);
    expect(mixed).toBeGreaterThan(plain * 4);
  });

  it('uses the tallest cell and responds to width and font size', () => {
    const wide = estimateWrappedRowHeight(['short', 'technical specification '.repeat(8)], [8, 50], 10);
    const narrow = estimateWrappedRowHeight(['short', 'technical specification '.repeat(8)], [8, 12], 10);
    const largeFont = estimateWrappedRowHeight(['technical specification '.repeat(8)], [50], 18);
    expect(narrow).toBeGreaterThan(wide);
    expect(largeFont).toBeGreaterThan(wide);
  });

  it('has no arbitrary content cutoff but respects Excel maximum row height', () => {
    const medium = estimateWrappedRowHeight(['x'.repeat(400)], [8]);
    const huge = estimateWrappedRowHeight(['x'.repeat(100_000)], [8]);
    expect(medium).toBeGreaterThan(100);
    expect(huge).toBe(409.5);
  });
});
