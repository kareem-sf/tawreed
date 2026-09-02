import type { RunRecord } from '../../../shared/types';

// Plain-text, human-readable dump of a single run — meant to be pasted into an
// email or support ticket, not parsed by machine. Keep it readable over compact.
export function formatRunForSupport(run: RunRecord): string {
  const lines: string[] = [];
  lines.push(`Tawreed run details — ${new Date(run.startedAt).toLocaleString()}`);
  lines.push(`File: ${run.fileName}`);
  if (run.projectName) lines.push(`Project: ${run.projectName}`);
  if (run.revision) lines.push(`Revision: ${run.revision}`);
  lines.push(`Items → packages: ${run.itemCount} → ${run.packageCount}`);
  lines.push(`Warnings: ${run.warningCount} · Errors: ${run.errorCount}`);
  lines.push(`AI used: ${run.llmUsed ? 'yes' : 'no'}`);
  if (run.llmUsed) {
    lines.push(`Provider: ${run.provider ?? 'unknown'}`);
    lines.push(`Model: ${run.model || '(default)'}`);
    if (run.memoryApplied) lines.push(`Memory matches applied: ${run.memoryApplied}`);
  }
  lines.push(`Output file: ${run.outputFile}`);
  if (run.packageFolder) lines.push(`Packages folder: ${run.packageFolder}`);
  lines.push('');
  lines.push(`Steps (${run.trace?.length ?? 0}):`);
  if (run.trace && run.trace.length > 0) {
    for (const event of run.trace) {
      const at = new Date(event.at).toLocaleTimeString();
      lines.push(`  [${at}] ${event.stage} — ${event.status}: ${event.detail}`);
    }
  } else {
    lines.push('  (no steps recorded)');
  }
  return lines.join('\n');
}
