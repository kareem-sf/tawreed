type RuntimeUnlisten = () => void;

interface MaximizeMonitorDependencies {
  read: () => Promise<boolean>;
  subscribe: (handler: () => void) => Promise<RuntimeUnlisten>;
}

export function createMaximizeMonitor(
  dependencies: MaximizeMonitorDependencies,
  onChange: (maximized: boolean) => void,
) {
  let live = true;
  let started = false;
  let unlisten: RuntimeUnlisten | undefined;

  const sync = async () => {
    try {
      const maximized = await dependencies.read();
      if (live) onChange(maximized);
    } catch {
      // Window state is optional in browser development and during shutdown.
    }
  };

  const start = () => {
    if (!live || started) return;
    started = true;
    void sync();
    void dependencies.subscribe(() => {
      if (live) void sync();
    }).then((stop) => {
      if (!live) {
        stop();
        return;
      }
      unlisten = stop;
    }).catch(() => undefined);
  };

  const dispose = () => {
    if (!live) return;
    live = false;
    unlisten?.();
    unlisten = undefined;
  };

  return { start, dispose };
}
