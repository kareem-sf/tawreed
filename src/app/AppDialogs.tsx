import { useTranslation } from 'react-i18next';
import { openUpdateRelease, type BootstrapInfo } from '../bridge';
import { DialogShell } from '../components/DialogShell';
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
  onProviderChanged: () => void;
  onRunOnboarding: () => void;
  onCheckUpdate: () => Promise<void>;
}

export function AppDialogs({
  active,
  boot,
  update,
  onChange,
  onSettingsClosed,
  onProviderChanged,
  onRunOnboarding,
  onCheckUpdate,
}: Props) {
  const { t, i18n } = useTranslation();

  return (
    <>
      <DialogShell
        open={active === 'settings'}
        onClose={() => {
          onChange(null);
          onSettingsClosed();
        }}
        title={t('settings')}
        closeLabel={t('close')}
        contentClassName="max-w-md"
      >
        <SettingsModal
          hasKey={boot.has_api_key}
          hasCompatibleKey={boot.has_compatible_key}
          hasGeminiKey={boot.has_gemini_key}
          hasGrokKey={boot.has_grok_key}
          onProviderChanged={onProviderChanged}
          onOpenAbout={() => onChange('about')}
          onRunOnboarding={() => {
            onChange(null);
            onRunOnboarding();
          }}
        />
      </DialogShell>

      <DialogShell
        open={active === 'about'}
        onClose={() => onChange(null)}
        contentClassName="max-w-md"
      >
        <AboutModal
          version={boot.version}
          update={update}
          onCheckUpdate={onCheckUpdate}
          onOpenUpdate={openUpdateRelease}
          onClose={() => onChange(null)}
        />
      </DialogShell>

      <DialogShell
        open={active === 'history'}
        onClose={() => onChange(null)}
        title={t('history')}
        closeLabel={t('close')}
        side={i18n.language === 'ar' ? 'left' : 'right'}
      >
        <HistoryDrawer opened={active === 'history'} />
      </DialogShell>
    </>
  );
}
