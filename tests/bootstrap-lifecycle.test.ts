import { describe, expect, it, vi } from 'vitest';
import type { RuntimeBootstrapStatus } from '../shared/platform';
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
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const checking: RuntimeBootstrapStatus = {
  phase: 'checking', progress: null, component: null, version: null,
  errorCode: null, recoverable: false,
};

const recoverableError: RuntimeBootstrapStatus = {
  phase: 'error', progress: null, component: null, version: null,
  errorCode: 'runtime_download_failed', recoverable: true,
};

const downloading: RuntimeBootstrapStatus = {
  phase: 'downloading', progress: 35, component: 'agent-kernel', version: '1.0.0',
  errorCode: null, recoverable: false,
};

const verifying: RuntimeBootstrapStatus = {
  phase: 'verifying', progress: null, component: 'agent-kernel', version: '1.0.0',
  errorCode: null, recoverable: false,
};

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

  it('keeps an event authoritative when it arrives before the startup probe resolves', async () => {
    const probe = deferred<RuntimeBootstrapStatus>();
    const start = vi.fn(async () => BROWSER_READY_RUNTIME_STATUS);
    let event: ((status: RuntimeBootstrapStatus) => void) | undefined;
    const dispatch = vi.fn();
    const generation = createRuntimeBootstrapGeneration(dependencies({
      subscribe: async (handler) => {
        event = handler;
        return () => undefined;
      },
      status: () => probe.promise,
      start,
    }), dispatch);

    const running = generation.run();
    await Promise.resolve();
    await Promise.resolve();
    event?.(recoverableError);
    probe.resolve(checking);
    await running;

    expect(dispatch.mock.calls).toEqual([[recoverableError]]);
    expect(start).not.toHaveBeenCalled();
  });

  it('ignores an older start rejection when a newer retry resolves first', async () => {
    const oldStart = deferred<RuntimeBootstrapStatus>();
    const retry = vi.fn(async () => BROWSER_READY_RUNTIME_STATUS);
    const dispatch = vi.fn();
    const generation = createRuntimeBootstrapGeneration(dependencies({
      status: async () => checking,
      start: () => oldStart.promise,
      retry,
    }), dispatch);

    const running = generation.run();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await generation.retry();
    oldStart.reject(new Error('older private host failure'));
    await running;

    expect(retry).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls).toEqual([[checking], [BROWSER_READY_RUNTIME_STATUS]]);
  });

  it('invalidates a pending retry completion and rejection when an event arrives', async () => {
    const retryResult = deferred<RuntimeBootstrapStatus>();
    let event: ((status: RuntimeBootstrapStatus) => void) | undefined;
    const dispatch = vi.fn();
    const generation = createRuntimeBootstrapGeneration(dependencies({
      subscribe: async (handler) => {
        event = handler;
        return () => undefined;
      },
      retry: () => retryResult.promise,
    }), dispatch);
    await generation.run();
    dispatch.mockClear();

    const retrying = generation.retry();
    event?.(recoverableError);
    retryResult.reject(new Error('stale retry failure'));
    await retrying;

    expect(dispatch.mock.calls).toEqual([[recoverableError]]);
  });

  it('coalesces rapid retry calls into one host operation and one completion', async () => {
    const retryResult = deferred<RuntimeBootstrapStatus>();
    const retry = vi.fn(() => retryResult.promise);
    const dispatch = vi.fn();
    const generation = createRuntimeBootstrapGeneration(dependencies({ retry }), dispatch);
    await generation.run();
    dispatch.mockClear();

    const first = generation.retry();
    const second = generation.retry();
    await Promise.resolve();
    expect(retry).toHaveBeenCalledTimes(1);
    retryResult.resolve(recoverableError);
    await Promise.all([first, second]);

    expect(dispatch.mock.calls).toEqual([[recoverableError]]);
  });

  it('publishes the current start return when only nonterminal events were emitted', async () => {
    const startResult = deferred<RuntimeBootstrapStatus>();
    let event: ((status: RuntimeBootstrapStatus) => void) | undefined;
    const dispatch = vi.fn();
    const generation = createRuntimeBootstrapGeneration(dependencies({
      subscribe: async (handler) => {
        event = handler;
        return () => undefined;
      },
      status: async () => checking,
      start: () => startResult.promise,
    }), dispatch);

    const running = generation.run();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    event?.(downloading);
    event?.(verifying);
    startResult.resolve(BROWSER_READY_RUNTIME_STATUS);
    await running;

    expect(dispatch.mock.calls).toEqual([
      [checking], [downloading], [verifying], [BROWSER_READY_RUNTIME_STATUS],
    ]);
  });

  it('publishes the current retry return when only nonterminal events were emitted', async () => {
    const retryResult = deferred<RuntimeBootstrapStatus>();
    let event: ((status: RuntimeBootstrapStatus) => void) | undefined;
    const dispatch = vi.fn();
    const generation = createRuntimeBootstrapGeneration(dependencies({
      subscribe: async (handler) => {
        event = handler;
        return () => undefined;
      },
      retry: () => retryResult.promise,
    }), dispatch);
    await generation.run();
    dispatch.mockClear();

    const retrying = generation.retry();
    await Promise.resolve();
    event?.(checking);
    event?.(downloading);
    retryResult.resolve(recoverableError);
    await retrying;

    expect(dispatch.mock.calls).toEqual([
      [checking], [downloading], [recoverableError],
    ]);
  });

  it('allows a new retry after terminal error and suppresses the older retry return', async () => {
    const firstResult = deferred<RuntimeBootstrapStatus>();
    const secondResult = deferred<RuntimeBootstrapStatus>();
    const retry = vi.fn()
      .mockImplementationOnce(() => firstResult.promise)
      .mockImplementationOnce(() => secondResult.promise);
    let event: ((status: RuntimeBootstrapStatus) => void) | undefined;
    const dispatch = vi.fn();
    const generation = createRuntimeBootstrapGeneration(dependencies({
      subscribe: async (handler) => {
        event = handler;
        return () => undefined;
      },
      retry,
    }), dispatch);
    await generation.run();
    dispatch.mockClear();

    const first = generation.retry();
    await Promise.resolve();
    event?.(recoverableError);
    const second = generation.retry();
    await Promise.resolve();
    expect(retry).toHaveBeenCalledTimes(2);
    secondResult.resolve(BROWSER_READY_RUNTIME_STATUS);
    firstResult.resolve(recoverableError);
    await Promise.all([first, second]);

    expect(dispatch.mock.calls).toEqual([
      [recoverableError], [BROWSER_READY_RUNTIME_STATUS],
    ]);
  });
});
