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

export function createRuntimeBootstrapGeneration(
  dependencies: RuntimeBootstrapDependencies,
  dispatch: (status: RuntimeBootstrapStatus) => void,
): RuntimeBootstrapGeneration {
  let live = true;
  let started = false;
  let unlisten: RuntimeUnlisten | undefined;

  const publish = (status: RuntimeBootstrapStatus) => {
    if (live) dispatch(status);
  };
  const publishProtocolError = () => publish(RUNTIME_PROTOCOL_ERROR_STATUS);

  const run = async () => {
    if (!live || started) return;
    started = true;
    try {
      const stop = await dependencies.subscribe(publish, publishProtocolError);
      if (!live) {
        stop();
        return;
      }
      unlisten = stop;

      const current = await dependencies.status();
      if (!live) return;
      publish(current);
      if (current.phase === 'ready') return;

      const completed = await dependencies.start();
      publish(completed);
    } catch {
      publishProtocolError();
    }
  };

  const retry = async () => {
    if (!live) return;
    try {
      const completed = await dependencies.retry();
      publish(completed);
    } catch {
      publishProtocolError();
    }
  };

  const dispose = () => {
    if (!live) return;
    live = false;
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
