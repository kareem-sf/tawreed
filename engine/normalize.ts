// Normalization: Arabic-Indic digits, Arabic unit variants, locale number parsing.
import type { Unit } from '../shared/types';

const AR_INDIC = '٠١٢٣٤٥٦٧٨٩'; // U+0660..U+0669
const EXT_INDIC = '۰۱۲۳۴۵۶۷۸۹'; // U+06F0..U+06F9 (Extended Arabic-Indic / Persian)

export function normalizeDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const ai = AR_INDIC.indexOf(ch);
    if (ai >= 0) { out += String(ai); continue; }
    const ei = EXT_INDIC.indexOf(ch);
    if (ei >= 0) { out += String(ei); continue; }
    out += ch;
  }
  return out;
}

/** Parse a number tolerant of Arabic digits, Arabic decimal separator, thousands commas, currency text. */
export function parseNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = normalizeDigits(String(raw))
    .replace(/[٬,]/g, '') // thousands separators (Arabic + western)
    .replace(/[٫]/g, '.') // Arabic decimal separator
    .replace(/[^\d.\-()]/g, '') // drop currency symbols, units, whitespace
    .trim();
  if (!s) return null;
  // Accounting parentheses = negative
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) s = '-' + paren[1];
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const UNIT_MAP: Record<string, Unit> = {
  // metric length/area/volume
  'm': 'm', 'م': 'm', 'متر': 'm', 'امتار': 'm', 'ml': 'm', 'lm': 'm', "m'": 'm',
  'm2': 'm2', 'm²': 'm2', 'sqm': 'm2', 'م2': 'm2', 'م²': 'm2', 'متر مربع': 'm2', 'مربع': 'm2',
  'm3': 'm3', 'm³': 'm3', 'cum': 'm3', 'م3': 'm3', 'م³': 'm3', 'متر مكعب': 'm3', 'مكعب': 'm3',
  // weight
  'kg': 'kg', 'كجم': 'kg', 'كغ': 'kg', 'كيلو': 'kg', 'كيلوجرام': 'kg',
  'ton': 'ton', 't': 'ton', 'طن': 'ton', 'tons': 'ton',
  // count / lump / point / cooling
  'nr': 'nr', 'no': 'nr', 'nos': 'nr', 'ea': 'nr', 'each': 'nr', 'pc': 'nr', 'pcs': 'nr',
  'عدد': 'nr', 'قطعة': 'nr', 'وحدة': 'nr', 'باب': 'nr',
  'ls': 'ls', 'l.s': 'ls', 'lumpsum': 'ls', 'lump sum': 'ls', 'مقطوعية': 'ls', 'بند مقطوعية': 'ls',
  'pt': 'pt', 'point': 'pt', 'points': 'pt', 'نقطة': 'pt', 'نقط': 'pt',
  'tr': 'TR', 'طن تبريد': 'TR', 'طن تبريدى': 'TR',
  'hr': 'hr', 'hour': 'hr', 'ساعة': 'hr',
  'day': 'day', 'يوم': 'day', 'ايام': 'day',
};

// Build a normalized lookup so Arabic letter variants (ة→ه, ى→ي, أإآ→ا) and
// diacritics/tatweel differences match the UNIT_MAP keys consistently.
const NORMALIZED_UNIT_MAP = new Map<string, Unit>();
for (const [key, unit] of Object.entries(UNIT_MAP)) {
  NORMALIZED_UNIT_MAP.set(normalizeText(key), unit);
}

export function canonicalUnit(raw: unknown): Unit {
  const text = normalizeText(String(raw ?? ''));
  if (!text) return 'other';
  const mapped = NORMALIZED_UNIT_MAP.get(text);
  if (mapped) return mapped;
  // English lowercase fallback checks.
  const s = normalizeDigits(String(raw))
    .replace(/[ًٌٍَُِّْـ]/g, '') // strip Arabic diacritics + tatweel
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return UNIT_MAP[s] ?? 'other';
}

/** Collapse whitespace, strip diacritics, normalize Arabic letter variants for matching. */
export function normalizeText(input: string): string {
  return normalizeDigits(input)
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىئ]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
