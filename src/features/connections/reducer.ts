import type { ConnectionSummary } from '../../../shared/platform';
import { parseConnectionSummaries, type ConnectionActionMode, type WorkingSlot } from './types';

export interface ConnectionsState {
  summaries: ConnectionSummary[];
  loading: boolean;
  loadedOnce: boolean;
  mode: ConnectionActionMode | null;
  apiKey: string;
  plaintextAcknowledged: boolean;
  working: WorkingSlot | null;
  lastError: string | null;
  /** null until the first agent health check completes. */
  agentHealthOk: boolean | null;
}

export type ConnectionsEvent =
  | { type: 'refresh/started' }
  | { type: 'refresh/completed'; summaries: unknown }
  | { type: 'refresh/failed'; error: string }
  | { type: 'mode/selected'; mode: ConnectionActionMode }
  | { type: 'mode/cleared' }
  | { type: 'api-key/changed'; value: string }
  | { type: 'api-key/cleared' }
  | { type: 'plaintext/acknowledged' }
  | { type: 'task/started'; slot: WorkingSlot }
  | { type: 'task/finished' }
  | { type: 'health/checked'; ok: boolean };

export function initialConnectionsState(): ConnectionsState {
  return Object.freeze({
    summaries: [],
    loading: false,
    loadedOnce: false,
    mode: null,
    apiKey: '',
    plaintextAcknowledged: false,
    working: null,
    lastError: null,
    agentHealthOk: null,
  });
}

export function connectionsReducer(
  state: ConnectionsState,
  event: ConnectionsEvent,
): ConnectionsState {
  switch (event.type) {
    case 'refresh/started':
      return state.loading ? state : { ...state, loading: true, lastError: null };
    case 'refresh/completed':
      return {
        ...state,
        summaries: parseConnectionSummaries(event.summaries),
        loading: false,
        loadedOnce: true,
      };
    case 'refresh/failed':
      return { ...state, loading: false, loadedOnce: true, lastError: event.error };
    case 'mode/selected':
      return state.mode === event.mode
        ? state
        : { ...state, mode: event.mode, lastError: null };
    case 'mode/cleared':
      return state.mode === null ? state : { ...state, mode: null };
    case 'api-key/changed':
      return { ...state, apiKey: event.value };
    case 'api-key/cleared':
      return state.apiKey === '' ? state : { ...state, apiKey: '' };
    case 'plaintext/acknowledged':
      return state.plaintextAcknowledged ? state : { ...state, plaintextAcknowledged: true };
    case 'task/started':
      // One working slot keeps ChatGPT login, API-key save, and health checks
      // mutually exclusive; a second request while busy is ignored.
      return state.working === null ? { ...state, working: event.slot } : state;
    case 'task/finished':
      return state.working === null ? state : { ...state, working: null };
    case 'health/checked':
      return state.agentHealthOk === event.ok ? state : { ...state, agentHealthOk: event.ok };
  }
}

/** The Connect action exists only after the plaintext warning is acknowledged,
 * a key is present, and no other connection task is running. */
export function canSaveApiKey(state: ConnectionsState): boolean {
  return (
    state.working === null
    && state.plaintextAcknowledged
    && state.apiKey.trim().length > 0
  );
}

/** Ready means at least one authenticated provider and no failing agent health
 * check; a failed check never marks the connection ready. */
export function hasHealthyProvider(state: ConnectionsState): boolean {
  if (state.agentHealthOk === false) return false;
  return state.summaries.some((summary) => summary.authenticated);
}

export function codexConnection(state: ConnectionsState): ConnectionSummary | undefined {
  return state.summaries.find((summary) => summary.provider === 'codex');
}
