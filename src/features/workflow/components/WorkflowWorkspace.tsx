import { Button, Group, Modal, Text, Tooltip } from '@mantine/core';
import { AnimatePresence } from 'motion/react';
import { FileSpreadsheet, FolderOpen, LockKeyhole } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BootstrapInfo } from '../../../bridge';
import { openGeneratedFolder, openWorkbook } from '../../../bridge';
import FileUpload from './FileUpload';
import ReviewPanel from '../../review/ReviewPanel';
import WorkLoader from '../../../components/WorkLoader';
import { BlurFade } from '../../../components/ui/blur-fade';
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
  const consentProvider = boot.provider === 'codex'
    ? 'Codex'
    : boot.provider === 'compatible'
      ? t('connectedService')
      : 'Anthropic';

  return (
    <main className="relative z-10 min-h-0 flex-1 overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        {state.view === 'idle' && (
          <BlurFade key="idle" className="flex h-full flex-col items-center justify-center gap-4 px-8">
            <FileUpload onFile={onFile} />
            {boot.first_run && (
              <Text size="xs" c="dimmed" ta="center" maw={390}>
                {t('welcomeBody', { dir: boot.data_dir })}
              </Text>
            )}
            {state.error && (
              <Text size="xs" c="red" ta="center" maw={390} role="alert" className="allow-select">
                {state.error}
              </Text>
            )}
          </BlurFade>
        )}

        {state.view === 'consent' && state.pendingInspection && (
          <Modal
            key="consent"
            opened
            onClose={() => onConsent(false)}
            centered
            radius="lg"
            padding="xl"
            size="md"
            withCloseButton={false}
          >
            <LockKeyhole className="h-8 w-8 text-gold-deep dark:text-gold" strokeWidth={1.6} aria-hidden="true" />
            <Text className="font-serif-display" fw={650} size="lg" mt="md">{t('aiConsentTitle')}</Text>
            <Text size="sm" c="dimmed" mt={6}>{t('aiConsentBody')}</Text>
            <div className="mt-4 rounded-xl border border-ledger-line bg-ledger-surface-2 p-3 text-xs leading-5 text-ledger-ink-dim">
              {t('sharedFieldsSimple', {
                count: state.pendingInspection.inspection.items.length,
                provider: consentProvider,
              })}
            </div>
            <Text size="xs" c="dimmed" mt="sm">{t('aiConsentPrivacy')}</Text>
            <Group mt="lg" justify="flex-end">
              <Button variant="subtle" color="gray" onClick={() => onConsent(false)}>
                {t('stayOffline')}
              </Button>
              <Button
                color="gold"
                onClick={() => onConsent(true)}
                styles={{
                  root: {
                    color: '#1c1408',
                    fontWeight: 700,
                    background: 'linear-gradient(180deg, #f3c968, var(--gold))',
                  },
                }}
              >
                {t('improvePackages')}
              </Button>
            </Group>
          </Modal>
        )}

        {state.view === 'busy' && (
          <BlurFade key="busy" className="flex h-full flex-col items-center justify-center px-8">
            <WorkLoader
              title={state.busyMessage}
              subtitle={t('busyReassurance')}
              progress={state.busyProgress}
            />
            <Button
              mt="md"
              size="xs"
              variant="subtle"
              color="gray"
              disabled={!state.cancellable}
              onClick={onCancel}
            >
              {t('cancel')}
            </Button>
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
              className="h-12 w-12 text-gold drop-shadow-[0_8px_20px_rgba(232,181,74,0.24)]"
              strokeWidth={1.35}
              aria-hidden="true"
            />
            <Text className="font-serif-display" fw={650}>{t('doneTitle')}</Text>
            <Text size="sm" fw={600}>{state.output.projectName} · {state.output.revisionLabel}</Text>
            <Text
              size="xs"
              c="dimmed"
              ta="center"
              maw={430}
              style={{ wordBreak: 'break-all' }}
              className="allow-select"
            >
              {state.output.masterPath}
            </Text>
            {state.error && (
              <Text size="xs" c="red" ta="center" maw={400} role="alert" className="allow-select">
                {state.error}
              </Text>
            )}
            <Group gap="xs">
              <Tooltip label={t('openWorkbookDetail')} openDelay={180}>
                <Button
                  size="xs"
                  leftSection={<FileSpreadsheet size={13} aria-hidden="true" />}
                  onClick={() => void openWorkbook(state.output!.masterPath).catch(() => undefined)}
                  styles={{ root: { background: 'var(--surface-2)', color: 'var(--gold)', fontWeight: 600 } }}
                >
                  {t('openWorkbook')}
                </Button>
              </Tooltip>
              <Tooltip label={t('openPackagesDetail')} openDelay={180}>
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<FolderOpen size={13} aria-hidden="true" />}
                  onClick={() => void openGeneratedFolder(state.output!.packageFolder).catch(() => undefined)}
                >
                  {t('openPackages')}
                </Button>
              </Tooltip>
              <Button size="xs" variant="subtle" color="gray" onClick={onReset}>
                {t('newFile')}
              </Button>
            </Group>
          </BlurFade>
        )}
      </AnimatePresence>
    </main>
  );
}
