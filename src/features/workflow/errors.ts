import { WorkerCancelledError } from '../../boq-worker';

export function isCancellation(reason: unknown): boolean {
  return reason instanceof WorkerCancelledError
    || (reason instanceof Error && reason.name === 'AbortError');
}

export function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Maps a raw exception to plain language for the workflow UI; the raw text is
 * logged separately (appLog) so support can still see the technical detail.
 *
 * The patterns match the error strings Rust actually emits (see
 * src-tauri/src/commands/ai.rs), so changing a message there without updating these
 * silently downgrades a specific, actionable error to the generic one. */
export function friendlyErrorMessage(reason: unknown, t: (key: string) => string): string {
  const raw = errorMessage(reason);
  if (/network error|fetch failed|NetworkError/i.test(raw)) return t('errorNetwork');
  if (/no .*key is (saved|configured)|api key/i.test(raw)) return t('errorNoProviderKey');
  if (/timed out/i.test(raw)) return t('errorTimedOut');
  if (/output budget/i.test(raw)) return t('errorTokenBudget');
  if (/preserved at/i.test(raw)) return raw;
  return t('errorGeneric');
}
