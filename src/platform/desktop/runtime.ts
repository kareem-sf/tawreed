import { invoke } from '@tauri-apps/api/core';
import type { RuntimeBootstrapStatus } from '../../../shared/platform';
import {
  BROWSER_READY_RUNTIME_STATUS,
  RUNTIME_PROTOCOL_ERROR_STATUS,
  parseRuntimeStatus,
} from '../../features/bootstrap/types';

export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type RuntimeProgressHandler = (status: RuntimeBootstrapStatus) => void;
export type RuntimeProtocolErrorHandler = () => void;
type RuntimeUnlisten = () => void;

export interface RuntimeBridgeDependencies {
  isDesktop: () => boolean;
  invoke: (command: 'runtime_status' | 'runtime_start' | 'runtime_retry') => Promise<unknown>;
  listen: (handler: (payload: unknown) => void) => Promise<RuntimeUnlisten>;
}

export function createRuntimeBridge(dependencies: RuntimeBridgeDependencies) {
  const runCommand = async (
    command: 'runtime_status' | 'runtime_start' | 'runtime_retry',
  ): Promise<RuntimeBootstrapStatus> => {
    if (!dependencies.isDesktop()) return BROWSER_READY_RUNTIME_STATUS;
    try {
      return parseRuntimeStatus(await dependencies.invoke(command));
    } catch {
      return RUNTIME_PROTOCOL_ERROR_STATUS;
    }
  };

  return {
    runtimeStatus: () => runCommand('runtime_status'),
    runtimeStart: () => runCommand('runtime_start'),
    runtimeRetry: () => runCommand('runtime_retry'),
    subscribeRuntimeProgress: async (
      handler: RuntimeProgressHandler,
      onProtocolError: RuntimeProtocolErrorHandler,
    ): Promise<RuntimeUnlisten> => {
      if (!dependencies.isDesktop()) return () => undefined;
      try {
        return await dependencies.listen((payload) => {
          const status = parseRuntimeStatus(payload);
          if (status === RUNTIME_PROTOCOL_ERROR_STATUS) onProtocolError();
          else handler(status);
        });
      } catch {
        onProtocolError();
        return () => undefined;
      }
    },
  };
}

const runtimeBridge = createRuntimeBridge({
  isDesktop,
  invoke: (command) => invoke<unknown>(command),
  listen: async (handler) => {
    const { listen } = await import('@tauri-apps/api/event');
    return listen<unknown>('runtime://progress', (event) => handler(event.payload));
  },
});

export const runtimeStatus = runtimeBridge.runtimeStatus;
export const runtimeStart = runtimeBridge.runtimeStart;
export const runtimeRetry = runtimeBridge.runtimeRetry;
export const subscribeRuntimeProgress = runtimeBridge.subscribeRuntimeProgress;
