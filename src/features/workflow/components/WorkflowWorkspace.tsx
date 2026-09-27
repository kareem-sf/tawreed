import { useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AnimatePresence } from 'motion/react';
import { FileSpreadsheet, FolderOpen, LockKeyhole } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BootstrapInfo } from '../../../bridge';
import { openGeneratedFolder, openWorkbook } from '../../../bridge';
import FileUpload from './FileUpload';
import ReviewPanel from '../../review/ReviewPanel';
import WorkLoader from '../../../components/WorkLoader';
import { BlurFade } from '../../../components/ui/blur-fade';
import { Button } from '../../../components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';
import {
  ResponsiveModal,
  ResponsiveModalDescription,
  ResponsiveModalOverlay,
  ResponsiveModalTitle,
} from '../../../components/spectrumui/responsive-modal-dependencies';
import type { WorkflowState } from '../types';

interface Props {
  boot: BootstrapInfo;
  state: WorkflowState;
  onFile: (file: File) => void;
  onConsent: (allowAi: boolean) => void;
  onCancel: () => void;
  onGenerate: () => void;
  onReset: () => void;
  onClassificationChange: (itemId: number, packageCode: string) => void;
}

export function consentProviderName(provider: BootstrapInfo['provider'], t: (key: string) => string): string {
  if (provider === 'codex') return 'Codex';
  if (provider === 'compatible') return t('connectedService');
  if (provider === 'gemini') return 'Gemini';
  if (provider === 'grok') return 'Grok';
  if (provider === 'anthropic') return 'Anthropic';
  return t('connectedService');
}

export function WorkflowWorkspace({
  boot,
  state,
  onFile,
  onConsent,
  onCancel,
  onGenerate,
  onReset,
  onClassificationChange,
}: Props) {
  const { t } = useTranslation();
  const consentProvider = consentProviderName(boot.provider, t);
  const [openError, setOpenError] = useState<string | null>(null);

  return (
    <main className="relative z-10 min-h-0 flex-1 overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        {state.view === 'idle' && (
          <BlurFade key="idle" className="flex h-full flex-col items-center justify-center gap-4 px-8">
            <FileUpload onFile={onFile} />
            {boot.first_run && (
              <p className="mx-auto max-w-[390px] text-center text-xs text-muted-foreground">
                {t('welcomeBody', { dir: boot.data_dir })}
              </p>
            )}
            {state.error && (
              <p role="alert" className="allow-select mx-auto max-w-[390px] text-center text-xs text-destructive">
                {state.error}
              </p>
            )}
          </BlurFade>
        )}

        {state.view === 'consent' && state.pendingInspection && (
          <ResponsiveModal key="consent" open onOpenChange={() => undefined}>
            <ResponsiveModalOverlay />
            <DialogPrimitive.Content
              // No implicit close: ESC/backdrop must not silently start an offline
              // run behind the user's back — the choice has to be explicit.
              // There is deliberately no close button either.
              onEscapeKeyDown={(event) => event.preventDefault()}
              onPointerDownOutside={(event) => event.preventDefault()}
              className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border bg-background p-6 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
            >
              <LockKeyhole className="h-8 w-8 text-primary" strokeWidth={1.6} aria-hidden="true" />
              <ResponsiveModalTitle className="mt-4">{t('aiConsentTitle')}</ResponsiveModalTitle>
              <ResponsiveModalDescription className="mt-1.5">{t('aiConsentBody')}</ResponsiveModalDescription>
              <div className="mt-4 rounded-xl border border bg-muted p-3 text-xs leading-5 text-muted-foreground">
                {t('sharedFieldsSimple', {
                  count: state.pendingInspection.inspection.items.length,
                  provider: consentProvider,
                })}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{t('aiConsentPrivacy')}</p>
              <div className="mt-5 flex items-center justify-end gap-2">
                <Button variant="ghost" onClick={() => onConsent(false)}>
                  {t('stayOffline')}
                </Button>
                <Button onClick={() => onConsent(true)}>
                  {t('improvePackages')}
                </Button>
              </div>
            </DialogPrimitive.Content>
          </ResponsiveModal>
        )}

        {state.view === 'busy' && (
          <BlurFade key="busy" className="flex h-full flex-col items-center justify-center px-8">
            <WorkLoader
              title={state.busyMessage}
              subtitle={t('busyReassurance')}
              progress={state.busyProgress}
            />
            <div className="mt-4">
              <Button
                size="sm"
                variant="ghost"
                disabled={!state.cancellable}
                onClick={onCancel}
              >
                {t('cancel')}
              </Button>
            </div>
          </BlurFade>
        )}

        {state.view === 'review' && state.data && (
          <BlurFade key="review" className="h-full pt-1">
            <ReviewPanel
              data={state.data}
              busy={state.generating}
              error={state.error}
              hasErrors={state.data.issues.some((issue) => issue.severity === 'error')}
              retryingPublication={state.pendingPublication !== null}
              onGenerate={onGenerate}
              onReset={onReset}
              onClassificationChange={onClassificationChange}
            />
          </BlurFade>
        )}

        {state.view === 'done' && state.output && (
          <BlurFade key="done" className="flex h-full flex-col items-center justify-center gap-3 px-8">
            <FileSpreadsheet
              className="h-12 w-12 text-primary"
              strokeWidth={1.35}
              aria-hidden="true"
            />
            <p className="text-sm font-semibold text-foreground">{t('doneTitle')}</p>
            <p className="text-xs text-muted-foreground">{state.output.projectName} · {state.output.revisionLabel}</p>
            <p className="allow-select mx-auto max-w-[430px] break-all text-center text-xs text-muted-foreground">
              {state.output.masterPath}
            </p>
            {state.error && (
              <p role="alert" className="allow-select mx-auto max-w-[400px] text-center text-xs text-destructive">
                {state.error}
              </p>
            )}
            {openError && (
              <p role="alert" className="allow-select mx-auto max-w-[400px] text-center text-xs text-destructive">
                {openError}
              </p>
            )}
            <div className="flex items-center gap-2.5">
              <Tooltip delayDuration={400}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setOpenError(null);
                      void openWorkbook(state.output!.masterPath).catch(() => setOpenError(t('errorGeneric')));
                    }}
                  >
                    <FileSpreadsheet size={13} aria-hidden="true" />
                    {t('openWorkbook')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('openWorkbookDetail')}</TooltipContent>
              </Tooltip>
              <Tooltip delayDuration={400}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setOpenError(null);
                      void openGeneratedFolder(state.output!.packageFolder).catch(() => setOpenError(t('errorGeneric')));
                    }}
                  >
                    <FolderOpen size={13} aria-hidden="true" />
                    {t('openPackages')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('openPackagesDetail')}</TooltipContent>
              </Tooltip>
              <Button size="sm" variant="ghost" onClick={onReset}>
                {t('newFile')}
              </Button>
            </div>
          </BlurFade>
        )}
      </AnimatePresence>
    </main>
  );
}
