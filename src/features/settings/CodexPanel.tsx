import { Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/button';
import { ModelSelect } from './ModelSelect';
import type { useProviderSetup } from './useProviderSetup';

type Setup = ReturnType<typeof useProviderSetup>;

/** Codex sign-in panel: status, install/login actions, model choice when signed in. */
export function CodexPanel({ setup }: { setup: Setup }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {setup.codex?.authenticated
              ? t('connectionReady')
              : setup.codex?.installed
                ? t('signInRequired')
                : t('codexNotDetected')}
          </p>
          {setup.codex?.source && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {setup.codex.version} · {setup.codex.source}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label={t('refreshCodex')}
            onClick={() => void setup.refreshCodex()}
          >
            <RefreshCw size={12} aria-hidden="true" />
          </Button>
          {!setup.codex?.installed && (
            <Button
              size="sm"
              variant="default"
              disabled={setup.working === 'codex-install'}
              onClick={() => void setup.installCodex()}
            >
              {setup.working === 'codex-install'
                && <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />}
              {t('codexInstall')}
            </Button>
          )}
          {setup.codex?.installed && !setup.codex.authenticated && (
            <Button
              size="sm"
              variant="default"
              disabled={setup.working === 'codex-login'}
              onClick={() => void setup.loginCodex()}
            >
              {setup.working === 'codex-login'
                && <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />}
              {t('codexLogin')}
            </Button>
          )}
        </div>
      </div>
      {setup.codex?.authenticated && (
        <div className="mt-3">
          <ModelSelect
            label={t('modelChoice')}
            placeholder={t('modelPlaceholder')}
            options={setup.models.map((item) => ({
              value: item.slug,
              label: item.display_name || item.slug,
            }))}
            value={setup.model}
            onChange={setup.chooseModel}
          />
        </div>
      )}
    </div>
  );
}
