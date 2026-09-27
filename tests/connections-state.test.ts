import { describe, expect, it } from 'vitest';
import { connectionSummarySchema } from '../shared/platform';
import {
  canSaveApiKey,
  codexConnection,
  connectionsReducer,
  hasHealthyProvider,
  initialConnectionsState,
} from '../src/features/connections/reducer';
import { isAgentHealthy, parseConnectionSummaries } from '../src/features/connections/types';

const validCodexSummary = {
  provider: 'codex',
  configured: true,
  authenticated: true,
  authKind: 'provider_file',
  displayName: 'Codex',
};

describe('connection summaries never carry secrets', () => {
  it('rejects renderer-facing summaries that contain a key field', () => {
    expect(() => connectionSummarySchema.parse({
      ...validCodexSummary,
      apiKey: 'sk-test',
    })).toThrow();
    expect(() => parseConnectionSummaries([
      validCodexSummary,
      { provider: 'claude', configured: true, authenticated: false, value: 'secret' },
    ])).toThrow();
  });

  it('accepts bounded redacted summaries and stores only parsed data', () => {
    const summaries = parseConnectionSummaries([validCodexSummary]);
    expect(summaries).toHaveLength(1);
    expect(JSON.stringify(summaries)).not.toContain('sk-');
    const state = connectionsReducer(initialConnectionsState(), {
      type: 'refresh/completed',
      summaries: [validCodexSummary],
    });
    expect(state.summaries).toEqual([validCodexSummary]);
  });
});

describe('plaintext acknowledgement gates the first save', () => {
  it('refuses to save until the warning is acknowledged', () => {
    let state = initialConnectionsState();
    expect(canSaveApiKey(state)).toBe(false);
    state = connectionsReducer(state, { type: 'api-key/changed', value: 'sk-test' });
    expect(canSaveApiKey(state)).toBe(false);
    state = connectionsReducer(state, { type: 'plaintext/acknowledged' });
    expect(canSaveApiKey(state)).toBe(true);
  });

  it('never saves while a task owns the single working slot', () => {
    let state = connectionsReducer(initialConnectionsState(), {
      type: 'task/started',
      slot: 'chatgpt-login',
    });
    state = connectionsReducer(state, { type: 'plaintext/acknowledged' });
    state = connectionsReducer(state, { type: 'api-key/changed', value: 'sk-test' });
    expect(canSaveApiKey(state)).toBe(false);
    state = connectionsReducer(state, { type: 'task/finished' });
    expect(canSaveApiKey(state)).toBe(true);
  });

  it('keeps the acknowledgement latched after the input is cleared', () => {
    let state = connectionsReducer(initialConnectionsState(), {
      type: 'plaintext/acknowledged',
    });
    state = connectionsReducer(state, { type: 'api-key/cleared' });
    expect(canSaveApiKey(state)).toBe(false);
    state = connectionsReducer(state, { type: 'api-key/changed', value: 'sk-next' });
    expect(canSaveApiKey(state)).toBe(true);
  });
});

describe('login actions are mutually exclusive', () => {
  it('selects exactly one mode at a time', () => {
    let state = connectionsReducer(initialConnectionsState(), {
      type: 'mode/selected',
      mode: 'chatgpt',
    });
    expect(state.mode).toBe('chatgpt');
    state = connectionsReducer(state, { type: 'mode/selected', mode: 'api-key' });
    expect(state.mode).toBe('api-key');
    state = connectionsReducer(state, { type: 'mode/cleared' });
    expect(state.mode).toBeNull();
  });

  it('ignores a second task while one is already running', () => {
    let state = connectionsReducer(initialConnectionsState(), {
      type: 'task/started',
      slot: 'api-key-save',
    });
    state = connectionsReducer(state, {
      type: 'task/started',
      slot: 'health-check',
    });
    expect(state.working).toBe('api-key-save');
  });
});

describe('a failed health check never marks the connection ready', () => {
  it('requires both an authenticated summary and a passing agent health check', () => {
    const authenticatedState: Parameters<typeof hasHealthyProvider>[0] = {
      ...initialConnectionsState(),
      summaries: parseConnectionSummaries([validCodexSummary]),
    };
    expect(hasHealthyProvider({ ...authenticatedState, agentHealthOk: null })).toBe(true);
    expect(hasHealthyProvider({ ...authenticatedState, agentHealthOk: true })).toBe(true);
    expect(hasHealthyProvider({ ...authenticatedState, agentHealthOk: false })).toBe(false);

    const unauthenticatedState = {
      ...initialConnectionsState(),
      agentHealthOk: true,
    };
    expect(hasHealthyProvider(unauthenticatedState)).toBe(false);
  });

  it('treats a malformed agent health payload as unhealthy', () => {
    expect(isAgentHealthy({ status: 'ok', protocolVersion: 1 })).toBe(true);
    expect(isAgentHealthy({ status: 'error', protocolVersion: 1 })).toBe(false);
    expect(isAgentHealthy(null)).toBe(false);
  });
});

describe('codex card state helpers', () => {
  it('finds the codex summary for Test and Remove actions', () => {
    const empty = initialConnectionsState();
    expect(codexConnection(empty)).toBeUndefined();
    const withCodex = connectionsReducer(empty, {
      type: 'refresh/completed',
      summaries: [validCodexSummary],
    });
    expect(codexConnection(withCodex)?.provider).toBe('codex');
  });

  it('surfaces refresh failures while retaining the previous summaries', () => {
    let state = connectionsReducer(initialConnectionsState(), {
      type: 'refresh/completed',
      summaries: [validCodexSummary],
    });
    state = connectionsReducer(state, { type: 'refresh/failed', error: 'bridge_down' });
    expect(state.lastError).toBe('bridge_down');
    expect(state.summaries).toHaveLength(1);
  });
});
