import type {
  PendingInspection,
  PendingPublication,
  PipelineData,
  WorkflowState,
} from './types';
import type { RevisionOutput } from '../../bridge';

export type WorkflowAction =
  | { type: 'reset' }
  | { type: 'startBusy'; message?: string; progress?: number | null }
  | { type: 'setBusy'; message?: string; progress?: number | null }
  | { type: 'setCancellable'; value: boolean }
  | { type: 'setGenerating'; value: boolean }
  | { type: 'setError'; error: string | null }
  | { type: 'requestConsent'; pending: PendingInspection }
  | { type: 'showReview'; data: PipelineData }
  | { type: 'updateData'; data: PipelineData }
  | { type: 'setPendingPublication'; pending: PendingPublication | null }
  | { type: 'showDone'; output: RevisionOutput; data: PipelineData };

export function workflowReducer(
  state: WorkflowState,
  action: WorkflowAction,
): WorkflowState {
  switch (action.type) {
    case 'reset':
      return {
        view: 'idle',
        busyMessage: '',
        busyProgress: null,
        cancellable: false,
        generating: false,
        pendingInspection: null,
        pendingPublication: null,
        data: null,
        output: null,
        error: null,
      };
    case 'startBusy':
      return {
        ...state,
        view: 'busy',
        busyMessage: action.message ?? '',
        busyProgress: action.progress ?? null,
        error: null,
      };
    case 'setBusy':
      return {
        ...state,
        busyMessage: action.message ?? state.busyMessage,
        busyProgress: action.progress === undefined ? state.busyProgress : action.progress,
      };
    case 'setCancellable':
      return { ...state, cancellable: action.value };
    case 'setGenerating':
      return { ...state, generating: action.value };
    case 'setError':
      return { ...state, error: action.error };
    case 'requestConsent':
      return {
        ...state,
        view: 'consent',
        pendingInspection: action.pending,
        busyProgress: null,
        cancellable: false,
      };
    case 'showReview':
      return {
        ...state,
        view: 'review',
        data: action.data,
        pendingInspection: null,
        busyProgress: null,
        cancellable: false,
      };
    case 'updateData':
      return { ...state, data: action.data };
    case 'setPendingPublication':
      return { ...state, pendingPublication: action.pending };
    case 'showDone':
      return {
        ...state,
        view: 'done',
        data: action.data,
        output: action.output,
        pendingPublication: null,
        busyProgress: null,
        cancellable: false,
        error: null,
      };
    default:
      return state;
  }
}
