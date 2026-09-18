import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Globe2, Loader2, Minus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { setSetting } from '../../bridge';
import { currentDesktopWindow } from '../../platform/desktop/window';
import { Button } from '../../components/ui/button';
import Logo from '../../components/Logo';
import { ProviderSetup } from '../settings/ProviderSetup';
import LiveDemo from './LiveDemo';

type OnboardingStep = 'language' | 'video' | 'connection';

interface Props {
  initialStep: OnboardingStep;
  required: boolean;
  hasKey: boolean;
  hasCompatibleKey: boolean;
  hasGeminiKey: boolean;
  hasGrokKey: boolean;
  onComplete: () => void;
  onClose: () => void;
}

const stepOrder: OnboardingStep[] = ['language', 'video', 'connection'];

export default function Onboarding({
  initialStep,
  required,
  hasKey,
  hasCompatibleKey,
  hasGeminiKey,
  hasGrokKey,
  onComplete,
  onClose,
}: Props) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const [finishing, setFinishing] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const appWindow = useMemo(() => currentDesktopWindow(), []);
  const ar = i18n.language === 'ar';
  const index = stepOrder.indexOf(step);

  useEffect(() => {
    // Deliberate prop-to-state sync: reopening onboarding at a different step must
    // move the wizard, and the dependency limits it to an actual prop change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStep(initialStep);
  }, [initialStep]);

  const persistStep = async (next: OnboardingStep | 'complete') => {
    try {
      await setSetting('onboarding', { version: 1, step: next });
    } catch (reason) {
      setStepError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    }
    if (next !== 'complete') setStep(next);
  };

  const chooseLanguage = async (language: 'en' | 'ar') => {
    const previous = i18n.language;
    try {
      setStepError(null);
      await i18n.changeLanguage(language);
      await setSetting('language', language);
      await persistStep('video');
    } catch (reason) {
      await i18n.changeLanguage(previous).catch(() => undefined);
      setStepError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const finish = async (offline = false) => {
    setFinishing(true);
    try {
      setStepError(null);
      if (offline) await setSetting('processingMode', 'offline');
      await persistStep('complete');
      onComplete();
    } catch (reason) {
      setStepError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-ledger-bg text-ledger-ink">
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
              <Button size="sm" variant="ghost" onClick={onClose}>
                <X size={12} aria-hidden="true" />
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
                    ? 'w-9 bg-gold'
                    : itemIndex < index
                      ? 'w-5 bg-ledger-ink-dim'
                      : 'w-5 bg-ledger-surface-2'
                }`}
              />
            ))}
          </div>

          {step === 'language' && (
            <section className="mx-auto max-w-lg text-center">
              <Globe2 className="mx-auto size-9 text-gold" strokeWidth={1.5} />
              <h1 className="font-serif-display mt-6 text-2xl font-semibold tracking-[-0.01em]">
                {t('onboardingLanguageTitle')}
              </h1>
              <p className="mt-2 text-sm text-ledger-ink-faint">اختر لغة التطبيق</p>
              <div className="mt-8 grid grid-cols-2 gap-3">
                <button
                  className="group rounded-2xl border border-ledger-line p-6 text-start shadow-sm transition hover:-translate-y-0.5 hover:border-gold-deep hover:bg-gold/8 hover:shadow-md"
                  onClick={() => void chooseLanguage('en')}
                >
                  <div className="text-lg font-semibold transition group-hover:text-gold-deep dark:group-hover:text-gold">
                    English
                  </div>
                  <div className="mt-1 text-xs text-ledger-ink-faint">Continue in English</div>
                </button>
                <button
                  dir="rtl"
                  className="group rounded-2xl border border-ledger-line p-6 text-start shadow-sm transition hover:-translate-y-0.5 hover:border-gold-deep hover:bg-gold/8 hover:shadow-md"
                  onClick={() => void chooseLanguage('ar')}
                >
                  <div className="text-lg font-semibold transition group-hover:text-gold-deep dark:group-hover:text-gold">
                    العربية
                  </div>
                  <div className="mt-1 text-xs text-ledger-ink-faint">المتابعة باللغة العربية</div>
                </button>
              </div>
            </section>
          )}

          {step === 'video' && (
            <section>
              <div className="text-center">
                <h1 className="text-xl font-semibold tracking-[-0.02em]">{t('tourTitle')}</h1>
                <p className="mt-[5px] text-sm text-ledger-ink-dim">{t('tourDetail')}</p>
              </div>
              <LiveDemo lang={ar ? 'ar' : 'en'} />
              <div className="mt-5 flex items-center justify-between">
                <Button
                  variant="ghost"
                  onClick={() => void persistStep('language').catch(() => undefined)}
                >
                  <ChevronLeft size={14} className="rtl:rotate-180" aria-hidden="true" />
                  {t('back')}
                </Button>
                <Button
                  variant="default"
                  onClick={() => void persistStep('connection').catch(() => undefined)}
                >
                  {t('continue')}
                  <ChevronRight size={14} className="rtl:rotate-180" aria-hidden="true" />
                </Button>
              </div>
            </section>
          )}

          {step === 'connection' && (
            <section>
              <div className="text-center">
                <h1 className="text-xl font-semibold tracking-[-0.02em]">{t('connectTitle')}</h1>
                <p className="mt-[5px] text-sm text-ledger-ink-dim">{t('connectDetail')}</p>
              </div>
              <div className="mt-6">
                <ProviderSetup
                  hasKey={hasKey}
                  hasCompatibleKey={hasCompatibleKey}
                  hasGeminiKey={hasGeminiKey}
                  hasGrokKey={hasGrokKey}
                />
              </div>
              <div className="mt-8 flex items-center justify-between">
                <Button
                  variant="ghost"
                  onClick={() => void persistStep('video').catch(() => undefined)}
                >
                  <ChevronLeft size={14} className="rtl:rotate-180" aria-hidden="true" />
                  {t('back')}
                </Button>
                <div className="flex items-center gap-2.5">
                  <Button
                    variant="ghost"
                    disabled={finishing}
                    onClick={() => void finish(true)}
                  >
                    {finishing
                      ? <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />
                      : <Check size={14} aria-hidden="true" />}
                    {t('useOffline')}
                  </Button>
                  <Button
                    disabled={finishing}
                    onClick={() => void finish(false)}
                  >
                    {finishing && <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />}
                    {t('finishSetup')}
                  </Button>
                </div>
              </div>
            </section>
          )}
          {stepError && (
            <p role="alert" className="allow-select mt-4 text-center text-xs text-ledger-danger">
              {stepError}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
