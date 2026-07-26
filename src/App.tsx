import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Drawer, Group, Modal, Text, Tooltip } from '@mantine/core';
import { AnimatePresence } from 'motion/react';
import { FileSpreadsheet, FolderOpen, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  appLog,
  bootstrap,
  checkForUpdate,
  discardRevision,
  getSettings,
  listClassificationMemory,
  makeCodexTransport,
  makeLlmTransport,
  openGeneratedFolder,
  openUpdateRelease,
  openWorkbook,
  recordRun,
  reserveRevision,
  saveClassificationMemory,
  sha256Hex,
  writeRevisionBundle,
  type BootstrapInfo,
  type RevisionOutput,
  type RevisionReservation,
} from './bridge';
import TitleBar from './components/TitleBar';
import FileUpload from './components/FileUpload';
import ReviewPanel, { type PipelineData } from './components/ReviewPanel';
import SettingsModal from './components/SettingsModal';
import HistoryDrawer from './components/HistoryDrawer';
import AboutModal, { type UpdateState } from './components/AboutModal';
import { AnimatedShinyText } from './components/ui/animated-shiny-text';
import { BlurFade } from './components/ui/blur-fade';
import { DotPattern } from './components/ui/dot-pattern';
import { DEFAULT_MODEL, UNCLASSIFIED_CODE } from '../engine/classify/llm';
import {
  applyClassificationMemory,
  memoryFromApprovedReview,
  reviseClassification,
  workflowEvent,
} from '../engine/agent-workflow';
import { buildPackages, validate } from '../engine/validate';
import type { GeneratedArtifact } from '../engine/generate';
import type { AgentEvent, AiProvider, InspectionResult } from '../shared/types';
import { generateInWorker, inspectInWorker, WorkerCancelledError } from './boq-worker';

type View = 'idle' | 'busy' | 'consent' | 'review' | 'done';

interface PendingInspection {
  inspection: InspectionResult;
  fileName: string;
  bytes: Uint8Array;
  startedAt: number;
  trace: AgentEvent[];
}

interface PendingPublication {
  reservation: RevisionReservation;
  artifacts: GeneratedArtifact[];
}

function isCancellation(reason: unknown): boolean {
  return reason instanceof WorkerCancelledError
    || (reason instanceof Error && reason.name === 'AbortError');
}

