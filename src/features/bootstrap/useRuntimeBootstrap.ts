import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { RuntimeBootstrapStatus } from '../../../shared/platform';
import {
  runtimeRetry,
  runtimeStart,
  runtimeStatus,
  subscribeRuntimeProgress,
} from '../../bridge';
import { bootstrapReducer, initialBootstrapState } from './reducer';
import { RUNTIME_PROTOCOL_ERROR_STATUS } from './types';

type RuntimeUnlisten = () => void;

export interface RuntimeBootstrapDependencies {
  subscribe: (
    handler: (status: RuntimeBootstrapStatus) => void,
    onProtocolError: () => void,
  ) => Promise<RuntimeUnlisten>;
  status: () => Promise<RuntimeBootstrapStatus>;
  start: () => Promise<RuntimeBootstrapStatus>;
  retry: () => Promise<RuntimeBootstrapStatus>;
}

export interface RuntimeBootstrapGeneration {
  run: () => Promise<void>;
  retry: () => Promise<void>;
  dispose: () => void;
}

type RuntimeControllerMode =
  | { kind: 'subscribing' }
  | { kind: 'probing' }
  | { kind: 'external-observing' }
  | { kind: 'command-active'; command: 'start' | 'retry'; id: number }
  | { kind: 'settled' };

function isTerminalStatus(status: RuntimeBootstrapStatus): boolean {
  return status.phase === 'ready' || status.phase === 'error';
}

export function createRuntimeBootstrapGeneration(
  dependencies: RuntimeBootstrapDependencies,
  dispatch: (status: RuntimeBootstrapStatus) => void,
): RuntimeBootstrapGeneration {
  let live = true;
  let started = false;
  let nextCommandId = 0;
  let mode: RuntimeControllerMode = { kind: 'subscribing' };
  let unlisten: RuntimeUnlisten | undefined;
  let activeRetry: { id: number; promise: Promise<void> } | undefined;

  const settleCommand = (id: number, status: RuntimeBootstrapStatus) => {
    if (!live || mode.kind !== 'command-active' || mode.id !== id) return;
    dispatch(status);
    mode = { kind: 'settled' };
  };
  const settleCommandError = (id: number) => {
    settleCommand(id, RUNTIME_PROTOCOL_ERROR_STATUS);
  };
  const publishEvent = (status: RuntimeBootstrapStatus) => {
    if (!live) return;
    if (mode.kind === 'command-active') {
      if (!isTerminalStatus(status)) dispatch(status);
      return;
    }
    if (mode.kind === 'settled') return;
    dispatch(status);
    mode = isTerminalStatus(status)
      ? { kind: 'settled' }
      : { kind: 'external-observing' };
  };
  const publishEventError = () => publishEvent(RUNTIME_PROTOCOL_ERROR_STATUS);

  const run = async () => {
    if (!live || started) return;
    started = true;
    let stop: RuntimeUnlisten;
    try {
      stop = await dependencies.subscribe(publishEvent, publishEventError);
    } catch {
      if (live && mode.kind === 'subscribing') {
        dispatch(RUNTIME_PROTOCOL_ERROR_STATUS);
        mode = { kind: 'settled' };
      }
      return;
    }
    if (!live) {
      stop();
      return;
    }
    unlisten = stop;
    if (mode.kind !== 'subscribing') return;
    mode = { kind: 'probing' };

    let current: RuntimeBootstrapStatus;
    try {
      current = await dependencies.status();
    } catch {
      if (live && mode.kind === 'probing') {
        dispatch(RUNTIME_PROTOCOL_ERROR_STATUS);
        mode = { kind: 'settled' };
      }
      return;
    }
    if (!live || mode.kind !== 'probing') return;
    dispatch(current);
    if (current.phase === 'ready') {
      mode = { kind: 'settled' };
      return;
    }

    nextCommandId += 1;
    const id = nextCommandId;
    mode = { kind: 'command-active', command: 'start', id };
    try {
      const completed = await dependencies.start();
      settleCommand(id, completed);
    } catch {
      settleCommandError(id);
    }
  };

  const retry = (): Promise<void> => {
    if (!live) return Promise.resolve();
    if (
      mode.kind === 'command-active'
      && mode.command === 'retry'
      && activeRetry?.id === mode.id
    ) return activeRetry.promise;

    nextCommandId += 1;
    const id = nextCommandId;
    mode = { kind: 'command-active', command: 'retry', id };
    const operation = Promise.resolve()
      .then(() => dependencies.retry())
      .then((completed) => settleCommand(id, completed))
      .catch(() => settleCommandError(id))
      .finally(() => {
        if (activeRetry?.id === id) activeRetry = undefined;
      });
    activeRetry = { id, promise: operation };
    return operation;
  };

  const dispose = () => {
    if (!live) return;
    live = false;
    activeRetry = undefined;
    unlisten?.();
    unlisten = undefined;
  };

  return { run, retry, dispose };
}

const runtimeDependencies: RuntimeBootstrapDependencies = {
  subscribe: subscribeRuntimeProgress,
  status: runtimeStatus,
  start: runtimeStart,
  retry: runtimeRetry,
};

export function useRuntimeBootstrap() {
  const [state, dispatch] = useReducer(bootstrapReducer, initialBootstrapState);
  const generation = useRef<RuntimeBootstrapGeneration | null>(null);

  useEffect(() => {
    const active = createRuntimeBootstrapGeneration(
      runtimeDependencies,
      (status) => dispatch({ type: 'status', status }),
    );
    generation.current = active;
    void active.run();
    return () => {
      active.dispose();
      if (generation.current === active) generation.current = null;
    };
  }, []);

  const retry = useCallback(() => {
    void generation.current?.retry();
  }, []);

  return { status: state.status, retry };
}
