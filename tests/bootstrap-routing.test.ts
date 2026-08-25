import { describe, expect, it } from 'vitest';
import { selectAppSurface } from '../src/app/routing';
import type { RuntimeBootstrapStatus } from '../shared/platform';

const runtimeReady: RuntimeBootstrapStatus = {
  phase: 'ready', progress: 100, component: null, version: null,
  errorCode: null, recoverable: false,
};

describe('application runtime gate', () => {
  it('keeps bootstrap ahead of configuration and onboarding', () => {
    expect(selectAppSurface(
      { ...runtimeReady, phase: 'checking', progress: null },
      { configured: false, onboardingOpen: true },
    )).toBe('bootstrap');
  });

  it('preserves loading, onboarding, and workflow branches after runtime readiness', () => {
    expect(selectAppSurface(runtimeReady, { configured: false, onboardingOpen: false }))
      .toBe('configuration');
    expect(selectAppSurface(runtimeReady, { configured: true, onboardingOpen: true }))
      .toBe('onboarding');
    expect(selectAppSurface(runtimeReady, { configured: true, onboardingOpen: false }))
      .toBe('workflow');
  });
});
