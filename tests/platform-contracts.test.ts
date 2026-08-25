import { describe, expect, it } from 'vitest';
import {
  connectionSummarySchema,
  projectSummarySchema,
  runtimeBootstrapStatusSchema,
} from '../shared/platform';

describe('platform contracts', () => {
  it('accepts a bounded runtime progress state', () => {
    expect(runtimeBootstrapStatusSchema.parse({
      phase: 'downloading', progress: 42, component: 'agent-kernel',
      version: '1.0.0', errorCode: null, recoverable: false,
    }).progress).toBe(42);
    expect(() => runtimeBootstrapStatusSchema.parse({
      phase: 'downloading', progress: 101, component: null,
      version: null, errorCode: null, recoverable: false,
    })).toThrow();
  });

  it('rejects secrets from renderer-facing connection summaries', () => {
    expect(() => connectionSummarySchema.parse({
      provider: 'codex', configured: true, authenticated: true,
      authKind: 'api_key', displayName: 'Codex', apiKey: 'secret',
    })).toThrow();
  });

  it('accepts a safe project summary', () => {
    expect(projectSummarySchema.parse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Project Atlas', status: 'active', updatedAtMs: 1,
    }).name).toBe('Project Atlas');
  });
});
