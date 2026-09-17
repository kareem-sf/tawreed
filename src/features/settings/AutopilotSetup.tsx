import { useEffect, useState } from 'react';
import { X, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '../../components/ui/empty';
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from '../../components/ui/item';
import { getAutopilotTrust, setAutopilotTrust, type AutopilotGrant } from '../../bridge';

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Per-project auto-pilot grants: enable here is read-only, revoke is the action.
 * Grants are created from history rows (where the project name is known). */
export function AutopilotSetup() {
  const { t } = useTranslation();
  const [grants, setGrants] = useState<AutopilotGrant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<AutopilotGrant | null>(null);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getAutopilotTrust()
      .then((loaded) => { if (!cancelled) setGrants(loaded); })
      .catch((reason) => { if (!cancelled) setError(errorMessage(reason)); });
    return () => { cancelled = true; };
  }, []);

  const revoke = async (projectKey: string) => {
    const previous = grants;
    const next = previous.filter((grant) => grant.projectKey !== projectKey);
    setPendingRevoke(null);
    setRevoking(true);
    setGrants(next);
    setError(null);
    try {
      await setAutopilotTrust(next);
    } catch (reason) {
      setGrants(previous);
      setError(errorMessage(reason));
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-ledger-ink-dim">{t('autopilotDetail')}</p>
      {grants.length === 0 && (
        <Empty className="py-3">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Zap aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle className="text-xs font-normal text-ledger-ink-dim">{t('autopilotEmpty')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
      {grants.length > 0 && (
        <ItemGroup>
          {grants.map((grant, index) => (
            <div key={grant.projectKey}>
              {index > 0 && <ItemSeparator />}
              <Item size="sm" className="px-3">
                <ItemMedia variant="icon">
                  <Zap aria-hidden="true" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{grant.projectName}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <Tooltip delayDuration={220}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setPendingRevoke(grant)}
                        aria-label={`${t('autopilotRevoke')}: ${grant.projectName}`}
                        className="rounded-md p-1.5 text-ledger-ink-faint transition hover:bg-ledger-surface-2 hover:text-ledger-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{t('autopilotRevoke')}</TooltipContent>
                  </Tooltip>
                </ItemActions>
              </Item>
            </div>
          ))}
        </ItemGroup>
      )}
      <ConfirmDialog
        open={pendingRevoke !== null}
        title={t('confirmRevokeTitle')}
        description={pendingRevoke ? t('confirmRevokeBody', { project: pendingRevoke.projectName }) : undefined}
        confirmLabel={t('autopilotRevoke')}
        cancelLabel={t('cancel')}
        busy={revoking}
        onCancel={() => { if (!revoking) setPendingRevoke(null); }}
        onConfirm={() => { if (pendingRevoke) void revoke(pendingRevoke.projectKey); }}
      />
      {error && (
        <p role="alert" className="text-xs text-ledger-danger">{error}</p>
      )}
    </div>
  );
}
