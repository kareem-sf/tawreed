import { useEffect, useMemo, useState } from 'react';
import { Button, Group, Text } from '@mantine/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Check, ChevronLeft, ChevronRight, Globe2, Minus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isDesktop, setSetting } from '../bridge';
import Logo from './Logo';
import { ProviderSetup } from './SettingsModal';

type OnboardingStep = 'language' | 'video' | 'connection';

interface Props {
  initialStep: OnboardingStep;
  required: boolean;
  hasKey: boolean;
  hasCompatibleKey: boolean;
  onComplete: () => void;
  onClose: () => void;
}

const stepOrder: OnboardingStep[] = ['language', 'video', 'connection'];

export default function Onboarding({
  initialStep,
  required,
  hasKey,
  hasCompatibleKey,
  onComplete,
  onClose,
}: Props) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const [finishing, setFinishing] = useState(false);
  const appWindow = useMemo(() => (isDesktop() ? getCurrentWindow() : null), []);
  const ar = i18n.language === 'ar';
  const index = stepOrder.indexOf(step);

  useEffect(() => {
    setStep(initialStep);
  }, [initialStep]);

  const persistStep = async (next: OnboardingStep | 'complete') => {
    await setSetting('onboarding', { version: 1, step: next });
    if (next !== 'complete') setStep(next);
  };

  const chooseLanguage = async (language: 'en' | 'ar') => {
    await i18n.changeLanguage(language);
    await setSetting('language', language);
    await persistStep('video');
  };

  const finish = async (offline = false) => {
    setFinishing(true);
    try {
      if (offline) await setSetting('processingMode', 'offline');
      await persistStep('complete');
      onComplete();
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-white text-zinc-950 dark:bg-zinc-950 dark:text-white">
      <header className="flex h-10 shrink-0 items-center justify-between px-4" data-tauri-drag-region>
        <div className="flex items-center gap-2" data-tauri-drag-region>
          <Logo size={18} />
          <span className="text-xs font-semibold">Tawreed</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            className="titlebar-btn"
            onClick={() => void appWindow?.minimize().catch(() => undefined)}
            aria-label={t('minimize')}
          >
            <Minus size={14} />
          </button>
          <button
            className="titlebar-btn close"
            onClick={() => void appWindow?.close().catch(() => undefined)}
            aria-label={t('close')}
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-8 pb-7 pt-4">
        <div className="mx-auto max-w-2xl">
          {!required && (
            <div className="mb-2 flex justify-end">
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                leftSection={<X size={12} />}
                onClick={onClose}
              >
                {t('close')}
              </Button>
            </div>
          )}
          <div className="mb-8 flex items-center justify-center gap-2" aria-label={t('setupProgress')}>
            {stepOrder.map((item, itemIndex) => (
              <span
                key={item}
                className={`h-1.5 rounded-full transition-all ${
                  itemIndex === index
                    ? 'w-9 bg-amber-500'
                    : itemIndex < index
                      ? 'w-5 bg-zinc-400'
                      : 'w-5 bg-zinc-200 dark:bg-zinc-800'
                }`}
              />
            ))}
          </div>

          {step === 'language' && (
            <section className="mx-auto max-w-lg text-center">
              <Globe2 className="mx-auto size-8 text-amber-500" />
              <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">
                Choose your language
              </h1>
              <p className="mt-2 text-sm text-zinc-500">اختر لغة التطبيق</p>
              <div className="mt-8 grid grid-cols-2 gap-3">
                <button
                  className="rounded-2xl border border-zinc-200 p-6 text-start transition hover:border-amber-500 hover:bg-amber-50/60 dark:border-white/10 dark:hover:bg-amber-500/10"
                  onClick={() => void chooseLanguage('en')}
                >
                  <div className="text-lg font-semibold">English</div>
                  <div className="mt-1 text-xs text-zinc-500">Continue in English</div>
                </button>
                <button
                  dir="rtl"
                  className="rounded-2xl border border-zinc-200 p-6 text-start transition hover:border-amber-500 hover:bg-amber-50/60 dark:border-white/10 dark:hover:bg-amber-500/10"
                  onClick={() => void chooseLanguage('ar')}
                >
                  <div className="text-lg font-semibold">العربية</div>
                  <div className="mt-1 text-xs text-zinc-500">المتابعة باللغة العربية</div>
                </button>
              </div>
            </section>
          )}

          {step === 'video' && (
            <section>
              <div className="text-center">
                <h1 className="text-xl font-semibold tracking-[-0.02em]">{t('tourTitle')}</h1>
                <Text size="sm" c="dimmed" mt={5}>{t('tourDetail')}</Text>
              </div>
              <div className="mt-5 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-950 shadow-sm dark:border-white/10">
                <video
                  key={ar ? 'ar' : 'en'}
                  className="aspect-video w-full"
                  controls
                  autoPlay
                  preload="auto"
                  poster={`/onboarding/tawreed-tour-${ar ? 'ar' : 'en'}-poster.jpg`}
                >
                  <source
                    src={`/onboarding/tawreed-tour-${ar ? 'ar' : 'en'}.mp4`}
                    type="video/mp4"
                  />
                  <track
                    default
                    kind="captions"
                    srcLang={ar ? 'ar' : 'en'}
                    src={`/onboarding/tawreed-tour-${ar ? 'ar' : 'en'}.vtt`}
                  />
                </video>
              </div>
              <Group justify="space-between" mt="lg">
                <Button
                  variant="subtle"
                  color="gray"
                  leftSection={<ChevronLeft size={14} className="rtl:rotate-180" />}
                  onClick={() => void persistStep('language')}
                >
                  {t('back')}
                </Button>
                <Button
                  color="yellow"
                  rightSection={<ChevronRight size={14} className="rtl:rotate-180" />}
                  onClick={() => void persistStep('connection')}
                >
                  {t('continue')}
                </Button>
              </Group>
            </section>
          )}

          {step === 'connection' && (
            <section>
              <div className="text-center">
                <h1 className="text-xl font-semibold tracking-[-0.02em]">{t('connectTitle')}</h1>
                <Text size="sm" c="dimmed" mt={5}>{t('connectDetail')}</Text>
              </div>
              <div className="mt-6">
                <ProviderSetup
                  hasKey={hasKey}
                  hasCompatibleKey={hasCompatibleKey}
                />
              </div>
              <Group justify="space-between" mt="xl">
                <Button
                  variant="subtle"
                  color="gray"
                  leftSection={<ChevronLeft size={14} className="rtl:rotate-180" />}
                  onClick={() => void persistStep('video')}
                >
                  {t('back')}
                </Button>
                <Group gap="xs">
                  <Button
                    variant="subtle"
                    color="gray"
                    leftSection={<Check size={14} />}
                    loading={finishing}
                    onClick={() => void finish(true)}
                  >
                    {t('useOffline')}
                  </Button>
                  <Button
                    color="yellow"
                    loading={finishing}
                    onClick={() => void finish(false)}
                  >
                    {t('finishSetup')}
                  </Button>
                </Group>
              </Group>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
