import { HardDrive, PlayCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { Separator } from '../../components/ui/separator';
import { AutopilotSetup } from './AutopilotSetup';
import { GeneralPreferences } from './GeneralPreferences';
import { ProviderSetup } from './ProviderSetup';

interface Props {
  hasKey: boolean;
  hasCompatibleKey: boolean;
  hasGeminiKey: boolean;
  hasGrokKey: boolean;
  onProviderChanged: () => void;
  onOpenAbout: () => void;
  onRunOnboarding: () => void;
}

export default function SettingsModal({
  hasKey,
  hasCompatibleKey,
  hasGeminiKey,
  hasGrokKey,
  onProviderChanged,
  onOpenAbout,
  onRunOnboarding,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      <p className="text-xs text-ledger-ink-dim">{t('settingsSimpleDetail')}</p>

      <GeneralPreferences />

      <section>
        <p className="text-xs font-semibold text-ledger-ink">{t('autopilotTitle')}</p>
        <div className="mt-2">
          <AutopilotSetup />
        </div>
      </section>

      <section>
        <p className="text-xs font-semibold text-ledger-ink">{t('connection')}</p>
        <p className="mb-2 mt-0.5 text-xs text-ledger-ink-dim">{t('connectionDetail')}</p>
        <ProviderSetup
          hasKey={hasKey}
          hasCompatibleKey={hasCompatibleKey}
          hasGeminiKey={hasGeminiKey}
          hasGrokKey={hasGrokKey}
          onConfigured={onProviderChanged}
        />
      </section>

      <div>
        <Separator />
        <div className="grid grid-cols-2 gap-2 pt-4">
        <Button
          variant="secondary"
          onClick={onRunOnboarding}
        >
          <PlayCircle size={14} aria-hidden="true" />
          {t('viewGuide')}
        </Button>
        <Button
          variant="secondary"
          onClick={onOpenAbout}
        >
          <HardDrive size={14} aria-hidden="true" />
          {t('about')}
        </Button>
        </div>
      </div>
    </div>
  );
}
