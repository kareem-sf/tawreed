import type { BootstrapInfo, UpdateInfo } from '../bridge';
import type { ProcessingMode } from '../features/workflow/useBoqWorkflow';

export type AppDialog = 'settings' | 'history' | 'about' | null;
export type OnboardingStep = 'language' | 'video' | 'connection';

export type UpdateState =
  | { status: 'idle' | 'checking' }
  | { status: 'available' | 'current'; info: UpdateInfo }
  | { status: 'error'; code: string };

export interface AppConfiguration {
  boot: BootstrapInfo | null;
  modelSlug: string | null;
  processingMode: ProcessingMode;
  onboardingOpen: boolean;
  onboardingRequired: boolean;
  onboardingStep: OnboardingStep;
  update: UpdateState;
}
