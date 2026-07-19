import { useEffect, useState } from 'react';
import { ActionIcon, ScrollArea, Table, Text, Tooltip } from '@mantine/core';
import { FileSpreadsheet, FolderOpen, Sparkles, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { listRuns, openGeneratedFolder, openWorkbook } from '../bridge';
import type { RunRecord } from '../../shared/types';

export default function HistoryDrawer() {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<RunRecord[]>([]);

  useEffect(() => {
    listRuns().then(setRuns).catch(() => setRuns([]));
  }, []);

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
                  <Tooltip label={date.toLocaleString()} openDelay={220}>
                    <div className="whitespace-nowrap text-[10px] leading-4 text-zinc-500">
                      <div>{date.toLocaleDateString()}</div>
                      <div>{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  </Tooltip>
                </Table.Td>
                <Table.Td>
                  <Tooltip label={`${run.fileName}${run.revision ? ` · Rev ${String(run.revision).padStart(2, '0')}` : ''}`} openDelay={220}>
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
                    <Tooltip label={t('aiRunDetail')} openDelay={180}>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-violet-600 dark:text-violet-400">
                        <Sparkles className="h-3 w-3" /> AI
                      </span>
                    </Tooltip>
                  ) : (
                    <Tooltip label={t('rulesRunDetail')} openDelay={180}>
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
                      color="yellow"
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
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}
