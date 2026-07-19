// Heuristic classifier — deterministic, offline, bilingual. Also the LLM fallback.
import type { BoqItem, Classification } from '../../shared/types';
import { normalizeText } from '../normalize';
import { TAXONOMY } from './taxonomy';

const MIN_SCORE = 2; // below this → unclassified (goes to LLM or fallback)

function score(item: BoqItem): { packageCode: string; confidence: number; hits: number } {
  const text = normalizeText(item.description + ' ' + item.code);
  let bestCode = '';
  let bestHits = 0;
  let secondHits = 0;
  for (const pkg of TAXONOMY) {
    let hits = 0;
    for (const kw of pkg.keywords) {
      if (text.includes(kw)) hits += kw.length >= 5 ? 2 : 1; // longer matches are more specific
    }
    if (hits > bestHits) { secondHits = bestHits; bestHits = hits; bestCode = pkg.code; }
    else if (hits > secondHits) secondHits = hits;
  }
  // Confidence grows with margin over the runner-up and absolute hit strength.
  const margin = bestHits - secondHits;
  const confidence = bestHits === 0 ? 0 : Math.min(0.95, 0.45 + bestHits * 0.1 + margin * 0.15);
  return { packageCode: bestCode, confidence, hits: bestHits };
}

export function heuristicClassify(items: BoqItem[]): { classified: Classification[]; remaining: BoqItem[] } {
  const classified: Classification[] = [];
  const remaining: BoqItem[] = [];
  for (const item of items) {
    const s = score(item);
    if (s.hits >= MIN_SCORE) {
      classified.push({ itemId: item.id, packageCode: s.packageCode, confidence: +s.confidence.toFixed(2), source: 'heuristic' });
    } else {
      remaining.push(item);
    }
  }
  return { classified, remaining };
}

/** Force-assign an item using the best available (possibly weak) heuristic guess. */
export function heuristicFallback(item: BoqItem): Classification {
  const s = score(item);
  return { itemId: item.id, packageCode: s.packageCode || 'WP-99', confidence: +s.confidence.toFixed(2), source: 'fallback' };
}
