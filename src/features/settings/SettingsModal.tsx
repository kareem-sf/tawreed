import { Info, PlayCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
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

const TAB_LIST = 'w-full';

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
      <p className="text-[13px] leading-relaxed text-muted-foreground">{t('settingsSimpleDetail')}</p>

      <Tabs defaultValue="general">
        <TabsList className={TAB_LIST}>
          <TabsTrigger value="general">
            {t('settingsTabGeneral')}
          </TabsTrigger>
          <TabsTrigger value="connection">
            {t('connection')}
          </TabsTrigger>
        </TabsList>
        {/*
          forceMount keeps every panel mounted so half-typed keys and
          in-flight provider status survive tab switches; inactive panels
          stay hidden via data-state.
        */}
        <TabsContent value="general" forceMount className="mt-5 data-[state=inactive]:hidden">
          <GeneralPreferences />
        </TabsContent>
        <TabsContent value="connection" forceMount className="mt-5 data-[state=inactive]:hidden">
          <p className="mb-3 text-[13px] leading-relaxed text-muted-foreground">{t('connectionDetail')}</p>
          <ProviderSetup
            hasKey={hasKey}
            hasCompatibleKey={hasCompatibleKey}
            hasGeminiKey={hasGeminiKey}
            hasGrokKey={hasGrokKey}
            onConfigured={onProviderChanged}
          />
        </TabsContent>
      </Tabs>

      <div className="flex items-center gap-4 pt-1">
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0"
          onClick={onRunOnboarding}
        >
          <PlayCircle size={14} aria-hidden="true" />
          {t('viewGuide')}
        </Button>
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0"
          onClick={onOpenAbout}
        >
          <Info size={14} aria-hidden="true" />
          {t('about')}
        </Button>
      </div>
    </div>
  );
}
