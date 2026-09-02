import type { GeneratedArtifact } from '../../../engine/generate';
import type {
  AgentEvent,
  AiProvider,
  Classification,
  InspectionResult,
  ValidationIssue,
  WorkPackage,
} from '../../../shared/types';
import type { RevisionOutput, RevisionReservation } from '../../bridge';

export type WorkflowView = 'idle' | 'busy' | 'consent' | 'review' | 'done';

export interface PendingInspection {
  inspection: InspectionResult;
  fileName: string;
  bytes: Uint8Array;
  startedAt: number;
  trace: AgentEvent[];
}

export interface PendingPublication {
  reservation: RevisionReservation;
  artifacts: GeneratedArtifact[];
}

export interface PipelineData {
  inspection: InspectionResult;
  classifications: Classification[];
  packages: WorkPackage[];
  packageCatalog: WorkPackage[];
  issues: ValidationIssue[];
  llmUsed: boolean;
  llmFailed: boolean;
  /** Items the AI never classified — a failed batch still lets the run finish. */
  aiSkipped: number;
  provider: AiProvider;
  model: string;
  trace: AgentEvent[];
  memoryApplied: number;
  fileName: string;
  bytes: Uint8Array;
  startedAt: number;
}

export interface WorkflowState {
  view: WorkflowView;
  busyMessage: string;
  busyProgress: number | null;
  cancellable: boolean;
  generating: boolean;
  pendingInspection: PendingInspection | null;
  pendingPublication: PendingPublication | null;
  data: PipelineData | null;
  output: RevisionOutput | null;
  error: string | null;
}

export const initialWorkflowState: WorkflowState = {
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
