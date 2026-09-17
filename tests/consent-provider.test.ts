import { describe, expect, it } from 'vitest';
import { consentProviderName } from '../src/features/workflow/components/WorkflowWorkspace';

const t = (key: string) => (key === 'connectedService' ? 'Connected service' : key);

describe('consentProviderName', () => {
  it('names every provider distinctly (no Anthropic fall-through)', () => {
    expect(consentProviderName('codex', t)).toBe('Codex');
    expect(consentProviderName('anthropic', t)).toBe('Anthropic');
    expect(consentProviderName('gemini', t)).toBe('Gemini');
    expect(consentProviderName('grok', t)).toBe('Grok');
    expect(consentProviderName('compatible', t)).toBe('Connected service');
    expect(consentProviderName('none', t)).toBe('Connected service');
  });
});
