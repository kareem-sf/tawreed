import { useEffect, useState } from 'react';
import { Check, ClipboardCopy, FileSpreadsheet, FolderOpen, History, Sparkles, Workflow, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Liquid } from 'liquid-gooey';
import { cn } from '../../lib/utils';
import { Badge } from '../../components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../components/ui/empty';
import { Skeleton } from '../../components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { appLog, getAutopilotTrust, listRuns, openGeneratedFolder, openWorkbook, setAutopilotTrust } from '../../bridge';
import type { RunRecord } from '../../../shared/types';
import { memoryKey } from '../../../engine/agent-workflow';
import { formatRunDate, formatRunForSupport } from './formatRunForSupport';

function RowAction({
  label,
  detail,
  tone = 'muted',
  filled = false,
  liquid = false,
  onClick,
  children,
}: {
  label: string;
  detail: string;
  tone?: 'muted' | 'gold' | 'green';
  filled?: boolean;
  /** Jelly morph on shape change. Experimental — single use (trust toggle). */
  liquid?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'rounded-md p-1.5 transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        filled
          ? 'bg-primary text-primary-foreground'
          : 'text-ledger-ink-faint hover:bg-ledger-surface-2 hover:text-ledger-ink',
        !filled && tone === 'gold' && 'text-gold-deep hover:text-gold-deep dark:text-gold dark:hover:text-gold',
        !filled && tone === 'green' && 'text-emerald-600 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-400',
      )}
    >
      {children}
    </button>
  );
  return (
    <Tooltip delayDuration={180}>
      <TooltipTrigger asChild>
        {liquid ? (
          <Liquid fill="var(--surface-2)">
            <Liquid.Item effect="morph" x={0} y={0}>
              {button}
            </Liquid.Item>
          </Liquid>
        ) : (
          button
        )}
      </TooltipTrigger>
      <TooltipContent>{detail}</TooltipContent>
    </Tooltip>
  );
}

