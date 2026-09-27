import { invoke } from '@tauri-apps/api/core';
import type { ConnectionSummary } from '../../../shared/platform';
import { isAgentHealthy, parseConnectionSummaries } from '../../features/connections/types';
import { isDesktop } from './runtime';

type InvokeFn = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface ConnectionsBridgeDependencies {
  isDesktop: () => boolean;
  invoke: InvokeFn;
}

export function createConnectionsBridge(dependencies: ConnectionsBridgeDependencies) {
  const desktopOnly = <T>(work: () => Promise<T>, fallback: T): Promise<T> =>
    dependencies.isDesktop() ? work() : Promise.resolve(fallback);

  return {
    listConnections: (): Promise<ConnectionSummary[]> =>
      desktopOnly(async () => parseConnectionSummaries(await dependencies.invoke('list_connections')), []),
    saveApiKeyConnection: (provider: string, apiKey: string): Promise<void> =>
      desktopOnly(
        () => dependencies.invoke('save_api_key_connection', { provider, apiKey }) as Promise<void>,
        undefined,
      ),
    deleteConnection: (provider: string): Promise<void> =>
      desktopOnly(() => dependencies.invoke('delete_connection', { provider }) as Promise<void>, undefined),
    codexLoginChatgpt: (): Promise<void> =>
      desktopOnly(() => dependencies.invoke('codex_login_chatgpt') as Promise<void>, undefined),
    codexLoginApiKey: (): Promise<void> =>
      desktopOnly(() => dependencies.invoke('codex_login_api_key') as Promise<void>, undefined),
    /** True only when the kernel answers a strict protocol-health handshake. */
    agentHealth: (): Promise<boolean> =>
      desktopOnly(async () => isAgentHealthy(await dependencies.invoke('agent_health')), false),
  };
}

const connectionsBridge = createConnectionsBridge({
  isDesktop,
  invoke: (command, args) => invoke<unknown>(command, args),
});

export const listConnections = connectionsBridge.listConnections;
export const saveApiKeyConnection = connectionsBridge.saveApiKeyConnection;
export const deleteConnection = connectionsBridge.deleteConnection;
export const codexLoginChatgpt = connectionsBridge.codexLoginChatgpt;
export const codexLoginApiKey = connectionsBridge.codexLoginApiKey;
export const agentHealth = connectionsBridge.agentHealth;
