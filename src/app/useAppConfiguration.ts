import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bootstrap, checkForUpdate, getSettings } from '../bridge';
import type { ProcessingMode } from '../features/workflow/useBoqWorkflow';
import type { AppConfiguration, OnboardingStep, UpdateState } from './types';

function isProcessingMode(value: unknown): value is ProcessingMode {
  return value === 'ask' || value === 'online' || value === 'offline';
}

function isSupportedLocale(value: unknown): value is 'en' | 'ar' {
  return value === 'en' || value === 'ar';
}

export function useAppConfiguration() {
  const { i18n } = useTranslation();
  const [configuration, setConfiguration] = useState<AppConfiguration>({
    boot: null,
    modelSlug: null,
    processingMode: 'ask',
    onboardingOpen: false,
    onboardingRequired: false,
    onboardingStep: 'language',
    update: { status: 'idle' },
  });
  const updateRequest = useRef<Promise<void> | null>(null);
  const startupUpdateStarted = useRef(false);

  const refreshConfiguration = useCallback(async () => {
    try {
      const [bootInfo, settings] = await Promise.all([bootstrap(), getSettings()]);
      const onboardingStep: OnboardingStep = bootInfo.onboarding_step === 'complete'
        ? 'language'
        : bootInfo.onboarding_step;
      setConfiguration((current) => ({
        ...current,
        boot: bootInfo,
        modelSlug: typeof settings.model === 'string' && settings.model ? settings.model : null,
        processingMode: isProcessingMode(settings.processingMode)
          ? settings.processingMode
          : current.processingMode,
        onboardingOpen: bootInfo.onboarding_required || current.onboardingOpen,
        onboardingRequired: bootInfo.onboarding_required,
        onboardingStep: bootInfo.onboarding_required ? onboardingStep : current.onboardingStep,
      }));
      if (isSupportedLocale(settings.language)) await i18n.changeLanguage(settings.language);
    } catch {
      setConfiguration((current) => ({ ...current, boot: null }));
    }
  }, [i18n]);

  const refreshUpdate = useCallback((): Promise<void> => {
    if (updateRequest.current) return updateRequest.current;
    setConfiguration((current) => ({ ...current, update: { status: 'checking' } }));
    const request = checkForUpdate()
      .then((info) => setConfiguration((current) => ({
        ...current,
        update: { status: info.update_available ? 'available' : 'current', info },
      })))
      .catch((reason) => setConfiguration((current) => ({
        ...current,
        update: {
          status: 'error',
          code: reason instanceof Error ? reason.message : String(reason),
        },
      })))
      .finally(() => {
        updateRequest.current = null;
      });
    updateRequest.current = request;
    return request;
  }, []);

  useEffect(() => {
    // Bootstrap on mount; the state write happens in the async continuation, not
    // synchronously during render, so it cannot cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshConfiguration();
  }, [refreshConfiguration]);

  useEffect(() => {
    if (startupUpdateStarted.current) return;
    startupUpdateStarted.current = true;
    void refreshUpdate();
  }, [refreshUpdate]);

  useEffect(() => {
    document.documentElement.dir = i18n.language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  const openOnboarding = useCallback((required = false, step: OnboardingStep = 'language') => {
    setConfiguration((current) => ({
      ...current,
      onboardingOpen: true,
      onboardingRequired: required,
      onboardingStep: step,
    }));
  }, []);

  const closeOnboarding = useCallback(() => {
    setConfiguration((current) => ({ ...current, onboardingOpen: false }));
  }, []);

  const completeOnboarding = useCallback(async () => {
    setConfiguration((current) => ({
      ...current,
      onboardingOpen: false,
      onboardingRequired: false,
    }));
    await refreshConfiguration();
  }, [refreshConfiguration]);

  const setUpdate = useCallback((update: UpdateState) => {
    setConfiguration((current) => ({ ...current, update }));
  }, []);

  return {
    ...configuration,
    refreshConfiguration,
    refreshUpdate,
    openOnboarding,
    closeOnboarding,
    completeOnboarding,
    setUpdate,
  };
}