export default function HistoryDrawer({ opened }: { opened: boolean }) {
  const { t, i18n } = useTranslation();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [trustedKeys, setTrustedKeys] = useState<Set<string>>(new Set());
  const [armingKey, setArmingKey] = useState<string | null>(null);

  const copyForSupport = (run: RunRecord) => {
    void navigator.clipboard.writeText(formatRunForSupport(run)).then(() => {
      setCopiedId(run.id ?? null);
      window.setTimeout(() => setCopiedId((current) => (current === (run.id ?? null) ? null : current)), 1500);
    }).catch(() => undefined);
  };

  /** Two-step grant: first click arms (showing the scope), second click grants. */
  const trustProject = async (run: RunRecord) => {
    const displayName = run.projectName || run.fileName;
    const key = memoryKey(displayName);
    if (!key) return;
    if (armingKey !== key) {
      setArmingKey(key);
      return;
    }
    setArmingKey(null);
    setActionError(null);
    try {
      const current = await getAutopilotTrust();
      if (!current.some((grant) => grant.projectKey === key)) {
        await setAutopilotTrust([
          ...current,
          { projectKey: key, projectName: displayName, grantedAt: new Date().toISOString() },
        ]);
      }
      setTrustedKeys((prev) => new Set(prev).add(key));
    } catch {
      setActionError(t('errorGeneric'));
    }
  };

  useEffect(() => {
    if (opened) {
      // Guarded by `opened`, so this runs once per open rather than every render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(true);
      setLoadError(null);
      setArmingKey(null);
      listRuns()
        .then(setRuns)
        .catch((reason) => {
          setRuns([]);
          setLoadError(reason instanceof Error ? reason.message : String(reason));
          void appLog(`history load failed: ${reason instanceof Error ? reason.message : String(reason)}`);
        })
        .finally(() => setLoading(false));
      void getAutopilotTrust()
        .then((grants) => setTrustedKeys(new Set(grants.map((grant) => grant.projectKey))))
        .catch(() => setTrustedKeys(new Set()));
    }
  }, [opened]);

  if (loading) {
    return (
      <div role="status" aria-label={t('loading')} className="space-y-2 pt-1">
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    );
  }
  if (loadError) return <p role="alert" className="mt-8 text-center text-sm text-ledger-danger">{t('errorGeneric')}</p>;
  if (runs.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia>
            <History aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{t('history')}</EmptyTitle>
          <EmptyDescription>{t('emptyHistory')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div>
      {actionError && (
        <p role="alert" className="mb-2 text-center text-xs text-ledger-danger">
          {actionError}
        </p>
      )}
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-ledger-line">
            <th className="px-2 py-2 text-start text-[11px] font-semibold text-ledger-ink-dim">{t('colDate')}</th>
            <th className="px-2 py-2 text-start text-[11px] font-semibold text-ledger-ink-dim">{t('colFile')}</th>
            <th className="px-2 py-2 text-start text-[11px] font-semibold text-ledger-ink-dim">{t('result')}</th>
            <th className="px-2 py-2 text-start text-[11px] font-semibold text-ledger-ink-dim">{t('colAi')}</th>
            <th aria-label={t('openWorkbook')} className="px-2 py-2" />
          </tr>
        </thead>
        <tbody className="[&>tr:last-child]:border-b-0">
          {runs.map((run) => {
            const dateLabel = formatRunDate(run.startedAt, (date) => date.toLocaleString(i18n.language));
            const datePart = formatRunDate(run.startedAt, (date) => date.toLocaleDateString(i18n.language));
            const timePart = formatRunDate(run.startedAt, (date) =>
              date.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }));
            return (
              <tr key={run.id} className="border-b border-ledger-line transition-colors hover:bg-ledger-surface-2/60">
                <TableCell>
                  <Tooltip delayDuration={220}>
                    <TooltipTrigger asChild>
                      <div className="whitespace-nowrap text-[10px] leading-4 text-zinc-500">
                        <div>{datePart}</div>
                        <div>{timePart}</div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>{dateLabel}</TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <Tooltip delayDuration={220}>
                    <TooltipTrigger asChild>
                      <span className="block max-w-[175px] truncate text-xs font-medium text-ledger-ink">
                        {run.projectName || run.fileName}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {`${run.fileName}${run.revision ? ` · ${t('revisionShort')} ${String(run.revision).padStart(2, '0')}` : ''}`}
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <Tooltip delayDuration={220}>
                    <TooltipTrigger asChild>
                      <span className="whitespace-nowrap text-[11px] text-zinc-600 dark:text-zinc-300">
                        {run.itemCount} → {run.packageCount}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t('historyResultDetail', { items: run.itemCount, packages: run.packageCount })}</TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  {run.llmUsed ? (
                    <Tooltip delayDuration={180}>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="border-violet-500/30 font-bold text-violet-600 dark:text-violet-400">
                          <Sparkles className="h-3 w-3" aria-hidden="true" /> AI
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[260px]">
                        {`${t('aiRunDetail')} · ${t('historyAgentDetail', {
                          provider: run.provider ?? 'AI',
                          model: run.model || t('modelPlaceholder'),
                          events: run.trace?.length ?? 0,
                          memory: run.memoryApplied ?? 0,
                        })}`}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip delayDuration={180}>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="font-medium">
                          <Workflow className="h-3 w-3" aria-hidden="true" /> {t('rules')}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[260px]">
                        {`${t('rulesRunDetail')} · ${t('historyAgentDetail', {
                          provider: run.provider ?? 'offline',
                          model: run.model || t('rules'),
                          events: run.trace?.length ?? 0,
                          memory: run.memoryApplied ?? 0,
                        })}`}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center">
                    <RowAction
                      label={t('openWorkbook')}
                      detail={t('openWorkbookDetail')}
                      tone="gold"
                      onClick={() => {
                        setActionError(null);
                        openWorkbook(run.outputFile).catch(() => setActionError(t('errorGeneric')));
                      }}
                    >
                      <FileSpreadsheet size={14} aria-hidden="true" />
                    </RowAction>
                    {run.packageFolder && (
                      <RowAction
                        label={t('openPackages')}
                        detail={t('openPackagesDetail')}
                        onClick={() => {
                          setActionError(null);
                          openGeneratedFolder(run.packageFolder!).catch(() => setActionError(t('errorGeneric')));
                        }}
                      >
                        <FolderOpen size={14} aria-hidden="true" />
                      </RowAction>
                    )}
                    <RowAction
                      label={t('copyForSupport')}
                      detail={copiedId === (run.id ?? null) ? t('copiedForSupport') : t('copyForSupportDetail')}
                      tone={copiedId === (run.id ?? null) ? 'green' : 'muted'}
                      onClick={() => copyForSupport(run)}
                    >
                      {copiedId === (run.id ?? null)
                        ? <Check size={14} aria-hidden="true" />
                        : <ClipboardCopy size={14} aria-hidden="true" />}
                    </RowAction>
                    {(() => {
                      const key = memoryKey(run.projectName || run.fileName);
                      if (!key) return null;
                      if (trustedKeys.has(key)) {
                        return (
                          <RowAction
                            label={t('autopilotTrusted')}
                            detail={t('autopilotManageInSettings')}
                            tone="green"
                          >
                            <Zap size={14} aria-hidden="true" />
                          </RowAction>
                        );
                      }
                      const arming = armingKey === key;
                      return (
                        <RowAction
                          label={arming ? t('autopilotConfirm') : t('autopilotTrust')}
                          detail={arming ? t('autopilotConfirm') : `${t('autopilotTrust')} — ${t('autopilotDetail')}`}
                          tone={arming ? 'gold' : 'muted'}
                          filled={arming}
                          liquid
                          onClick={() => void trustProject(run)}
                        >
                          <Zap size={14} aria-hidden="true" />
                        </RowAction>
                      );
                    })()}
                  </div>
                </TableCell>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TableCell({ children }: { children: React.ReactNode }) {
  return <td className="px-2 py-2 align-top">{children}</td>;
}
