import type { RuntimeBootstrapStatus } from '../../shared/platform';

export type AppSurface = 'bootstrap' | 'configuration' | 'onboarding' | 'workflow';

interface ReadyAppState {
  configured: boolean;
  onboardingOpen: boolean;
}

export function selectAppSurface(
  runtime: RuntimeBootstrapStatus,
  app: ReadyAppState,
): AppSurface {
  if (runtime.phase !== 'ready') return 'bootstrap';
  if (!app.configured) return 'configuration';
  return app.onboardingOpen ? 'onboarding' : 'workflow';
}
