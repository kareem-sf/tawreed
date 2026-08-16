import { Drawer, Modal } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { openUpdateRelease, type BootstrapInfo } from '../bridge';
import AboutModal from '../features/about/AboutModal';
import HistoryDrawer from '../features/history/HistoryDrawer';
import SettingsModal from '../features/settings/SettingsModal';
import type { AppDialog, UpdateState } from './types';

interface Props {
  active: AppDialog;
  boot: BootstrapInfo;
  update: UpdateState;
  onChange: (dialog: AppDialog) => void;
  onSettingsClosed: () => void;
  onRunOnboarding: () => void;
  onCheckUpdate: () => Promise<void>;
}

export function AppDialogs({
  active,
  boot,
  update,
  onChange,
  onSettingsClosed,
  onRunOnboarding,
  onCheckUpdate,
}: Props) {
  const { t, i18n } = useTranslation();

  return (
    <>
      <Modal
        opened={active === 'settings'}
        onClose={() => {
          onChange(null);
          onSettingsClosed();
        }}
        title={t('settings')}
        centered
        size="sm"
        closeButtonProps={{ 'aria-label': t('close') }}
      >
        <SettingsModal
          hasKey={boot.has_api_key}
          hasCompatibleKey={boot.has_compatible_key}
          onOpenAbout={() => onChange('about')}
          onRunOnboarding={() => {
            onChange(null);
            onRunOnboarding();
          }}
        />
      </Modal>

      <Modal
        opened={active === 'about'}
        onClose={() => onChange(null)}
        centered
        size="md"
        withCloseButton={false}
      >
        <AboutModal
          version={boot.version}
          update={update}
          onCheckUpdate={onCheckUpdate}
          onOpenUpdate={openUpdateRelease}
          onClose={() => onChange(null)}
        />
      </Modal>

      <Drawer
        opened={active === 'history'}
        onClose={() => onChange(null)}
        title={t('history')}
        position={i18n.language === 'ar' ? 'left' : 'right'}
        size={560}
        closeButtonProps={{ 'aria-label': t('close') }}
      >
        <HistoryDrawer opened={active === 'history'} />
      </Drawer>
    </>
  );
}
