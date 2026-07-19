export type DocumentLanguage = 'en' | 'ar' | 'mixed' | 'unknown';

export type ProjectCandidateSource =
  | 'cell'
  | 'header'
  | 'title'
  | 'sheet-name'
  | 'workbook-metadata'
  | 'document-metadata'
  | 'ocr'
  | string;

export interface ProjectNameCandidate {
  /** Text read from the source document. */
  text: string;
  /** A nearby or structural label, such as "Project Name". */
  label?: string;
  source?: ProjectCandidateSource;
  /** Zero-based document order; earlier candidates receive a small preference. */
  order?: number;
  /** Parser-provided prominence, conventionally in the range 0..1. */
  prominence?: number;
  fontSize?: number;
  bold?: boolean;
  merged?: boolean;
  row?: number;
  column?: number;
}

export type DocumentTextCandidate = ProjectNameCandidate;

export type ProjectNameDetectionMethod =
  | 'labeled-candidate'
  | 'ranked-candidate'
  | 'filename-fallback';

export interface ProjectNameResult {
  value: string;
  confidence: number;
  language: DocumentLanguage;
  method: ProjectNameDetectionMethod;
}

const PROJECT_LABEL = /(?:\bproject(?:\s+name)?\b|\btender(?:\s+name)?\b|اسم\s*المشروع)/iu;
const LEADING_PROJECT_LABEL = /^(?:project(?:\s+name)?|tender(?:\s+name)?|اسم\s*المشروع)\s*(?:[:：\-–—|]\s*|\s+)(.+)$/iu;
const ARABIC_RE = /[\u0600-\u06ff\u0750-\u077f\u0870-\u089f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/u;
const ARABIC_GLOBAL_RE = /[\u0600-\u06ff\u0750-\u077f\u0870-\u089f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/gu;
const LATIN_GLOBAL_RE = /[A-Za-z]/g;
const EXCEL_MAX_ROW_HEIGHT = 409.5;

function cleanText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\r?\n\s*/g, '\n')
    .trim();
}