export default function App() {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<View>('idle');
  const [busyMsg, setBusyMsg] = useState('');
  const [boot, setBoot] = useState<BootstrapInfo | null>(null);
  const [modelSlug, setModelSlug] = useState<string | null>(null);
  const [pendingInspection, setPendingInspection] = useState<PendingInspection | null>(null);
  const [pendingPublication, setPendingPublication] = useState<PendingPublication | null>(null);
  const [data, setData] = useState<PipelineData | null>(null);
  const [output, setOutput] = useState<RevisionOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' });
  const [generating, setGenerating] = useState(false);
  const [cancellable, setCancellable] = useState(false);
  const updateRequest = useRef<Promise<void> | null>(null);
  const startupUpdateStarted = useRef(false);
  const generatingRef = useRef(false);
  const cancelJobRef = useRef<(() => void) | null>(null);

  const refreshConfiguration = useCallback(() => {
    Promise.all([bootstrap(), getSettings()])
      .then(([info, settings]) => {
        setBoot(info);
        setModelSlug(typeof settings.model === 'string' && settings.model ? settings.model : null);
        if (typeof settings.language === 'string' && ['en', 'ar'].includes(settings.language)) {
          void i18n.changeLanguage(settings.language);
        }
      })
      .catch(() => setBoot(null));
  }, [i18n]);

  useEffect(() => {
    refreshConfiguration();
  }, [refreshConfiguration]);

  const refreshUpdate = useCallback((): Promise<void> => {
    if (updateRequest.current) return updateRequest.current;
    setUpdate({ status: 'checking' });
    const request = checkForUpdate()
      .then((info) => setUpdate({ status: info.update_available ? 'available' : 'current', info }))
      .catch((reason) => setUpdate({
        status: 'error',
        code: reason instanceof Error ? reason.message : String(reason),
      }))
      .finally(() => {
        updateRequest.current = null;
      });
    updateRequest.current = request;
    return request;
  }, []);

  useEffect(() => {
    if (startupUpdateStarted.current) return;
    startupUpdateStarted.current = true;
    void refreshUpdate();
  }, [refreshUpdate]);

  useEffect(() => {
    document.documentElement.dir = i18n.language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openHistory = useCallback(() => setHistoryOpen(true), []);
  const openAbout = useCallback(() => setAboutOpen(true), []);

  function clearActiveCancellation() {
    cancelJobRef.current = null;
    setCancellable(false);
  }

  function reset() {
    cancelJobRef.current?.();
    if (pendingPublication) {
      void discardRevision(pendingPublication.reservation).catch(() => undefined);
    }
    clearActiveCancellation();
    setPendingInspection(null);
    setPendingPublication(null);
    setData(null);
    setOutput(null);
    setError(null);
    setView('idle');
  }

  async function analyze(pending: PendingInspection, allowAi: boolean) {
    setError(null);
    setView('busy');
    const resolvedProvider = allowAi && boot?.provider !== 'none'
      ? boot?.provider
      : 'offline';
    const provider: AiProvider = resolvedProvider ?? 'offline';
    const model = provider === 'codex'
      ? modelSlug ?? ''
      : provider === 'anthropic'
        ? DEFAULT_MODEL
        : '';
    const controller = new AbortController();
    if (provider !== 'offline') {
      cancelJobRef.current = () => controller.abort();
      setCancellable(true);
    }
    const trace = [...pending.trace, workflowEvent(
      'consent',
      'completed',
      provider === 'offline'
        ? 'Local-only processing selected'
        : `User approved ${provider} for this document`,
    )];

    try {
      const [{ classifyAll }, { refineInspectionWithAgent }] = await Promise.all([
        import('../engine/classify'),
        import('../engine/document-agent'),
      ]);
      const transport = provider === 'codex'
        ? makeCodexTransport(modelSlug, controller.signal)
        : makeLlmTransport(controller.signal);
      let inspection = pending.inspection;
      let llmFailed = false;

      if (provider !== 'offline') {
        setBusyMsg(t('analyzingDocument'));
        try {
          inspection = await refineInspectionWithAgent(inspection, transport);
          trace.push(workflowEvent(
            'document-analysis',
            'completed',
            `Grounded project and comments with ${provider}`,
          ));
        } catch (reason) {
          if (isCancellation(reason)) throw reason;
          trace.push(workflowEvent(
            'document-analysis',
            'fallback',
            'Grounded agent unavailable; deterministic inspection retained',
          ));
          void appLog(
            `document intelligence fallback: ${reason instanceof Error ? reason.message : String(reason)}`,
          );
        }
      } else {
        trace.push(workflowEvent(
          'document-analysis',
          'completed',
          'Deterministic local document analysis',
        ));
      }

      setBusyMsg(t('classifying'));
      let classifications;
      try {
        classifications = await classifyAll(inspection.items, {
          useLlm: provider !== 'offline',
          transport: provider !== 'offline' ? transport : undefined,
          onProgress: (progress) => setBusyMsg(t('aiBusy', {
            done: progress.done,
            total: progress.total,
          })),
        });
      } catch (reason) {
        if (isCancellation(reason)) throw reason;
        llmFailed = provider !== 'offline';
        void appLog(
          `classification fallback: ${reason instanceof Error ? reason.message : String(reason)}`,
        );
        classifications = await classifyAll(inspection.items, { useLlm: false });
      }
      const llmApplied = classifications.some(
        (classification) =>
          classification.source === 'llm' && classification.packageCode !== UNCLASSIFIED_CODE,
      );
      if (provider !== 'offline' && !llmApplied) llmFailed = true;
      trace.push(workflowEvent(
        'classify',
        llmFailed ? 'fallback' : 'completed',
        llmFailed
          ? 'Provider unavailable; deterministic classification completed'
          : `${inspection.items.length} items classified`,
      ));

      let memoryApplied = 0;
      try {
        const memory = await listClassificationMemory(inspection.projectName);
        const remembered = applyClassificationMemory(inspection.items, classifications, memory);
        classifications = remembered.classifications;
        memoryApplied = remembered.applied;
        trace.push(workflowEvent(
          'memory',
          'completed',
          memoryApplied
            ? `${memoryApplied} exact approved project matches applied`
            : 'No exact approved project matches',
        ));
      } catch (reason) {
        trace.push(workflowEvent('memory', 'fallback', 'Local project memory was unavailable'));
        void appLog(`classification memory unavailable: ${String(reason)}`);
      }

      const packages = buildPackages(inspection.items, classifications);
      const issues = validate(inspection.items, classifications, packages);
      trace.push(workflowEvent(
        'validate',
        'completed',
        `${issues.length} validation findings; source quantities remain authoritative`,
      ));
      trace.push(workflowEvent('human-review', 'started', 'Waiting for item-level approval'));

      setData({
        inspection,
        classifications,
        packages,
        packageCatalog: packages,
        issues,
        llmUsed: provider !== 'offline' && !llmFailed && llmApplied,
        llmFailed,
        provider,
        model,
        trace,
        memoryApplied,
        fileName: pending.fileName,
        bytes: pending.bytes,
        startedAt: pending.startedAt,
      });
      setPendingInspection(null);
      setView('review');
    } catch (reason) {
      if (isCancellation(reason)) {
        reset();
        return;
      }
      setError(reason instanceof Error ? reason.message : String(reason));
      setView('idle');
    } finally {
      clearActiveCancellation();
    }
  }

  async function handleFile(file: File) {
    setError(null);
    setOutput(null);
    setView('busy');
    const trace = [workflowEvent('inspect', 'started', 'Local document inspection started')];
    try {
      setBusyMsg(t('parsing'));
      const bytes = new Uint8Array(await file.arrayBuffer());
      const startedAt = Date.now();
      const inspectJob = inspectInWorker(bytes, file.name, (progress) => {
        if (progress.phase === 'ocr') {
          setBusyMsg(t('ocrProgress', {
            page: progress.page,
            total: progress.total,
            percent: Math.round((progress.progress ?? 0) * 100),
          }));
        } else if (progress.phase === 'pdf') {
          setBusyMsg(t('pdfProgress', { page: progress.page, total: progress.total }));
        } else {
          setBusyMsg(t('analyzingDocument'));
        }
      });
      cancelJobRef.current = inspectJob.cancel;
      setCancellable(true);
      const inspection = await inspectJob.promise;
      clearActiveCancellation();
      trace.push(workflowEvent(
        'inspect',
        'completed',
        `${inspection.items.length} source-backed items extracted locally`,
      ));
      void appLog(
        `inspection: file=${file.name} source=${inspection.sourceKind} project=${inspection.projectName} items=${inspection.items.length} confidence=${inspection.mapping.confidence.toFixed(2)}`,
      );
      const pending = { inspection, fileName: file.name, bytes, startedAt, trace };
      if (boot?.provider && boot.provider !== 'none') {
        setPendingInspection(pending);
        setView('consent');
      } else {
        await analyze(pending, false);
      }
    } catch (reason) {
      clearActiveCancellation();
      if (isCancellation(reason)) {
        reset();
        return;
      }
      setError(reason instanceof Error ? reason.message : String(reason));
      setView('idle');
    }
  }

  function handleClassificationChange(itemId: number, packageCode: string) {
    if (!data) return;
    if (pendingPublication) {
      void discardRevision(pendingPublication.reservation).catch(() => undefined);
      setPendingPublication(null);
    }
    const workPackage = data.packageCatalog.find((candidate) => candidate.code === packageCode)
      ?? {
        code: 'WP-99',
        nameEn: 'Unclassified',
        nameAr: 'غير مصنف',
        itemIds: [],
        totalCost: 0,
        itemCount: 0,
      };
    const classifications = reviseClassification(data.classifications, itemId, workPackage);
    const packages = buildPackages(data.inspection.items, classifications);
    const issues = validate(data.inspection.items, classifications, packages);
    setData({ ...data, classifications, packages, issues });
  }

  async function generate() {
    if (generatingRef.current || !data) return;
    generatingRef.current = true;
    setGenerating(true);
    setError(null);
    setView('busy');
    let reservation = pendingPublication?.reservation ?? null;
    let artifacts = pendingPublication?.artifacts ?? null;
    const trace = [...data.trace];
    if (!trace.some(
      (event) => event.stage === 'human-review' && event.status === 'completed',
    )) {
      trace.push(workflowEvent('human-review', 'completed', 'User approved item classifications'));
    }

    try {
      const approvedMemory = memoryFromApprovedReview(
        data.inspection.items,
        data.classifications,
        data.packages,
      ).map((entry) => ({ ...entry, updatedAt: new Date().toISOString() }));
      try {
        await saveClassificationMemory(data.inspection.projectName, approvedMemory);
      } catch (reason) {
        void appLog(`classification memory save failed (non-fatal): ${String(reason)}`);
      }

      if (!reservation || !artifacts) {
        reservation = await reserveRevision(data.inspection.projectName);
        const outputArabic = data.inspection.language === 'ar'
          || (
            data.inspection.language === 'mixed'
            && /[\u0600-\u06ff]/.test(data.inspection.projectName)
          );
        setBusyMsg(t('generatingBundle', { revision: reservation.revisionLabel }));
        trace.push(workflowEvent('generate', 'started', `Building ${reservation.revisionLabel}`));
        const generateJob = generateInWorker({
          packages: data.packages,
          items: data.inspection.items,
          projectName: reservation.projectName,
          revision: reservation.revision,
          locale: outputArabic ? 'ar' : 'en',
          documentLanguage: data.inspection.language,
        });
        cancelJobRef.current = generateJob.cancel;
        setCancellable(true);
        artifacts = await generateJob.promise;
        clearActiveCancellation();
        trace.push(workflowEvent(
          'generate',
          'completed',
          `${artifacts.length} workbook artifacts built`,
        ));
      } else {
        setBusyMsg(t('retryingPublish', { revision: reservation.revisionLabel }));
      }

      setBusyMsg(t('publishingRevision', { revision: reservation.revisionLabel }));
      trace.push(workflowEvent('publish', 'started', `Publishing ${reservation.revisionLabel}`));
      let published: RevisionOutput;
      try {
        published = await writeRevisionBundle(reservation, artifacts);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        if (/preserved at/i.test(message)) {
          trace.push(workflowEvent(
            'publish',
            'failed',
            'Generated artifacts preserved for a safe retry',
          ));
          setPendingPublication({ reservation, artifacts });
          setData({ ...data, trace });
          setError(message);
          setView('review');
          return;
        }
        await discardRevision(reservation).catch(() => undefined);
        throw reason;
      }
      trace.push(workflowEvent('publish', 'completed', `${published.revisionLabel} published`));
      setPendingPublication(null);
      setData({ ...data, trace });

      try {
        await recordRun({
          startedAt: new Date(data.startedAt).toISOString(),
          fileName: data.fileName,
          fileHash: await sha256Hex(data.bytes),
          itemCount: data.inspection.items.length,
          packageCount: data.packages.length,
          errorCount: data.issues.filter((issue) => issue.severity === 'error').length,
          warningCount: data.issues.filter((issue) => issue.severity === 'warning').length,
          outputFile: published.masterPath,
          durationMs: Date.now() - data.startedAt,
          llmUsed: data.llmUsed,
          projectName: published.projectName,
          revision: published.revision,
          packageFolder: published.packageFolder,
          sourceKind: data.inspection.sourceKind,
          ocrUsed: data.inspection.ocrPages > 0,
          provider: data.provider,
          model: data.model,
          trace,
          memoryApplied: data.memoryApplied,
        });
      } catch (reason) {
        void appLog(
          `recordRun failed (non-fatal): ${reason instanceof Error ? reason.message : String(reason)}`,
        );
      }
      setOutput(published);
      setView('done');
      void openWorkbook(published.masterPath).catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    } catch (reason) {
      if (reservation) await discardRevision(reservation).catch(() => undefined);
      if (isCancellation(reason)) {
        trace.push(workflowEvent('generate', 'cancelled', 'Generation cancelled by user'));
      } else {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
      setData({ ...data, trace });
      setView('review');
    } finally {
      clearActiveCancellation();
      generatingRef.current = false;
      setGenerating(false);
    }
  }

  const consentProvider = boot?.provider === 'codex' ? 'Codex' : 'Anthropic';
  const consentModel = boot?.provider === 'codex'
    ? modelSlug || t('modelPlaceholder')
    : DEFAULT_MODEL;

  return (
    <div className="app-frame relative">
      <DotPattern className="text-zinc-400/20 [mask-image:radial-gradient(ellipse_at_center,black_15%,transparent_78%)] dark:text-white/[0.045]" />
      <TitleBar
        onSettings={openSettings}
        onHistory={openHistory}
        onAbout={openAbout}
        updateAvailable={update.status === 'available'}
        modalOpen={settingsOpen || historyOpen || aboutOpen}
      />

      <main className="relative z-10 min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          {view === 'idle' && (
            <BlurFade key="idle" className="flex h-full flex-col items-center justify-center gap-4 px-8">
              <FileUpload onFile={handleFile} />
              {boot?.first_run && (
                <Text size="xs" c="dimmed" ta="center" maw={390}>
                  {t('welcomeBody', { dir: boot.data_dir })}
                </Text>
              )}
              {error && (
                <Text size="xs" c="red" ta="center" maw={390} role="alert" className="allow-select">
                  {error}
                </Text>
              )}
            </BlurFade>
          )}

          {view === 'consent' && pendingInspection && (
            <BlurFade key="consent" className="flex h-full flex-col items-center justify-center gap-3 px-10">
              <ShieldCheck className="h-11 w-11 text-amber-500" strokeWidth={1.4} />
              <Text fw={650} size="lg">{t('aiConsentTitle')}</Text>
              <Text size="sm" c="dimmed" ta="center" maw={520}>{t('aiConsentBody')}</Text>
              <Group gap="xs">
                <Badge color="grape" variant="light">{consentProvider}</Badge>
                <Badge color="gray" variant="light">{consentModel}</Badge>
                <Badge color="teal" variant="light">
                  {t('itemCount', { count: pendingInspection.inspection.items.length })}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed" ta="center" maw={500}>{t('aiConsentPrivacy')}</Text>
              <Group mt="xs">
                <Button
                  variant="subtle"
                  color="gray"
                  onClick={() => void analyze(pendingInspection, false)}
                >
                  {t('stayOffline')}
                </Button>
                <Button color="yellow" onClick={() => void analyze(pendingInspection, true)}>
                  {t('allowProvider', { provider: consentProvider })}
                </Button>
              </Group>
            </BlurFade>
          )}

          {view === 'busy' && (
            <BlurFade key="busy" className="flex h-full flex-col items-center justify-center gap-2 px-8">
              <div role="status" aria-live="polite">
                <AnimatedShinyText className="text-xl">{busyMsg}</AnimatedShinyText>
              </div>
              <Button
                size="xs"
                variant="subtle"
                color="gray"
                disabled={!cancellable}
                onClick={() => cancelJobRef.current?.()}
              >
                {t('cancel')}
              </Button>
            </BlurFade>
          )}

          {view === 'review' && data && (
            <BlurFade key="review" className="h-full pt-1">
              <ReviewPanel
                data={data}
                busy={generating}
                error={error}
                hasErrors={data.issues.some((issue) => issue.severity === 'error')}
                retryingPublication={!!pendingPublication}
                onGenerate={generate}
                onReset={reset}
                onClassificationChange={handleClassificationChange}
              />
            </BlurFade>
          )}

          {view === 'done' && (
            <BlurFade key="done" className="flex h-full flex-col items-center justify-center gap-3 px-8">
              <FileSpreadsheet
                className="h-12 w-12 text-amber-500 drop-shadow-[0_8px_20px_rgba(232,181,74,0.24)]"
                strokeWidth={1.35}
              />
              <Text fw={650}>{t('doneTitle')}</Text>
              <Text size="sm" fw={600}>{output?.projectName} · {output?.revisionLabel}</Text>
              <Text
                size="xs"
                c="dimmed"
                ta="center"
                maw={430}
                style={{ wordBreak: 'break-all' }}
                className="allow-select"
              >
                {output?.masterPath}
              </Text>
              {error && (
                <Text size="xs" c="red" ta="center" maw={400} role="alert" className="allow-select">
                  {error}
                </Text>
              )}
              <Group gap="xs">
                <Tooltip label={t('openWorkbookDetail')} openDelay={180}>
                  <Button
                    size="xs"
                    leftSection={<FileSpreadsheet size={13} />}
                    onClick={() =>
                      output && openWorkbook(output.masterPath).catch(() => undefined)}
                    styles={{ root: { background: '#1a1408', color: '#f5d58a', fontWeight: 600 } }}
                  >
                    {t('openWorkbook')}
                  </Button>
                </Tooltip>
                <Tooltip label={t('openPackagesDetail')} openDelay={180}>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="gray"
                    leftSection={<FolderOpen size={13} />}
                    onClick={() =>
                      output && openGeneratedFolder(output.packageFolder).catch(() => undefined)}
                  >
                    {t('openPackages')}
                  </Button>
                </Tooltip>
                <Button size="xs" variant="subtle" color="gray" onClick={reset}>
                  {t('newFile')}
                </Button>
              </Group>
            </BlurFade>
          )}
        </AnimatePresence>
      </main>

      <Modal
        opened={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          refreshConfiguration();
        }}
        title={t('settings')}
        centered
        size="sm"
        closeButtonProps={{ 'aria-label': t('close') }}
      >
        <SettingsModal
          dataDir={boot?.data_dir ?? ''}
          hasKey={!!boot?.has_api_key}
          onOpenAbout={() => {
            setSettingsOpen(false);
            setAboutOpen(true);
          }}
        />
      </Modal>
      <Modal
        opened={aboutOpen}
        onClose={() => setAboutOpen(false)}
        centered
        size="md"
        withCloseButton={false}
      >
        <AboutModal
          version={boot?.version ?? 'dev'}
          update={update}
          onCheckUpdate={refreshUpdate}
          onOpenUpdate={openUpdateRelease}
          onClose={() => setAboutOpen(false)}
        />
      </Modal>
      <Drawer
        opened={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={t('history')}
        position={i18n.language === 'ar' ? 'left' : 'right'}
        size={560}
        closeButtonProps={{ 'aria-label': t('close') }}
      >
        <HistoryDrawer opened={historyOpen} />
      </Drawer>
    </div>
  );
}
