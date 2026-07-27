// Heuristic classifier — deterministic, offline, bilingual. Also the LLM fallback.
import type { BoqItem, Classification } from '../../shared/types';
import { normalizeText } from '../normalize';
import { TAXONOMY } from './taxonomy';

const MIN_SCORE = 2; // below this → unclassified (goes to LLM or fallback)

const ARABIC_KEYWORD_RE = /[؀-ۿ]/;

/** Word-boundary-aware match: long keywords are safe for substring, short ones need a token match. */
function matchesKeyword(text: string, kw: string): boolean {
  if (kw.length >= 6) return text.includes(kw); // long keywords are safe for substring
  const tokens = text.split(/\s+/);
  // Short Arabic keywords prefix-match unrelated words (صب inside صباغه) — require an exact token.
  if (kw.length <= 3 && ARABIC_KEYWORD_RE.test(kw)) return tokens.some((t) => t === kw);
  // For short keywords, require word-boundary match (exact token or prefix).
  return tokens.some((t) => t === kw || t.startsWith(kw));
}

function score(item: BoqItem): {
  packageCode: string;
  packageNameEn?: string;
  packageNameAr?: string;
  confidence: number;
  hits: number;
} {
  const text = normalizeText(item.description + ' ' + item.code);
  let bestCode = '';
  let bestHits = 0;
  let bestLongest = 0;
  let secondHits = 0;
  for (const pkg of TAXONOMY) {
    let hits = 0;
    let longest = 0;
    // Deduplicate: distinct raw keywords can normalize to the same string (e.g. خرسانه/خرسانة).
    for (const kw of new Set(pkg.keywords)) {
      if (matchesKeyword(text, kw)) {
        hits += kw.length >= 5 ? 2 : 1; // longer matches are more specific
        longest = Math.max(longest, kw.length);
      }
    }
    for (const negative of new Set(pkg.negativeKeywords ?? [])) {
      if (matchesKeyword(text, negative)) hits -= negative.length >= 5 ? 3 : 2;
    }
    if (hits > 0 && pkg.unitSignals?.includes(item.unit)) hits += 1;
    if (hits > 0) hits += pkg.priority ?? 0;
    hits = Math.max(0, hits);
    // On a score tie, prefer the package with the longer (more specific) keyword match —
    // e.g. 'screed finish' (WP-04) beats plain 'screed' (WP-02) for the same points.
    if (hits > bestHits) { secondHits = bestHits; bestHits = hits; bestCode = pkg.code; bestLongest = longest; }
    else if (hits > 0 && hits === bestHits && longest > bestLongest) { secondHits = Math.max(secondHits, bestHits); bestCode = pkg.code; bestLongest = longest; }
    else if (hits > secondHits) secondHits = hits;
  }
  // Confidence grows with margin over the runner-up and absolute hit strength.
  const margin = bestHits - secondHits;
  const confidence = bestHits === 0
    ? 0
    : Math.min(0.97, 0.42 + bestHits * 0.08 + Math.max(0, margin) * 0.13);
  const definition = TAXONOMY.find((pkg) => pkg.code === bestCode);
  return {
    packageCode: bestCode,
    packageNameEn: definition?.nameEn,
    packageNameAr: definition?.nameAr,
    confidence,
    hits: bestHits,
  };
}

export function heuristicClassify(items: BoqItem[]): { classified: Classification[]; remaining: BoqItem[] } {
  const classified: Classification[] = [];
  const remaining: BoqItem[] = [];
  for (const item of items) {
    const s = score(item);
    if (s.hits >= MIN_SCORE) {
      classified.push({
        itemId: item.id,
        packageCode: s.packageCode,
        packageNameEn: s.packageNameEn,
        packageNameAr: s.packageNameAr,
        confidence: +s.confidence.toFixed(2),
        source: 'heuristic',
      });
    } else {
      remaining.push(item);
    }
  }
  return { classified, remaining };
}

/** Force-assign an item using the best available (possibly weak) heuristic guess. */
export function heuristicFallback(item: BoqItem): Classification {
  const s = score(item);
  return {
    itemId: item.id,
    packageCode: s.packageCode || 'WP-99',
    packageNameEn: s.packageNameEn,
    packageNameAr: s.packageNameAr,
    confidence: +s.confidence.toFixed(2),
    source: 'fallback',
  };
}
