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
  let revision = 0;
  let unlisten: RuntimeUnlisten | undefined;
  let activeRetry: { revision: number; promise: Promise<void> } | undefined;

  const publishAttempt = (attempt: number, status: RuntimeBootstrapStatus) => {
    if (live && attempt === revision) dispatch(status);
  };
  const publishAttemptError = (attempt: number) => {
    publishAttempt(attempt, RUNTIME_PROTOCOL_ERROR_STATUS);
  };
  const publishEvent = (status: RuntimeBootstrapStatus) => {
    if (!live) return;
    revision += 1;
    activeRetry = undefined;
    dispatch(status);
  };
  const publishEventError = () => publishEvent(RUNTIME_PROTOCOL_ERROR_STATUS);

  const run = async () => {
    if (!live || started) return;
    started = true;
    const attempt = revision;
    try {
      const stop = await dependencies.subscribe(publishEvent, publishEventError);
      if (!live) {
        stop();
        return;
      }
      unlisten = stop;
      if (attempt !== revision) return;

      const current = await dependencies.status();
      if (!live || attempt !== revision) return;
      publishAttempt(attempt, current);
      if (current.phase === 'ready') return;

      const completed = await dependencies.start();
      publishAttempt(attempt, completed);
    } catch {
      publishAttemptError(attempt);
    }
  };

  const retry = (): Promise<void> => {
    if (!live) return Promise.resolve();
    if (activeRetry) return activeRetry.promise;

    revision += 1;
    const attempt = revision;
    const operation = Promise.resolve()
      .then(() => dependencies.retry())
      .then((completed) => publishAttempt(attempt, completed))
      .catch(() => publishAttemptError(attempt))
      .finally(() => {
        if (activeRetry?.revision === attempt) activeRetry = undefined;
      });
    activeRetry = { revision: attempt, promise: operation };
    return operation;
  };

  const dispose = () => {
    if (!live) return;
    live = false;
    revision += 1;
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
