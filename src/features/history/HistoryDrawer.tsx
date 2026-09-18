import { useEffect, useState } from 'react';
import { Check, ClipboardCopy, FileSpreadsheet, FolderOpen, History, Sparkles, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Badge } from '../../components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../components/ui/empty';
import { Skeleton } from '../../components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { appLog, listRuns, openGeneratedFolder, openWorkbook } from '../../bridge';
import type { RunRecord } from '../../../shared/types';
import { formatRunDate, formatRunForSupport } from './formatRunForSupport';

function RowAction({
  label,
  detail,
  tone = 'muted',
  filled = false,
  onClick,
  children,
}: {
  label: string;
  detail: string;
  tone?: 'muted' | 'primary' | 'green';
  filled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'rounded-md p-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        filled
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        !filled && tone === 'primary' && 'text-primary hover:text-primary',
        !filled && tone === 'green' && 'text-success hover:text-success',
      )}
    >
      {children}
    </button>
  );
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        {button}
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

  const copyForSupport = (run: RunRecord) => {
    void navigator.clipboard.writeText(formatRunForSupport(run)).then(() => {
      setCopiedId(run.id ?? null);
      window.setTimeout(() => setCopiedId((current) => (current === (run.id ?? null) ? null : current)), 1500);
    }).catch(() => undefined);
  };

  useEffect(() => {
    if (opened) {
      // Guarded by `opened`, so this runs once per open rather than every render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(true);
      setLoadError(null);
      listRuns()
        .then(setRuns)
        .catch((reason) => {
          setRuns([]);
          setLoadError(reason instanceof Error ? reason.message : String(reason));
          void appLog(`history load failed: ${reason instanceof Error ? reason.message : String(reason)}`);
        })
        .finally(() => setLoading(false));
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
  if (loadError) return <p role="alert" className="mt-8 text-center text-sm text-destructive">{t('errorGeneric')}</p>;
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
        <p role="alert" className="mb-2 text-center text-xs text-destructive">
          {actionError}
        </p>
      )}
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border">
            <th className="px-2 py-2 text-start text-[11px] font-semibold text-muted-foreground">{t('colDate')}</th>
            <th className="px-2 py-2 text-start text-[11px] font-semibold text-muted-foreground">{t('colFile')}</th>
            <th className="px-2 py-2 text-start text-[11px] font-semibold text-muted-foreground">{t('result')}</th>
            <th className="px-2 py-2 text-start text-[11px] font-semibold text-muted-foreground">{t('colAi')}</th>
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
              <tr key={run.id} className="border-b border hover:bg-muted/60">
                <TableCell>
                  <div className="whitespace-nowrap text-[10px] tabular-nums leading-4 text-muted-foreground" title={dateLabel}>
                    <div>{datePart}</div>
                    <div>{timePart}</div>
                  </div>
                </TableCell>
                <TableCell>
                  <Tooltip delayDuration={400}>
                    <TooltipTrigger asChild>
                      <span className="block max-w-[175px] truncate text-xs font-medium text-foreground">
                        {run.projectName || run.fileName}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {`${run.fileName}${run.revision ? ` · ${t('revisionShort')} ${String(run.revision).padStart(2, '0')}` : ''}`}
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground" title={t('historyResultDetail', { items: run.itemCount, packages: run.packageCount })}>
                    {run.itemCount} → {run.packageCount}
                  </span>
                </TableCell>
                <TableCell>
                  {run.llmUsed ? (
                    <Tooltip delayDuration={400}>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="border-primary/30 font-bold text-primary">
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
                    <Tooltip delayDuration={400}>
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
                      tone="primary"
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
