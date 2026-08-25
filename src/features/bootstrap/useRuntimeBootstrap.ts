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
  let attemptEpoch = 0;
  let eventSequence = 0;
  let terminalEventEpoch: number | undefined;
  let unlisten: RuntimeUnlisten | undefined;
  let activeRetry: { epoch: number; promise: Promise<void> } | undefined;

  const publishCommand = (epoch: number, status: RuntimeBootstrapStatus) => {
    if (live && epoch === attemptEpoch && terminalEventEpoch !== epoch) dispatch(status);
  };
  const publishCommandError = (epoch: number) => {
    publishCommand(epoch, RUNTIME_PROTOCOL_ERROR_STATUS);
  };
  const publishEvent = (status: RuntimeBootstrapStatus) => {
    if (!live) return;
    eventSequence += 1;
    if (status.phase === 'ready' || status.phase === 'error') {
      terminalEventEpoch = attemptEpoch;
      activeRetry = undefined;
    }
    dispatch(status);
  };
  const publishEventError = () => publishEvent(RUNTIME_PROTOCOL_ERROR_STATUS);

  const run = async () => {
    if (!live || started) return;
    started = true;
    const epoch = attemptEpoch;
    const subscriptionSequence = eventSequence;
    let stop: RuntimeUnlisten;
    try {
      stop = await dependencies.subscribe(publishEvent, publishEventError);
    } catch {
      if (live && epoch === attemptEpoch && subscriptionSequence === eventSequence) {
        dispatch(RUNTIME_PROTOCOL_ERROR_STATUS);
      }
      return;
    }
    if (!live) {
      stop();
      return;
    }
    unlisten = stop;
    if (epoch !== attemptEpoch || subscriptionSequence !== eventSequence) return;

    const probeSequence = eventSequence;
    try {
      const current = await dependencies.status();
      if (!live || epoch !== attemptEpoch || probeSequence !== eventSequence) return;
      dispatch(current);
      if (current.phase === 'ready') return;
    } catch {
      if (live && epoch === attemptEpoch && probeSequence === eventSequence) {
        dispatch(RUNTIME_PROTOCOL_ERROR_STATUS);
      }
      return;
    }

    try {
      const completed = await dependencies.start();
      publishCommand(epoch, completed);
    } catch {
      publishCommandError(epoch);
    }
  };

  const retry = (): Promise<void> => {
    if (!live) return Promise.resolve();
    if (activeRetry) return activeRetry.promise;

    attemptEpoch += 1;
    terminalEventEpoch = undefined;
    const epoch = attemptEpoch;
    const operation = Promise.resolve()
      .then(() => dependencies.retry())
      .then((completed) => publishCommand(epoch, completed))
      .catch(() => publishCommandError(epoch))
      .finally(() => {
        if (activeRetry?.epoch === epoch) activeRetry = undefined;
      });
    activeRetry = { epoch, promise: operation };
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
