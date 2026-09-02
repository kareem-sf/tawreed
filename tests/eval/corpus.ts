// Corpus loading for classification evaluation.
//
// Two shapes are supported so the committed synthetic set stays self-contained while a
// real BOQ can be evaluated as it actually ingests:
//
//   <name>.case.json    { name, items: BoqItem[], labels: { "<itemId>": "WP-..." } }
//   <name>.xlsx  plus   <name>.labels.json  { name?, byRow: { "<sheetRow>": "WP-..." } }
//
// Real workbooks are keyed by source sheet row rather than item id, because item ids are
// assigned during ingest and would silently shift the moment row detection improves.
// Labels are trade groupings, not codes the classifier must reproduce verbatim — see
// ./score.ts for why naming is irrelevant to the metric.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { BoqItem } from '../../shared/types';
import { inspectDocument } from '../../engine/inspect-document';

export interface EvalCase {
  name: string;
  items: BoqItem[];
  /** item id → expected trade grouping. */
  labels: Map<number, string>;
}

interface CaseJson {
  name?: string;
  items: BoqItem[];
  labels: Record<string, string>;
}

interface LabelsJson {
  name?: string;
  byRow: Record<string, string>;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function loadCaseJson(raw: CaseJson, fallbackName: string): EvalCase {
  const labels = new Map<number, string>();
  const ids = new Set(raw.items.map((item) => item.id));
  for (const [id, code] of Object.entries(raw.labels)) {
    const itemId = Number(id);
    if (!ids.has(itemId)) throw new Error(`${fallbackName}: label for unknown item id ${id}`);
    labels.set(itemId, code);
  }
  return { name: raw.name ?? fallbackName, items: raw.items, labels };
}

async function loadWorkbookCase(dir: string, base: string): Promise<EvalCase> {
  const bytes = new Uint8Array(await readFile(join(dir, `${base}.xlsx`)));
  const inspection = await inspectDocument(bytes, `${base}.xlsx`);
  const raw = await readJson<LabelsJson>(join(dir, `${base}.labels.json`));
  const labels = new Map<number, string>();
  const unmatched: string[] = [];
  for (const [row, code] of Object.entries(raw.byRow)) {
    const item = inspection.items.find((candidate) => candidate.row === Number(row));
    if (!item) {
      unmatched.push(row);
      continue;
    }
    labels.set(item.id, code);
  }
  // A label pointing at a row ingest no longer produces means the corpus and the ingest
  // have drifted apart; scoring it silently would quietly shrink the measured set.
  if (unmatched.length > 0) {
    throw new Error(`${base}: ${unmatched.length} label row(s) not found after ingest: ${unmatched.join(', ')}`);
  }
  return { name: raw.name ?? base, items: inspection.items, labels };
}

/** Load every case in a directory. A missing directory yields an empty corpus. */
export async function loadCorpus(dir: string): Promise<EvalCase[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const cases: EvalCase[] = [];
  for (const entry of entries.sort()) {
    if (entry.endsWith('.case.json')) {
      const base = entry.slice(0, -'.case.json'.length);
      cases.push(loadCaseJson(await readJson<CaseJson>(join(dir, entry)), base));
    } else if (entry.endsWith('.xlsx') && !entry.startsWith('~$')) {
      cases.push(await loadWorkbookCase(dir, entry.slice(0, -'.xlsx'.length)));
    }
  }
  return cases;
}
