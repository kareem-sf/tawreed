// Auto-pilot publish verdict — the machine gate for unattended publishing.
//
// Clean means: no error-severity issues, nothing left unclassified, nothing
// low-confidence. Advisory warnings (total mismatch, outliers, duplicates,
// deductions) do not block: they travel in the trace and run history instead.
// Human review is the only thing being removed; every machine check still applies.
import type { Classification, ValidationIssue } from '../shared/types';

export interface AutopilotVerdict {
  clean: boolean;
  reasonsEn: string[];
  reasonsAr: string[];
}

const BLOCKING_CODES = new Set(['UNCLASSIFIED', 'LOW_CONFIDENCE']);

export function autopilotVerdict(
  issues: ValidationIssue[],
  classifications: Classification[],
): AutopilotVerdict {
  const reasonsEn: string[] = [];
  const reasonsAr: string[] = [];
  for (const issue of issues) {
    if (issue.severity === 'error' || BLOCKING_CODES.has(issue.code)) {
      reasonsEn.push(issue.messageEn);
      reasonsAr.push(issue.messageAr);
    }
  }
  // Robust against a stale issues list: WP-99 in the classifications always blocks.
  const unclassified = classifications.filter((c) => c.packageCode === 'WP-99').length;
  if (unclassified > 0 && !issues.some((i) => i.code === 'UNCLASSIFIED')) {
    reasonsEn.push(`${unclassified} item(s) could not be classified — review the WP-99 package.`);
    reasonsAr.push(`${unclassified} بند لم يتم تصنيفه — راجع حزمة WP-99.`);
  }
  return { clean: reasonsEn.length === 0, reasonsEn, reasonsAr };
}
