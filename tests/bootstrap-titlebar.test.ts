import { describe, expect, it, vi } from 'vitest';
import { createMaximizeMonitor } from '../src/features/bootstrap/titleBarLifecycle';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('bootstrap titlebar lifecycle', () => {
  it('removes a late resize subscription and ignores late state after disposal', async () => {
    const maximized = deferred<boolean>();
    const subscribed = deferred<() => void>();
    const unlisten = vi.fn();
    const onChange = vi.fn();
    let resize: (() => void) | undefined;
    const read = vi.fn(() => maximized.promise);
    const monitor = createMaximizeMonitor({
      read,
      subscribe: (handler) => {
        resize = handler;
        return subscribed.promise;
      },
    }, onChange);

    monitor.start();
    monitor.dispose();
    maximized.resolve(true);
    subscribed.resolve(unlisten);
    await Promise.resolve();
    await Promise.resolve();
    resize?.();

    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('syncs active resize changes and removes the registered listener once', async () => {
    let maximized = false;
    let resize: (() => void) | undefined;
    const unlisten = vi.fn();
    const onChange = vi.fn();
    const monitor = createMaximizeMonitor({
      read: async () => maximized,
      subscribe: async (handler) => {
        resize = handler;
        return unlisten;
      },
    }, onChange);

    monitor.start();
    await Promise.resolve();
    await Promise.resolve();
    maximized = true;
    resize?.();
    await Promise.resolve();
    monitor.dispose();
    monitor.dispose();

    expect(onChange).toHaveBeenNthCalledWith(1, false);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
