// Test-only harness: composes bytes → inspection → classification → validation →
// packages so end-to-end tests do not each rebuild that chain. Production drives the
// same steps from the workflow hook, which needs per-stage progress and consent gating.
import type { PipelineResult } from '../shared/types';
import { inspectDocument } from '../engine/inspect-document';
import { classifyAll, type ClassifyOptions } from '../engine/classify';
import { buildPackages, validate } from '../engine/validate';

export async function runPipeline(
  bytes: ArrayBuffer | Uint8Array,
  fileName: string,
  opts: ClassifyOptions
): Promise<PipelineResult> {
  const inspection = await inspectDocument(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), fileName);
  const classifications = await classifyAll(inspection.items, opts);
  const packages = buildPackages(inspection.items, classifications);
  const issues = validate(inspection.items, classifications, packages);
  const unclassifiedCount = classifications.filter((c) => c.packageCode === 'WP-99').length;
  return { inspection, classifications, packages, issues, unclassifiedCount };
}
