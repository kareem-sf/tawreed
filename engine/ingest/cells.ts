// Low-level ExcelJS cell-value readers: text/number coercion shared by every
// higher-level BOQ table discovery step.
import ExcelJS from 'exceljs';
import { parseNumber } from '../normalize';

export function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return v.result != null ? String(v.result) : '';
    if (v instanceof Date) return '';
    return '';
  }
  return String(v);
}

export function cellNumber(v: ExcelJS.CellValue): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && v !== null && 'result' in v) {
    const r = (v as { result?: unknown }).result;
    if (typeof r === 'number') return Number.isFinite(r) ? r : null;
    if (typeof r === 'string') return cellNumber(r); // re-route through the text path
    return null;
  }
  const text = cellText(v).trim();
  if (!text) return null;
  // Never turn embedded specification digits ("Concrete C30", "Cable 4x25") into prices.
  const numericText = text
    .replace(/\b(?:egp|usd|eur|gbp|sar|aed|qar|kwd|omr)\b/gi, '')
    .replace(/(?:ج\.?\s?م|ريال|دولار|درهم)/g, '')
    .trim();
  // Quantities may carry inline units ("12 m3", "250 TR", "(500) m3") — accept
  // leading-numeric text, but still reject text-first specs ("Concrete C30").
  // The unit suffix must be whitespace-separated: glued forms ("4x25", "250TR")
  // stay rejected, preserving the old dimension-spec guard.
  if (!/^[\d٠-٩۰-۹]/.test(numericText) && !/^[(\-.][\d٠-٩۰-۹\s]/.test(numericText)) return null;
  if (!/^[\d٠-٩۰-۹\s.,٬٫()\-+%a-zA-Z\u0600-\u06FF]+$/.test(numericText)) return null;
  const head = numericText.match(/^[^a-zA-Z\u0600-\u06FF]*/)?.[0] ?? '';
  const tail = numericText.slice(head.length);
  if (tail !== '' && !/\s$/.test(head) && !/^\s/.test(tail)) return null;
  return parseNumber(head);
}

/** Shared numeric classifier — aligned with cellNumber's currency stripping + Arabic-Indic digit/separator handling. */
export function isNumericLike(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === 'number') return Number.isFinite(raw);
  if (typeof raw === 'object' && raw !== null && 'result' in raw) return isNumericLike((raw as Record<string, unknown>).result);
  const text = String(raw).trim();
  if (!text) return false;
  // Strip the same currency tokens as cellNumber, then separators/symbols (incl. Arabic decimal ٫ and thousands ٬)
  const stripped = text
    .replace(/\b(?:egp|usd|eur|gbp|sar|aed|qar|kwd|omr)\b/gi, '')
    .replace(/(?:ج\.?\s?م|ريال|دولار|درهم)/g, '')
    .replace(/[\s,.$€£¥%()\-+٬٫]/g, '')
    .replace(/[ًٌٍَُِّْـ]/g, '');
  return /^[\d٠-٩۰-۹.]+$/.test(stripped) && stripped.length > 0;
}
