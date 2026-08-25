import { describe, expect, it, vi } from 'vitest';
import {
  createRuntimeBootstrapGeneration,
  type RuntimeBootstrapDependencies,
} from '../src/features/bootstrap/useRuntimeBootstrap';
import {
  BROWSER_READY_RUNTIME_STATUS,
  RUNTIME_PROTOCOL_ERROR_STATUS,
} from '../src/features/bootstrap/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function dependencies(
  overrides: Partial<RuntimeBootstrapDependencies> = {},
): RuntimeBootstrapDependencies {
  return {
    subscribe: async () => () => undefined,
    status: async () => BROWSER_READY_RUNTIME_STATUS,
    start: async () => BROWSER_READY_RUNTIME_STATUS,
    retry: async () => BROWSER_READY_RUNTIME_STATUS,
    ...overrides,
  };
}

describe('runtime bootstrap lifecycle generation', () => {
  it('subscribes, reads status, dispatches it, and starts only when not ready', async () => {
    const order: string[] = [];
    const checking = {
      phase: 'checking' as const, progress: null, component: null, version: null,
      errorCode: null, recoverable: false,
    };
    const ready = { ...BROWSER_READY_RUNTIME_STATUS, version: '1.0.0' };
    const generation = createRuntimeBootstrapGeneration(dependencies({
      subscribe: async () => { order.push('subscribe'); return () => order.push('unlisten'); },
      status: async () => { order.push('status'); return checking; },
      start: async () => { order.push('start'); return ready; },
    }), (status) => order.push(`dispatch:${status.phase}`));

    await generation.run();

    expect(order).toEqual([
      'subscribe', 'status', 'dispatch:checking', 'start', 'dispatch:ready',
    ]);
    generation.dispose();
    expect(order.at(-1)).toBe('unlisten');
  });

  it('does not start when the startup probe is already ready', async () => {
    const start = vi.fn();
    const dispatch = vi.fn();
    const generation = createRuntimeBootstrapGeneration(dependencies({ start }), dispatch);

    await generation.run();

    expect(dispatch).toHaveBeenCalledWith(BROWSER_READY_RUNTIME_STATUS);
    expect(start).not.toHaveBeenCalled();
  });

  it('unlistens a delayed subscription and does no later status, start, or dispatch', async () => {
    const subscription = deferred<() => void>();
    const unlisten = vi.fn();
    const status = vi.fn(async () => BROWSER_READY_RUNTIME_STATUS);
    const start = vi.fn(async () => BROWSER_READY_RUNTIME_STATUS);
    const dispatch = vi.fn();
    const generation = createRuntimeBootstrapGeneration(dependencies({
      subscribe: () => subscription.promise,
      status,
      start,
    }), dispatch);

    const running = generation.run();
    generation.dispose();
    subscription.resolve(unlisten);
    await running;

    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('gates late events, completions, rejections, and retry completion after disposal', async () => {
    const startResult = deferred<typeof BROWSER_READY_RUNTIME_STATUS>();
    const retryResult = deferred<typeof BROWSER_READY_RUNTIME_STATUS>();
    let event: ((status: typeof BROWSER_READY_RUNTIME_STATUS) => void) | undefined;
    let protocolError: (() => void) | undefined;
    const dispatch = vi.fn();
    const generation = createRuntimeBootstrapGeneration(dependencies({
      subscribe: async (handler, onProtocolError) => {
        event = handler;
        protocolError = onProtocolError;
        return () => undefined;
      },
      status: async () => ({ ...BROWSER_READY_RUNTIME_STATUS, phase: 'checking', progress: null }),
      start: () => startResult.promise,
      retry: () => retryResult.promise,
    }), dispatch);

    const running = generation.run();
    await Promise.resolve();
    await Promise.resolve();
    const retrying = generation.retry();
    generation.dispose();
    event?.(BROWSER_READY_RUNTIME_STATUS);
    protocolError?.();
    startResult.resolve(BROWSER_READY_RUNTIME_STATUS);
    retryResult.resolve(BROWSER_READY_RUNTIME_STATUS);
    await Promise.all([running, retrying]);

    expect(dispatch.mock.calls).toEqual([
      [{ ...BROWSER_READY_RUNTIME_STATUS, phase: 'checking', progress: null }],
    ]);
  });

  it('does not invoke retry after disposal and maps live dependency rejection canonically', async () => {
    const retry = vi.fn(async () => BROWSER_READY_RUNTIME_STATUS);
    const dispatch = vi.fn();
    const disposed = createRuntimeBootstrapGeneration(dependencies({ retry }), dispatch);
    disposed.dispose();
    await disposed.retry();
    expect(retry).not.toHaveBeenCalled();

    const rejected = createRuntimeBootstrapGeneration(dependencies({
      status: () => Promise.reject(new Error('private host failure')),
    }), dispatch);
    await rejected.run();
    expect(dispatch).toHaveBeenLastCalledWith(RUNTIME_PROTOCOL_ERROR_STATUS);
  });
});
