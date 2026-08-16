import { useEffect, useState } from 'react';
import { Loader, SegmentedControl, Select, Text, useMantineColorScheme } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { getSettings, setSetting } from '../../bridge';
import type { ProcessingMode } from '../workflow/useBoqWorkflow';

export function GeneralPreferences() {
  const { t, i18n } = useTranslation();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const [processingMode, setProcessingMode] = useState<ProcessingMode>('ask');
  const [loading, setLoading] = useState(true);

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
    await i18n.changeLanguage(language);
    await setSetting('language', language);
  };

  return (
    <div className="space-y-5">
      <section>
        <Text size="xs" fw={650} mb={6}>{t('language')}</Text>
        <SegmentedControl
          fullWidth
          size="xs"
          value={i18n.language === 'ar' ? 'ar' : 'en'}
          onChange={(value) => void changeLanguage(value)}
          data={[
            { value: 'en', label: 'English' },
            { value: 'ar', label: 'العربية' },
          ]}
        />
      </section>

      <section>
        <Text size="xs" fw={650} mb={6}>{t('appearance')}</Text>
        <SegmentedControl
          fullWidth
          size="xs"
          value={colorScheme}
          onChange={(value) => {
            const scheme = value as 'auto' | 'light' | 'dark';
            setColorScheme(scheme);
            void setSetting('theme', scheme);
          }}
          data={[
            { value: 'auto', label: t('systemTheme') },
            { value: 'light', label: t('lightTheme') },
            { value: 'dark', label: t('darkTheme') },
          ]}
        />
      </section>

      <section>
        <Text size="xs" fw={650}>{t('processingChoice')}</Text>
        <Text size="xs" c="dimmed" mt={2} mb={7}>{t('processingChoiceDetail')}</Text>
        {loading ? (
          <Loader size={16} color="yellow" />
        ) : (
          <Select
            size="xs"
            value={processingMode}
            allowDeselect={false}
            data={[
              { value: 'ask', label: t('askEveryFile') },
              { value: 'online', label: t('alwaysImproveOnline') },
              { value: 'offline', label: t('alwaysOffline') },
            ]}
            onChange={(value) => {
              const next = (value ?? 'ask') as ProcessingMode;
              setProcessingMode(next);
              void setSetting('processingMode', next);
            }}
          />
        )}
      </section>
    </div>
  );
}
