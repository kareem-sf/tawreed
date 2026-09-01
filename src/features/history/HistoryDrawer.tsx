import { useEffect, useState } from 'react';
import { ActionIcon, ScrollArea, Table, Text, Tooltip } from '@mantine/core';
import { Check, ClipboardCopy, FileSpreadsheet, FolderOpen, Sparkles, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { listRuns, openGeneratedFolder, openWorkbook } from '../../bridge';
import type { RunRecord } from '../../../shared/types';
import { formatRunForSupport } from './formatRunForSupport';

export default function HistoryDrawer({ opened }: { opened: boolean }) {
  const { t, i18n } = useTranslation();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const copyForSupport = (run: RunRecord) => {
    void navigator.clipboard.writeText(formatRunForSupport(run)).then(() => {
      setCopiedId(run.id ?? null);
      window.setTimeout(() => setCopiedId((current) => (current === (run.id ?? null) ? null : current)), 1500);
    }).catch(() => undefined);
  };

  useEffect(() => {
    if (opened) {
      setLoading(true);
      listRuns()
        .then(setRuns)
        .catch(() => setRuns([]))
        .finally(() => setLoading(false));
    }
  }, [opened]);

  if (loading) return <Text c="dimmed" ta="center" mt="xl">{t('loading')}</Text>;
  if (runs.length === 0) return <Text c="dimmed" ta="center" mt="xl">{t('emptyHistory')}</Text>;

  return (
    <ScrollArea h="calc(100vh - 78px)" offsetScrollbars scrollbarSize={4}>
      <Table highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('colDate')}</Table.Th>
            <Table.Th>{t('colFile')}</Table.Th>
            <Table.Th>{t('result')}</Table.Th>
            <Table.Th>{t('colAi')}</Table.Th>
            <Table.Th aria-label={t('openWorkbook')} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {runs.map((run) => {
            const date = new Date(run.startedAt);
            return (
              <Table.Tr key={run.id}>
                <Table.Td>
                  <Tooltip label={date.toLocaleString(i18n.language)} openDelay={220}>
                    <div className="whitespace-nowrap text-[10px] leading-4 text-zinc-500">
                      <div>{date.toLocaleDateString(i18n.language)}</div>
                      <div>{date.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  </Tooltip>
                </Table.Td>
                <Table.Td>
                  <Tooltip label={`${run.fileName}${run.revision ? ` · ${t('revisionShort')} ${String(run.revision).padStart(2, '0')}` : ''}`} openDelay={220}>
                    <Text size="xs" maw={175} truncate fw={500}>{run.projectName || run.fileName}</Text>
                  </Tooltip>
                </Table.Td>
                <Table.Td>
                  <Tooltip label={t('historyResultDetail', { items: run.itemCount, packages: run.packageCount })} openDelay={220}>
                    <span className="whitespace-nowrap text-[11px] text-zinc-600 dark:text-zinc-300">
                      {run.itemCount} → {run.packageCount}
                    </span>
                  </Tooltip>
                </Table.Td>
                <Table.Td>
                  {run.llmUsed ? (
                    <Tooltip
                      label={`${t('aiRunDetail')} · ${t('historyAgentDetail', {
                        provider: run.provider ?? 'AI',
                        model: run.model || t('modelPlaceholder'),
                        events: run.trace?.length ?? 0,
                        memory: run.memoryApplied ?? 0,
                      })}`}
                      openDelay={180}
                      multiline
                    >
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-violet-600 dark:text-violet-400">
                        <Sparkles className="h-3 w-3" /> AI
                      </span>
                    </Tooltip>
                  ) : (
                    <Tooltip
                      label={`${t('rulesRunDetail')} · ${t('historyAgentDetail', {
                        provider: run.provider ?? 'offline',
                        model: run.model || t('rules'),
                        events: run.trace?.length ?? 0,
                        memory: run.memoryApplied ?? 0,
                      })}`}
                      openDelay={180}
                      multiline
                    >
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-zinc-400">
                        <Workflow className="h-3 w-3" /> {t('rules')}
                      </span>
                    </Tooltip>
                  )}
                </Table.Td>
                <Table.Td>
                  <Tooltip label={t('openWorkbookDetail')} openDelay={180}>
                    <ActionIcon
                      variant="subtle"
                      color="gold"
                      size="sm"
                      onClick={() => openWorkbook(run.outputFile).catch(() => undefined)}
                      aria-label={t('openWorkbook')}
                    >
                      <FileSpreadsheet size={14} />
                    </ActionIcon>
                  </Tooltip>
                  {run.packageFolder && (
                    <Tooltip label={t('openPackagesDetail')} openDelay={180}>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="sm"
                        onClick={() => openGeneratedFolder(run.packageFolder!).catch(() => undefined)}
                        aria-label={t('openPackages')}
                      >
                        <FolderOpen size={14} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                  <Tooltip label={copiedId === (run.id ?? null) ? t('copiedForSupport') : t('copyForSupportDetail')} openDelay={180}>
                    <ActionIcon
                      variant="subtle"
                      color={copiedId === (run.id ?? null) ? 'green' : 'gray'}
                      size="sm"
                      onClick={() => copyForSupport(run)}
                      aria-label={t('copyForSupport')}
                    >
                      {copiedId === (run.id ?? null) ? <Check size={14} /> : <ClipboardCopy size={14} />}
                    </ActionIcon>
                  </Tooltip>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}
