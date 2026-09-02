import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppDialogs } from './app/AppDialogs';
import type { AppDialog } from './app/types';
import { useAppConfiguration } from './app/useAppConfiguration';
import Onboarding from './features/onboarding/Onboarding';
import TitleBar from './components/TitleBar';
import WorkLoader from './components/WorkLoader';
import { DotPattern } from './components/ui/dot-pattern';
import { WorkflowWorkspace } from './features/workflow/components/WorkflowWorkspace';
import { useBoqWorkflow } from './features/workflow/useBoqWorkflow';

export default function App() {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<AppDialog>(null);
  const configuration = useAppConfiguration();
  const workflow = useBoqWorkflow({
    boot: configuration.boot,
    modelSlug: configuration.modelSlug,
    processingMode: configuration.processingMode,
  });

  if (!configuration.boot) {
    return (
      <div className="app-frame flex items-center justify-center">
        <WorkLoader title={t('startingTawreed')} size="md" />
      </div>
    );
  }

  if (configuration.onboardingOpen) {
    return (
      <div className="app-frame">
        <Onboarding
          initialStep={configuration.onboardingStep}
          required={configuration.onboardingRequired}
          hasKey={configuration.boot.has_api_key}
          hasCompatibleKey={configuration.boot.has_compatible_key}
          hasGeminiKey={configuration.boot.has_gemini_key}
          hasGrokKey={configuration.boot.has_grok_key}
          onComplete={() => void configuration.completeOnboarding()}
          onClose={configuration.closeOnboarding}
        />
      </div>
    );
  }

  return (
    <div className="app-frame relative">
      <DotPattern className="text-zinc-400/20 [mask-image:radial-gradient(ellipse_at_center,black_15%,transparent_78%)] dark:text-white/[0.045]" />
      <TitleBar
        onSettings={() => setDialog('settings')}
        onHistory={() => setDialog('history')}
        updateAvailable={configuration.update.status === 'available'}
        modalOpen={dialog !== null}
      />

      <WorkflowWorkspace
        boot={configuration.boot}
        state={workflow.state}
        onFile={(file) => void workflow.handleFile(file)}
        onConsent={workflow.analyzePending}
        onCancel={workflow.cancel}
        onGenerate={() => void workflow.generate()}
        onReset={workflow.reset}
        onClassificationChange={workflow.changeClassification}
      />

      <AppDialogs
        active={dialog}
        boot={configuration.boot}
        update={configuration.update}
        onChange={setDialog}
        onSettingsClosed={() => void configuration.refreshConfiguration()}
        onProviderChanged={() => void configuration.refreshConfiguration()}
        onRunOnboarding={() => configuration.openOnboarding(false, 'language')}
        onCheckUpdate={configuration.refreshUpdate}
      />
    </div>
  );
}
