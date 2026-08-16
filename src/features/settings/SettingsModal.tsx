import { Button, Stack, Text } from '@mantine/core';
import { HardDrive, PlayCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GeneralPreferences } from './GeneralPreferences';
import { ProviderSetup } from './ProviderSetup';

interface Props {
  hasKey: boolean;
  hasCompatibleKey: boolean;
  onOpenAbout: () => void;
  onRunOnboarding: () => void;
}

export default function SettingsModal({
  hasKey,
  hasCompatibleKey,
  onOpenAbout,
  onRunOnboarding,
}: Props) {
  const { t } = useTranslation();

  return (
    <Stack gap="lg">
      <Text size="xs" c="dimmed">{t('settingsSimpleDetail')}</Text>

      <GeneralPreferences />

      <section>
        <Text size="xs" fw={650}>{t('connection')}</Text>
        <Text size="xs" c="dimmed" mt={2} mb={8}>{t('connectionDetail')}</Text>
        <ProviderSetup hasKey={hasKey} hasCompatibleKey={hasCompatibleKey} />
      </section>

      <div className="grid grid-cols-2 gap-2 border-t border-zinc-200 pt-4 dark:border-white/10">
        <Button
          variant="light"
          color="gray"
          leftSection={<PlayCircle size={14} aria-hidden="true" />}
          onClick={onRunOnboarding}
        >
          {t('viewGuide')}
        </Button>
        <Button
          variant="light"
          color="gray"
          leftSection={<HardDrive size={14} aria-hidden="true" />}
          onClick={onOpenAbout}
        >
          {t('about')}
        </Button>
      </div>
    </Stack>
  );
}
