import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BootstrapInfo } from '../../bridge';
import { WorkflowWorkspace } from '../workflow/components/WorkflowWorkspace';
import { useLiveDemo } from './useLiveDemo';

const DEMO_BOOT: BootstrapInfo = {
  first_run: false,
  onboarding_required: false,
  onboarding_step: 'complete',
  data_dir: '',
  has_api_key: false,
  has_compatible_key: false,
  has_gemini_key: false,
  has_grok_key: false,
  run_count: 0,
  version: 'demo',
  provider: 'none',
  provider_preference: 'codex',
  codex_installed: false,
  codex_authenticated: false,
};

const noop = () => undefined;

export default function LiveDemo({ lang }: { lang: 'en' | 'ar' }) {
  const { t } = useTranslation();
  const [runId, setRunId] = useState(0);
  const [caption, setCaption] = useState('');
  const state = useLiveDemo(true, runId);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setCaption('');
    void audio.play().catch(() => undefined);

    const track = audio.textTracks[0];
    if (!track) return;
    track.mode = 'hidden';
    const onCueChange = () => {
      const active = track.activeCues?.[0] as VTTCue | undefined;
      setCaption(active?.text ?? '');
    };
    track.addEventListener('cuechange', onCueChange);
    return () => track.removeEventListener('cuechange', onCueChange);
  }, [runId]);

  return (
    <div className="mt-5">
      <div className="relative overflow-hidden rounded-2xl border bg-card">
        <div className="flex h-8 items-center gap-1.5 border-b px-3">
          <span className="size-2.5 rounded-full bg-muted" />
          <span className="size-2.5 rounded-full bg-muted" />
          <span className="size-2.5 rounded-full bg-muted" />
          <span className="ms-2 text-[11px] font-medium text-muted-foreground">{t('demoFrameTitle')}</span>
        </div>
        <div className="pointer-events-none flex h-[380px] w-full flex-col overflow-hidden">
          <WorkflowWorkspace
            boot={DEMO_BOOT}
            state={state}
            onFile={noop}
            onConsent={noop}
            onCancel={noop}
            onGenerate={noop}
            onReset={noop}
            onClassificationChange={noop}
          />
        </div>
        {caption && (
          <div className="absolute inset-x-3 bottom-3 text-center text-xs font-medium text-muted-foreground">
            {caption}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {t('demoCaption')}
        </p>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => setRunId((value) => value + 1)}
        >
          <RotateCcw size={12} />
          {t('demoReplay')}
        </button>
      </div>

      <audio ref={audioRef} key={lang} src={`/onboarding/tawreed-tour-${lang}.mp3`}>
        <track
          default
          kind="captions"
          srcLang={lang}
          src={`/onboarding/tawreed-tour-${lang}.vtt`}
        />
      </audio>
    </div>
  );
}
