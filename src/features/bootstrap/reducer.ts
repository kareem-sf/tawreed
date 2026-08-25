import type { RuntimeBootstrapStatus } from '../../../shared/platform';
import {
  INITIAL_RUNTIME_STATUS,
  RUNTIME_PROTOCOL_ERROR_STATUS,
  parseRuntimeStatus,
} from './types';

export interface BootstrapState {
  status: RuntimeBootstrapStatus;
}

export type BootstrapAction =
  | { type: 'status'; status: unknown }
  | { type: 'protocolError' };

export const initialBootstrapState: BootstrapState = {
  status: INITIAL_RUNTIME_STATUS,
};

export function bootstrapReducer(
  state: BootstrapState,
  action: BootstrapAction,
): BootstrapState {
  const status = action.type === 'status'
    ? parseRuntimeStatus(action.status)
    : RUNTIME_PROTOCOL_ERROR_STATUS;
  return status === state.status ? state : { status };
}
