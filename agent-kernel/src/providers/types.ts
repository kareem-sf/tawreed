import type { ProviderId } from '../../../shared/platform';

export type { ProviderId };

export interface ProviderHealth {
  authenticated: boolean;
  detail: string;
}

export interface ProviderSessionInput {
  projectId: string;
  workingDirectory: string;
}

export interface ResumeSessionInput extends ProviderSessionInput {
  sessionId: string;
}

export interface RunTurnInput {
  runId: string;
  sessionId: string;
  prompt: string;
  outputSchema?: Record<string, unknown>;
}

export interface ProviderEvent {
  type: string;
  payload: unknown;
}

export interface ProviderBridge {
  readonly id: ProviderId;
  health(): Promise<ProviderHealth>;
  startSession(input: ProviderSessionInput): Promise<{ sessionId: string }>;
  resumeSession(input: ResumeSessionInput): Promise<void>;
  runTurn(
    input: RunTurnInput,
    emit: (event: ProviderEvent) => void,
  ): Promise<{ finalResponse: string }>;
  cancel(runId: string): Promise<boolean>;
}
