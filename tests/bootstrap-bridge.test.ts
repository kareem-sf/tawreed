import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRuntimeBridge,
  isDesktop,
  runtimeRetry,
  runtimeStart,
  runtimeStatus,
  subscribeRuntimeProgress,
} from '../src/bridge';
import {
  BROWSER_READY_RUNTIME_STATUS,
  RUNTIME_PROTOCOL_ERROR_STATUS,
} from '../src/features/bootstrap/types';

describe('runtime bridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is browser-ready in Node and plain browser development without host calls', async () => {
    expect(isDesktop()).toBe(false);
    vi.stubGlobal('window', {});

    await expect(runtimeStatus()).resolves.toEqual(BROWSER_READY_RUNTIME_STATUS);
    await expect(runtimeStart()).resolves.toEqual(BROWSER_READY_RUNTIME_STATUS);
    await expect(runtimeRetry()).resolves.toEqual(BROWSER_READY_RUNTIME_STATUS);

    const handler = vi.fn();
    const protocolError = vi.fn();
    const unlisten = await subscribeRuntimeProgress(handler, protocolError);
    expect(() => unlisten()).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
    expect(protocolError).not.toHaveBeenCalled();
  });

  it('validates every desktop command response through the same boundary', async () => {
    const values = new Map<string, unknown>([
      ['runtime_status', { phase: 'ready', progress: 100, component: null, version: '1.0.0', errorCode: null, recoverable: false }],
      ['runtime_start', { phase: 'downloading', progress: 120, component: null, version: null, errorCode: null, recoverable: false }],
      ['runtime_retry', { phase: 'error', progress: null, component: null, version: null, errorCode: 'runtime_download_failed', recoverable: true }],
    ]);
    const invoke = vi.fn((command: string) => Promise.resolve(values.get(command)));
    const bridge = createRuntimeBridge({
      isDesktop: () => true,
      invoke,
      listen: vi.fn(),
    });

    await expect(bridge.runtimeStatus()).resolves.toMatchObject({ phase: 'ready' });
    await expect(bridge.runtimeStart()).resolves.toEqual(RUNTIME_PROTOCOL_ERROR_STATUS);
    await expect(bridge.runtimeRetry()).resolves.toMatchObject({
      phase: 'error',
      errorCode: 'runtime_download_failed',
    });
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      'runtime_status', 'runtime_start', 'runtime_retry',
    ]);
  });

  it('maps rejected commands and invalid event payloads without exposing host text', async () => {
    const leaked = `C:\\Users\\private\\${'runtime'.repeat(20)}.zip`;
    let deliver: ((payload: unknown) => void) | undefined;
    const bridge = createRuntimeBridge({
      isDesktop: () => true,
      invoke: () => Promise.reject(new Error(leaked)),
      listen: async (handler) => {
        deliver = handler;
        return () => undefined;
      },
    });

    await expect(bridge.runtimeStatus()).resolves.toEqual(RUNTIME_PROTOCOL_ERROR_STATUS);
    await expect(bridge.runtimeStart()).resolves.toEqual(RUNTIME_PROTOCOL_ERROR_STATUS);
    await expect(bridge.runtimeRetry()).resolves.toEqual(RUNTIME_PROTOCOL_ERROR_STATUS);

    const status = vi.fn();
    const protocolError = vi.fn();
    await bridge.subscribeRuntimeProgress(status, protocolError);
    deliver?.({ phase: 'error', progress: null, component: leaked, version: null, errorCode: null, recoverable: true });
    expect(status).not.toHaveBeenCalled();
    expect(protocolError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(protocolError.mock.calls)).not.toContain(leaked);
  });

  it('delivers valid desktop events through the command validator boundary', async () => {
    let deliver: ((payload: unknown) => void) | undefined;
    const bridge = createRuntimeBridge({
      isDesktop: () => true,
      invoke: () => Promise.resolve(null),
      listen: async (handler) => {
        deliver = handler;
        return () => undefined;
      },
    });
    const handler = vi.fn();
    await bridge.subscribeRuntimeProgress(handler, vi.fn());

    const event = {
      phase: 'verifying', progress: null, component: 'agent-kernel', version: '1.0.0',
      errorCode: null, recoverable: false,
    };
    deliver?.(event);
    expect(handler).toHaveBeenCalledWith(event);
  });
});
