import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSettings, setSetting } from '../../bridge';
import { useColorScheme, type ColorSchemeSetting } from '../../app/useColorScheme';
import { Field, FieldDescription, FieldLabel } from '../../components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import type { ProcessingMode } from '../workflow/useBoqWorkflow';

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
    <div className="divide-y divide-border rounded-xl border bg-card px-4">
      <section className="py-3">
        <p className="mb-2 text-[13px] font-semibold text-foreground">{t('language')}</p>
        <Tabs value={i18n.language === 'ar' ? 'ar' : 'en'} onValueChange={(value) => void changeLanguage(value)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="en">English</TabsTrigger>
            <TabsTrigger value="ar">العربية</TabsTrigger>
          </TabsList>
        </Tabs>
      </section>

      <section className="py-3">
        <p className="mb-2 text-[13px] font-semibold text-foreground">{t('appearance')}</p>
        <Tabs value={themeSetting} onValueChange={changeTheme}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="auto">{t('systemTheme')}</TabsTrigger>
            <TabsTrigger value="light">{t('lightTheme')}</TabsTrigger>
            <TabsTrigger value="dark">{t('darkTheme')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </section>

      <section className="py-3">
        <Field>
          <FieldLabel htmlFor="processing-mode">{t('processingChoice')}</FieldLabel>
          {loading ? (
            <Loader2 size={16} className="text-primary motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <Select
              value={processingMode}
              onValueChange={(value) => {
                const next = value as ProcessingMode;
                const previous = processingMode;
                setProcessingMode(next);
                setSaveError(null);
                void setSetting('processingMode', next).catch(() => {
                  setProcessingMode(previous);
                  setSaveError(t('errorGeneric'));
                });
              }}
            >
              <SelectTrigger id="processing-mode" aria-label={t('processingChoice')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ask">{t('askEveryFile')}</SelectItem>
                <SelectItem value="online">{t('alwaysImproveOnline')}</SelectItem>
                <SelectItem value="offline">{t('alwaysOffline')}</SelectItem>
              </SelectContent>
            </Select>
          )}
          <FieldDescription className="text-xs">{t('processingChoiceDetail')}</FieldDescription>
        </Field>
        {saveError && (
          <p role="alert" className="mt-1 text-xs text-destructive">{saveError}</p>
        )}
      </section>
    </div>
  );
}
