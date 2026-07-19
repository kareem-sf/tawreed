import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Drawer, Group, Modal, Text, Tooltip } from '@mantine/core';
import { AnimatePresence } from 'motion/react';
import { FileSpreadsheet, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  appLog, bootstrap, checkForUpdate, discardRevision, getSettings, makeCodexTransport, makeLlmTransport,
  openUpdateRelease,
  openGeneratedFolder, openWorkbook, recordRun, reserveRevision, sha256Hex, writeRevisionBundle,
  type BootstrapInfo, type RevisionOutput, type RevisionReservation,
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
import { generateInWorker, inspectInWorker } from './boq-worker';

type View = 'idle' | 'busy' | 'review' | 'done';

export default function App() {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<View>('idle');
  const [busyMsg, setBusyMsg] = useState('');
  const [boot, setBoot] = useState<BootstrapInfo | null>(null);
  const [modelSlug, setModelSlug] = useState<string | null>(null);
  const [data, setData] = useState<PipelineData | null>(null);
  const [output, setOutput] = useState<RevisionOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' });
  const updateRequest = useRef<Promise<void> | null>(null);
  const startupUpdateStarted = useRef(false);
  const generatingRef = useRef(false);
  const abortRef = useRef(false);

  const refreshConfiguration = () => {
    Promise.all([bootstrap(), getSettings()])
      .then(([info, settings]) => {
        setBoot(info);
        setModelSlug(typeof settings.model === 'string' && settings.model ? settings.model : null);
        if (typeof settings.language === 'string' && ['en', 'ar'].includes(settings.language)) {
          void i18n.changeLanguage(settings.language);
        }
      })
      .catch(() => setBoot(null));
  };

  useEffect(() => { refreshConfiguration(); }, []);
  const refreshUpdate = (): Promise<void> => {
    if (updateRequest.current) return updateRequest.current;
    setUpdate({ status: 'checking' });
    const request = checkForUpdate()
      .then((info) => setUpdate({ status: info.update_available ? 'available' : 'current', info }))
      .catch((reason) => setUpdate({ status: 'error', code: reason instanceof Error ? reason.message : String(reason) }))
      .finally(() => { updateRequest.current = null; });
    updateRequest.current = request;
    return request;
  };
  useEffect(() => {
    if (startupUpdateStarted.current) return;
    startupUpdateStarted.current = true;
    void refreshUpdate();
  }, []);
  useEffect(() => {
    const disableContextMenu = (event: MouseEvent) => event.preventDefault();
    document.addEventListener('contextmenu', disableContextMenu);
    return () => document.removeEventListener('contextmenu', disableContextMenu);
  }, []);
  useEffect(() => {
    document.documentElement.dir = i18n.language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  const handleFile = useCallback(async (file: File) => {
    abortRef.current = false;
    setError(null);
    setOutput(null);
    setView('busy');
    try {
      setBusyMsg(t('parsing'));
      // ExcelJS parsing runs off the UI thread; only light classification logic loads here.
      const [{ classifyAll }, { buildPackages, validate }] = await Promise.all([
        import('../engine/classify'),
        import('../engine/validate'),
      ]);
      if (abortRef.current) return;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (abortRef.current) return;
      const startedAt = Date.now();
      let inspection = await inspectInWorker(bytes, file.name, (progress) => {
        if (progress.phase === 'ocr') {
          setBusyMsg(t('ocrProgress', { page: progress.page, total: progress.total, percent: Math.round((progress.progress ?? 0) * 100) }));
        } else if (progress.phase === 'pdf') {
          setBusyMsg(t('pdfProgress', { page: progress.page, total: progress.total }));
        } else {
          setBusyMsg(t('analyzingDocument'));
        }
      });
      if (abortRef.current) return;
      void appLog(`inspection: file=${file.name} source=${inspection.sourceKind} project=${inspection.projectName} items=${inspection.items.length} confidence=${inspection.mapping.confidence.toFixed(2)}`);

      const provider = boot?.provider ?? 'none';
      const useLlm = provider !== 'none';
      const transport = provider === 'codex' ? makeCodexTransport(modelSlug) : makeLlmTransport();
      let llmFailed = false;
      if (useLlm) {
        setBusyMsg(t('analyzingDocument'));
        try {
          const { refineInspectionWithAgent } = await import('../engine/document-agent');
          inspection = await refineInspectionWithAgent(inspection, transport);
        } catch (err) {
          void appLog(`document intelligence fallback: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (abortRef.current) return;

      setBusyMsg(t('classifying'));
      let classifications;
      try {
        classifications = await classifyAll(inspection.items, {
          useLlm,
          transport: useLlm ? transport : undefined,
          onProgress: (p) => setBusyMsg(t('aiBusy', { done: p.done, total: p.total })),
        });
      } catch (err) {
        llmFailed = true;
        void appLog(`classification fallback: ${err instanceof Error ? err.message : String(err)}`);
        classifications = await classifyAll(inspection.items, { useLlm: false });
      }
      if (abortRef.current) return;
      const packages = buildPackages(inspection.items, classifications);
      const issues = validate(inspection.items, classifications, packages);
      const llmApplied = classifications.some((c) => c.source === 'llm' && c.packageCode !== 'WP-99');
      setData({
        inspection,
        packages,
        issues,
        llmUsed: useLlm && !llmFailed && llmApplied,
        llmFailed: useLlm && llmFailed,
        fileName: file.name,
        bytes,
        startedAt,
      });
      setView('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setView('idle');
    }
  }, [t, boot, modelSlug]);

  async function generate() {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setError(null);
    try {
      if (!data) return;
      setView('busy');
      setBusyMsg(t('generatingShort'));
      let reservation: RevisionReservation | null = null;
      try {
        reservation = await reserveRevision(data.inspection.projectName);
        const outputArabic = data.inspection.language === 'ar' || (data.inspection.language === 'mixed' && /[\u0600-\u06ff]/.test(data.inspection.projectName));
        setBusyMsg(t('generatingBundle', { revision: reservation.revisionLabel }));
        const generated = await generateInWorker({
          packages: data.packages,
          items: data.inspection.items,
          projectName: reservation.projectName,
          revision: reservation.revision,
          locale: outputArabic ? 'ar' : 'en',
          documentLanguage: data.inspection.language,
        });
        const published = await writeRevisionBundle(reservation, generated);
        try {
          await recordRun({
            startedAt: new Date(data.startedAt).toISOString(),
            fileName: data.fileName,
            fileHash: await sha256Hex(data.bytes),
            itemCount: data.inspection.items.length,
            packageCount: data.packages.length,
            errorCount: data.issues.filter((i) => i.severity === 'error').length,
            warningCount: data.issues.filter((i) => i.severity === 'warning').length,
            outputFile: published.masterPath,
            durationMs: Date.now() - data.startedAt,
            llmUsed: data.llmUsed,
            projectName: published.projectName,
            revision: published.revision,
            packageFolder: published.packageFolder,
            sourceKind: data.inspection.sourceKind,
            ocrUsed: data.inspection.ocrPages > 0,
          });
        } catch (recordErr) {
          void appLog(`recordRun failed (non-fatal): ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`);
        }
        setOutput(published);
        setView('done');
        void openWorkbook(published.masterPath).catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
        });
      } catch (err) {
        if (reservation) void discardRevision(reservation).catch(() => undefined);
        setError(err instanceof Error ? err.message : String(err));
        setView('review');
      }
    } finally {
      generatingRef.current = false;
    }
  }

  const reset = () => {
    abortRef.current = true;
    setData(null);
    setOutput(null);
    setError(null);
    setView('idle');
  };

  return (
    <div className="app-frame relative">
      <DotPattern className="text-zinc-400/20 [mask-image:radial-gradient(ellipse_at_center,black_15%,transparent_78%)] dark:text-white/[0.045]" />
      <TitleBar
        onSettings={() => setSettingsOpen(true)}
        onHistory={() => setHistoryOpen(true)}
        onAbout={() => setAboutOpen(true)}
        updateAvailable={update.status === 'available'}
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
              {error && <Text size="xs" c="red" ta="center" maw={390} role="alert">{error}</Text>}
            </BlurFade>
          )}

          {view === 'busy' && (
            <BlurFade key="busy" className="flex h-full flex-col items-center justify-center gap-2 px-8">
              <div role="status" aria-live="polite">
                <AnimatedShinyText className="text-xl">{busyMsg}</AnimatedShinyText>
              </div>
            </BlurFade>
          )}

          {view === 'review' && data && (
            <BlurFade key="review" className="h-full pt-1">
              <ReviewPanel
                data={data}
                busy={generatingRef.current}
                hasErrors={data.issues.some((i) => i.severity === 'error')}
                onGenerate={generate}
                onReset={reset}
              />
            </BlurFade>
          )}

          {view === 'done' && (
            <BlurFade key="done" className="flex h-full flex-col items-center justify-center gap-3 px-8">
              <FileSpreadsheet className="h-12 w-12 text-amber-500 drop-shadow-[0_8px_20px_rgba(232,181,74,0.24)]" strokeWidth={1.35} />
              <Text fw={650}>{t('doneTitle')}</Text>
              <Text size="sm" fw={600}>{output?.projectName} · {output?.revisionLabel}</Text>
              <Text size="xs" c="dimmed" ta="center" maw={430} style={{ wordBreak: 'break-all' }}>{output?.masterPath}</Text>
              {error && <Text size="xs" c="red" ta="center" maw={400} role="alert">{error}</Text>}
              <Group gap="xs">
                <Tooltip label={t('openWorkbookDetail')} openDelay={180}>
                  <Button
                    size="xs"
                    leftSection={<FileSpreadsheet size={13} />}
                    onClick={() => output && openWorkbook(output.masterPath).catch(() => undefined)}
                    styles={{ root: { background: '#1a1408', color: '#f5d58a', fontWeight: 600 } }}
                  >
                    {t('openWorkbook')}
                  </Button>
                </Tooltip>
                <Tooltip label={t('openPackagesDetail')} openDelay={180}>
                  <Button size="xs" variant="subtle" color="gray" leftSection={<FolderOpen size={13} />} onClick={() => output && openGeneratedFolder(output.packageFolder).catch(() => undefined)}>
                    {t('openPackages')}
                  </Button>
                </Tooltip>
                <Button size="xs" variant="subtle" color="gray" onClick={reset}>{t('newFile')}</Button>
              </Group>
            </BlurFade>
          )}
        </AnimatePresence>
      </main>

      <Modal
        opened={settingsOpen}
        onClose={() => { setSettingsOpen(false); refreshConfiguration(); }}
        title={t('settings')}
        centered
        size="sm"
      >
        <SettingsModal
          dataDir={boot?.data_dir ?? ''}
          hasKey={!!boot?.has_api_key}
          onOpenAbout={() => { setSettingsOpen(false); setAboutOpen(true); }}
        />
      </Modal>
      <Modal opened={aboutOpen} onClose={() => setAboutOpen(false)} centered size="md" withCloseButton={false}>
        <AboutModal
          version={boot?.version ?? '0.2.0'}
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
      >
        <HistoryDrawer opened={historyOpen} />
      </Drawer>
    </div>
  );
}
