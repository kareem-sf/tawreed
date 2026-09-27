import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  agentHealth,
  codexLoginApiKey,
  codexLoginChatgpt,
  deleteConnection,
  listConnections,
  saveApiKeyConnection,
} from '../../platform/desktop/connections';
import {
  canSaveApiKey,
  connectionsReducer,
  hasHealthyProvider,
  initialConnectionsState,
  type ConnectionsState,
} from './reducer';
import type { ConnectionActionMode, WorkingSlot } from './types';

export interface UseConnectionsOptions {
  onReadyChange?: (ready: boolean) => void;
}

export interface UseConnectionsResult {
  state: ConnectionsState;
  selectMode: (mode: ConnectionActionMode | null) => void;
  setApiKey: (value: string) => void;
  acknowledgePlaintext: () => void;
  loginWithChatgpt: () => Promise<void>;
  saveCodexKey: () => Promise<void>;
  checkHealth: () => Promise<void>;
  removeCodexConnection: () => Promise<void>;
  canSave: boolean;
  healthy: boolean;
}

export function useConnections(options: UseConnectionsOptions = {}): UseConnectionsResult {
  const [state, dispatch] = useReducer(connectionsReducer, undefined, initialConnectionsState);
  const working = useRef(false);
  const readyCallback = options.onReadyChange;

  const refresh = useCallback(async () => {
    dispatch({ type: 'refresh/started' });
    try {
      const summaries = await listConnections();
      dispatch({ type: 'refresh/completed', summaries });
    } catch {
      dispatch({ type: 'refresh/failed', error: 'connection_list_failed' });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    readyCallback?.(hasHealthyProvider(state));
  }, [state, readyCallback]);

  // Single-flight guard shared by every action; the reducer keeps the slot
  // exclusive even if a stale closure slips past this ref.
  const begin = useCallback((slot: WorkingSlot) => {
    if (working.current) return false;
    working.current = true;
    dispatch({ type: 'task/started', slot });
    return true;
  }, []);
  const end = useCallback(() => {
    working.current = false;
    dispatch({ type: 'task/finished' });
  }, []);

  const selectMode = useCallback((mode: ConnectionActionMode | null) => {
    if (mode === null) dispatch({ type: 'mode/cleared' });
    else dispatch({ type: 'mode/selected', mode });
  }, []);

  const setApiKey = useCallback((value: string) => {
    dispatch({ type: 'api-key/changed', value });
  }, []);

  const acknowledgePlaintext = useCallback(() => {
    dispatch({ type: 'plaintext/acknowledged' });
  }, []);

  const loginWithChatgpt = useCallback(async () => {
    if (!begin('chatgpt-login')) return;
    try {
      await codexLoginChatgpt();
      await refresh();
    } catch {
      dispatch({ type: 'refresh/failed', error: 'codex_chatgpt_login_failed' });
    } finally {
      end();
    }
  }, [begin, end, refresh]);

  const saveCodexKey = useCallback(async () => {
    if (!begin('api-key-save')) return;
    try {
      await saveApiKeyConnection('codex', state.apiKey.trim());
      await codexLoginApiKey();
      dispatch({ type: 'api-key/cleared' });
      await refresh();
    } catch {
      dispatch({ type: 'refresh/failed', error: 'codex_api_key_login_failed' });
    } finally {
      end();
    }
  }, [begin, end, refresh, state.apiKey]);

  const checkHealth = useCallback(async () => {
    if (!begin('health-check')) return;
    try {
      dispatch({ type: 'health/checked', ok: await agentHealth() });
    } catch {
      dispatch({ type: 'health/checked', ok: false });
    } finally {
      end();
    }
  }, [begin, end]);

  const removeCodexConnection = useCallback(async () => {
    if (!begin('connection-remove')) return;
    try {
      await deleteConnection('codex');
      await refresh();
    } catch {
      dispatch({ type: 'refresh/failed', error: 'connection_remove_failed' });
    } finally {
      end();
    }
  }, [begin, end, refresh]);

  return {
    state,
    selectMode,
    setApiKey,
    acknowledgePlaintext,
    loginWithChatgpt,
    saveCodexKey,
    checkHealth,
    removeCodexConnection,
    canSave: canSaveApiKey(state),
    healthy: hasHealthyProvider(state),
  };
}
