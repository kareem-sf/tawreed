// The workflow maps raw provider exceptions to plain-language UI copy. The strings on the
// left are the ones Rust actually emits (src-tauri/src/commands/ai.rs), so if a message is
// reworded there without updating the patterns, a specific and actionable error silently
// degrades to the generic "something went wrong" — these tests are the tripwire.
import { describe, it, expect } from 'vitest';
import { errorMessage, friendlyErrorMessage, isCancellation } from '../src/features/workflow/errors';

/** Stand-in for i18next: returns the key so assertions name the intended message. */
const t = (key: string): string => key;

describe('friendlyErrorMessage', () => {
  it('recognises a network failure from every provider label', () => {
    // send_with_retry formats these as `{provider_label} network error: {error}`.
    for (const raw of [
      'gemini network error: connection reset',
      'grok network error: dns failure',
      'Compatible provider network error: timeout',
      'Anthropic network error: broken pipe',
      'fetch failed',
      'NetworkError when attempting to fetch resource',
    ]) {
      expect(friendlyErrorMessage(new Error(raw), t), raw).toBe('errorNetwork');
    }
  });

  it('recognises a missing credential', () => {
    for (const raw of [
      'No gemini key is saved. Open Settings and add it.',
      'No grok key is saved. Open Settings and add it.',
      'No compatible provider key is saved. Open Settings and add the service API key.',
      'No Anthropic API key configured. Open Settings in Tawreed to add one.',
    ]) {
      expect(friendlyErrorMessage(new Error(raw), t), raw).toBe('errorNoProviderKey');
    }
  });

  it('recognises a thinking model that spent its whole budget', () => {
    const raw = 'gemini used its entire output budget before answering. '
      + 'Choose a model with a smaller reasoning step, or raise the token limit.';
    expect(friendlyErrorMessage(new Error(raw), t)).toBe('errorTokenBudget');
  });

  it('recognises a timeout', () => {
    expect(friendlyErrorMessage(new Error('operation timed out'), t)).toBe('errorTimedOut');
  });

  it('passes through the publish-recovery message verbatim, since it names a real path', () => {
    const raw = 'Could not publish the revision (os error 32). The generated files are '
      + 'preserved at C:\\Users\\me\\.tawreed\\out — close whatever is using them and try again.';
    expect(friendlyErrorMessage(new Error(raw), t)).toBe(raw);
  });

  it('falls back to the generic message for anything unrecognised', () => {
    expect(friendlyErrorMessage(new Error('parse provider response: trailing comma'), t))
      .toBe('errorGeneric');
    expect(friendlyErrorMessage('a bare string', t)).toBe('errorGeneric');
  });

  it('does not mistake an empty-response error for a token-budget one', () => {
    expect(friendlyErrorMessage(new Error('gemini returned an empty response'), t))
      .toBe('errorGeneric');
  });
});

describe('errorMessage', () => {
  it('unwraps an Error and stringifies anything else', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(42)).toBe('42');
  });
});

describe('isCancellation', () => {
  it('detects the AbortError the bridge normalises cancellations into', () => {
    const abort = new Error('cancelled');
    abort.name = 'AbortError';
    expect(isCancellation(abort)).toBe(true);
  });

  it('does not treat a provider failure as a cancellation', () => {
    expect(isCancellation(new Error('gemini error 500: upstream'))).toBe(false);
    expect(isCancellation('cancelled')).toBe(false);
  });
});