function normalizedKey(value: string): string {
  return cleanText(value)
    .normalize('NFKC')
    .replace(/[ـًٌٍَُِّْ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

function extractedProjectValue(candidate: ProjectNameCandidate): { value: string; labeled: boolean } {
  const text = cleanText(candidate.text);
  const inline = LEADING_PROJECT_LABEL.exec(text);
  if (inline?.[1]) return { value: cleanText(inline[1]), labeled: true };

  const labelMatches = candidate.label != null && PROJECT_LABEL.test(cleanText(candidate.label));
  return { value: text, labeled: labelMatches };
}

function isGenericProjectTitle(value: string): boolean {
  const key = normalizedKey(value);
  if (!key || !/[\p{L}\p{N}]/u.test(key)) return true;
  if (/^(?:boq|bill of quantities|bill of quantity|quantity survey|quotation|price quotation|quote|offer|commercial offer|technical offer|financial offer|proposal|commercial proposal|technical proposal|tender|project|project name)$/u.test(key)) return true;
  if (/^(?:thank you|thanks|with thanks|شكرا|شكرا لكم)$/u.test(key)) return true;
  if (/^(?:company|company name|contractor|consultant|client|supplier|اسم الشركه)$/u.test(key)) return true;
  if (/^(?:[\p{L}\p{N}&.'’\-]+\s+){0,5}(?:company|co|llc|ltd|limited|inc|corp|corporation|contracting company)$/iu.test(cleanText(value))) return true;
  if (/^(?:جدول الكميات|عرض سعر|عرض فني|عرض مالي|اسم المشروع|اسم الشركه|شكرا لكم?)$/u.test(key)) return true;
  if (/^(?:page|صفحه)\s*[\d٠-٩۰-۹]+(?:\s*(?:of|من)\s*[\d٠-٩۰-۹]+)?$/iu.test(key)) return true;
  return false;
}

function sourceWeight(source: ProjectCandidateSource | undefined): number {
  const key = source?.toLocaleLowerCase().replace(/[ _]/g, '-') ?? '';
  if (key.includes('metadata')) return 15;
  if (key === 'title' || key.includes('document-title')) return 13;
  if (key === 'header') return 9;
  if (key === 'cell') return 5;
  if (key.includes('sheet')) return 3;
  if (key === 'ocr') return 1;
  return 0;
}

function sanitizeFileName(fileName: string): string {
  let value = fileName.split(/[\\/]/).pop() ?? fileName;
  value = value.replace(/(?:\.(?:xlsx?|xlsm|xlsb|csv|pdf|docx?|zip))+$/iu, '');
  value = value
    .replace(/[_]+/g, ' ')
    .replace(/\s+-\s+|\s*–\s*|\s*—\s*/g, ' ')
    .replace(/[<>:"/\\|?*\[\]{}]+/g, ' ')
    .replace(/\b(?:boq|bill[\s_-]*of[\s_-]*quantit(?:y|ies)|tender|quotation|quote|offer)\b/giu, ' ')
    .replace(/\b(?:rev(?:ision)?|ver(?:sion)?|v)\s*[._-]?\s*\d+[a-z]?\b/giu, ' ')
    .replace(/(?:جدول\s*الكميات|عرض\s*سعر)/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s._-]+|[\s._-]+$/g, '');
  return value || 'Untitled Project';
}

/** Rank document-grounded title candidates and fall back to a cleaned source filename. */
export function detectProjectName(
  candidates: readonly ProjectNameCandidate[],
  fileName: string,
): ProjectNameResult {
  let best: { value: string; score: number; labeled: boolean } | undefined;

  candidates.forEach((candidate, index) => {
    if (!candidate || typeof candidate.text !== 'string') return;
    const { value, labeled } = extractedProjectValue(candidate);
    if (isGenericProjectTitle(value) || value.length > 240) return;

    const order = Number.isFinite(candidate.order) ? Math.max(0, candidate.order!) : index;
    const prominence = Number.isFinite(candidate.prominence)
      ? Math.max(0, Math.min(1, candidate.prominence!))
      : 0;
    let score = labeled ? 65 : 20;
    score += sourceWeight(candidate.source);
    score += prominence * 18;
    score += Math.max(0, Math.min(12, ((candidate.fontSize ?? 11) - 10) * 1.5));
    score += candidate.bold ? 5 : 0;
    score += candidate.merged ? 4 : 0;
    score += Math.max(0, 8 - Math.log2(order + 1) * 2);
    if (candidate.row != null) score += Math.max(0, 5 - Math.log2(Math.max(1, candidate.row)));
    if (value.length < 4) score -= 15;
    if (value.length > 120) score -= 10;

    if (!best || score > best.score) best = { value, score, labeled };
  });

  if (best && (best.labeled || best.score >= 30)) {
    return {
      value: best.value,
      confidence: Math.round(Math.min(0.99, Math.max(0.35, best.score / 110)) * 100) / 100,
      language: detectDocumentLanguage(best.value),
      method: best.labeled ? 'labeled-candidate' : 'ranked-candidate',
    };
  }

  const value = sanitizeFileName(fileName);
  return {
    value,
    confidence: 0.3,
    language: detectDocumentLanguage(value),
    method: 'filename-fallback',
  };
}

const EMPTY_COMMENT = /^(?:n\s*[/.]?\s*a|n\.a\.|none|null|nil|not applicable|no comments?|no remarks?|لا\s*يوجد|غير\s*متاح|بدون\s*ملاحظات)$/iu;
const COURTESY_COMMENT = /^(?:thank(?:s|\s+you)(?:\s+(?:very much|for your (?:time|attention|business)))?|best regards|kind regards|regards|sincerely(?: yours)?|yours (?:faithfully|sincerely)|مع\s*(?:خالص\s*)?التحي(?:ه|ات)|وتفضلوا بقبول فائق الاحترام|شكرا(?:\s+لكم)?)[\s.!،,]*$/iu;
const SIGNATURE_COMMENT = /^(?:(?:prepared|checked|approved|submitted|signed)\s+by|signature|authorized signatory|name\s*:\s*|date\s*:\s*|التوقيع|اعداد|اعده|مراجعه|اعتماد)(?:\s*[\p{L}. ]{0,60})?$/iu;
const TOTAL_COMMENT = /^(?:(?:grand\s+)?total|sub[ -]?total|amount|net amount|carried (?:forward|to collection)|brought forward| الاجمالي|الإجمالي|اجمالي|المجموع|المبلغ)(?:\s*[:=]?\s*[\p{Sc}]?\s*[\d٠-٩۰-۹,.]+)?$/iu;
const HEADER_COMMENT = /^(?:(?:item|item no|code|description|unit|qty|quantity|rate|price|amount|remarks?)(?:\s*[|/\-,:]\s*|\s+)){2,}(?:item|code|description|unit|qty|quantity|rate|price|amount|remarks?)$/iu;
const ARABIC_HEADER_COMMENT = /^(?:(?:البند|الكود|الوصف|الوحده|الوحدة|الكميه|الكمية|السعر|الفئه|الفئة|المبلغ|الاجمالي|الإجمالي|ملاحظات)(?:\s*[|/\-،,:]\s*|\s+)){2,}(?:البند|الكود|الوصف|الوحده|الوحدة|الكميه|الكمية|السعر|الفئه|الفئة|المبلغ|الاجمالي|الإجمالي|ملاحظات)$/u;
const LEGAL_COMMENT = /^(?:confidential(?: and proprietary)?|all rights reserved|terms and conditions(?: apply)?|without prejudice|subject to (?:our|the) (?:terms|conditions|approval)|this (?:document|quotation|offer) (?:is|remains) .{0,100}|for (?:internal|official) use only|not for distribution|سري(?:\s+للغايه)?|جميع الحقوق محفوظه)$/iu;
const PAGE_COMMENT = /^(?:(?:page|صفحه|الصفحه)\s*[\d٠-٩۰-۹]+\s*(?:(?:of|من)\s*[\d٠-٩۰-۹]+)?|(?:www\.)?[^\s]+\.(?:com|net|org)(?:\s*[|·-]\s*[^\s]+)?)[\s.!،,]*$/iu;

/** Return true only for text that can carry useful document-specific context. */
export function isMeaningfulComment(text: string): boolean {
  if (typeof text !== 'string') return false;
  const value = cleanText(text);
  if (!value || !/[\p{L}\p{N}]/u.test(value)) return false;
  if (EMPTY_COMMENT.test(value) || COURTESY_COMMENT.test(value) || SIGNATURE_COMMENT.test(value)) return false;
  if (TOTAL_COMMENT.test(value) || HEADER_COMMENT.test(value) || ARABIC_HEADER_COMMENT.test(value)) return false;
  if (LEGAL_COMMENT.test(value) || PAGE_COMMENT.test(value)) return false;
  if (/^(?:boq|bill of quantities|quotation|commercial offer|technical offer)$/iu.test(value)) return false;
  return true;
}

/** Normalize, remove boilerplate, and de-duplicate comments while preserving first-seen wording. */
export function filterMeaningfulComments(values: readonly unknown[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    if (typeof raw !== 'string') continue;
    const value = cleanText(raw);
    if (!isMeaningfulComment(value)) continue;
    const key = normalizedKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function containsArabic(text: string): boolean {
  return typeof text === 'string' && ARABIC_RE.test(text);
}

export function detectDocumentLanguage(text: string | readonly unknown[]): DocumentLanguage {
  const joined = Array.isArray(text)
    ? text.filter((value): value is string => typeof value === 'string').join(' ')
    : String(text ?? '');
  const arabicCount = joined.match(ARABIC_GLOBAL_RE)?.length ?? 0;
  const latinCount = joined.match(LATIN_GLOBAL_RE)?.length ?? 0;
  if (arabicCount > 0 && latinCount > 0) return 'mixed';
  if (arabicCount > 0) return 'ar';
  if (latinCount > 0) return 'en';
  return 'unknown';
}

function glyphWidth(character: string): number {
  if (/\p{M}/u.test(character)) return 0;
  if (ARABIC_RE.test(character)) return 1.2;
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(character)) return 2;
  if (/\s/u.test(character)) return 0.5;
  if (/[MW@#%&]/.test(character)) return 1.35;
  if (/[A-Z0-9]/.test(character)) return 1.05;
  if (/[,.'’`!:;|ilI\-]/.test(character)) return 0.5;
  return 0.9;
}

function wrappedLineCount(text: string, capacity: number): number {
  let lines = 0;
  for (const explicitLine of text.split(/\r\n|\r|\n/)) {
    let used = 0;
    let lineCount = 1;
    for (const character of explicitLine) {
      const width = glyphWidth(character);
      if (used > 0 && used + width > capacity) {
        lineCount++;
        used = 0;
      }
      used += width;
    }
    lines += lineCount;
  }
  return Math.max(1, lines);
}

/** Estimate an Excel row height in points for wrapped cells. */
export function estimateWrappedRowHeight(
  texts: readonly unknown[],
  widths: readonly number[],
  fontSize = 11,
): number {
  const safeFontSize = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 11;
  let maxLines = 1;
  for (let index = 0; index < texts.length; index++) {
    const text = texts[index] == null ? '' : String(texts[index]);
    const width = widths[index] ?? widths[widths.length - 1] ?? 10;
    const safeWidth = Number.isFinite(width) && width > 0 ? width : 1;
    const capacity = Math.max(0.5, safeWidth * (11 / safeFontSize));
    maxLines = Math.max(maxLines, wrappedLineCount(text, capacity));
  }
  const height = maxLines * safeFontSize * 1.25 + 4;
  return Math.min(EXCEL_MAX_ROW_HEIGHT, Math.round(height * 2) / 2);
}
