import { useEffect, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSettings, setSetting } from '../../bridge';
import { useColorScheme, type ColorSchemeSetting } from '../../app/useColorScheme';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import type { ProcessingMode } from '../workflow/useBoqWorkflow';

const SEGMENT_LIST = 'grid w-full border border-ledger-line p-0.5';
const SEGMENT_TRIGGER = 'text-xs data-[state=active]:shadow-sm';

export function GeneralPreferences() {
  const { t, i18n } = useTranslation();
  const { setting: themeSetting, applySetting } = useColorScheme();
  const [processingMode, setProcessingMode] = useState<ProcessingMode>('ask');
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    void getSettings()
      .then((settings) => {
        const value = settings.processingMode;
        if (value === 'ask' || value === 'online' || value === 'offline') {
          setProcessingMode(value);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const changeLanguage = async (language: string) => {
    const previous = i18n.language;
    try {
      setSaveError(null);
      await i18n.changeLanguage(language);
      await setSetting('language', language);
    } catch {
      await i18n.changeLanguage(previous).catch(() => undefined);
      setSaveError(t('errorGeneric'));
    }
  };

  const changeTheme = (value: string) => {
    const scheme = value as ColorSchemeSetting;
    const previous = themeSetting;
    applySetting(scheme);
    setSaveError(null);
    void setSetting('theme', scheme).catch(() => {
      applySetting(previous);
      setSaveError(t('errorGeneric'));
    });
  };

  return (
    <div className="space-y-5">
      <section>
        <p className="mb-1.5 text-xs font-semibold text-ledger-ink">{t('language')}</p>
        <Tabs value={i18n.language === 'ar' ? 'ar' : 'en'} onValueChange={(value) => void changeLanguage(value)}>
          <TabsList className={`${SEGMENT_LIST} grid-cols-2`}>
            <TabsTrigger value="en" className={SEGMENT_TRIGGER}>English</TabsTrigger>
            <TabsTrigger value="ar" className={SEGMENT_TRIGGER}>العربية</TabsTrigger>
          </TabsList>
        </Tabs>
      </section>

      <section>
        <p className="mb-1.5 text-xs font-semibold text-ledger-ink">{t('appearance')}</p>
        <Tabs value={themeSetting} onValueChange={changeTheme}>
          <TabsList className={`${SEGMENT_LIST} grid-cols-3`}>
            <TabsTrigger value="auto" className={SEGMENT_TRIGGER}>{t('systemTheme')}</TabsTrigger>
            <TabsTrigger value="light" className={SEGMENT_TRIGGER}>{t('lightTheme')}</TabsTrigger>
            <TabsTrigger value="dark" className={SEGMENT_TRIGGER}>{t('darkTheme')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </section>

      <section>
        <p className="text-xs font-semibold text-ledger-ink">{t('processingChoice')}</p>
        <p className="mb-1.5 mt-0.5 text-xs text-ledger-ink-dim">{t('processingChoiceDetail')}</p>
        {loading ? (
          <Loader2 size={16} className="text-gold-deep motion-safe:animate-spin dark:text-gold" aria-hidden="true" />
        ) : (
          <div className="relative">
            <select
              aria-label={t('processingChoice')}
              value={processingMode}
              onChange={(event) => {
                const next = event.currentTarget.value as ProcessingMode;
                const previous = processingMode;
                setProcessingMode(next);
                setSaveError(null);
                void setSetting('processingMode', next).catch(() => {
                  setProcessingMode(previous);
                  setSaveError(t('errorGeneric'));
                });
              }}
              className="h-9 w-full appearance-none rounded-md border border-input bg-background pe-8 ps-3 text-sm text-ledger-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="ask">{t('askEveryFile')}</option>
              <option value="online">{t('alwaysImproveOnline')}</option>
              <option value="offline">{t('alwaysOffline')}</option>
            </select>
            <ChevronDown
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-ledger-ink-faint"
            />
          </div>
        )}
        {saveError && (
          <p role="alert" className="mt-1 text-xs text-ledger-danger">{saveError}</p>
        )}
      </section>
    </div>
  );
}
