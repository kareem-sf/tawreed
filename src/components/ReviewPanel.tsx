import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Group,
  Modal,
  ScrollArea,
  Select,
  Table,
  Text,
  Tooltip,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type {
  AgentEvent,
  AiProvider,
  Classification,
  InspectionResult,
  ValidationIssue,
  WorkPackage,
} from '../../shared/types';
import { AnimatedList } from './ui/animated-list';
import { NumberTicker } from './ui/number-ticker';
import { ShimmerButton } from './ui/shimmer-button';

export interface PipelineData {
  inspection: InspectionResult;
  classifications: Classification[];
  packages: WorkPackage[];
  packageCatalog: WorkPackage[];
  issues: ValidationIssue[];
  llmUsed: boolean;
  llmFailed: boolean;
  provider: AiProvider;
  model: string;
  trace: AgentEvent[];
  memoryApplied: number;
  fileName: string;
  bytes: Uint8Array;
  startedAt: number;
}

interface Props {
  data: PipelineData;
  busy: boolean;
  error: string | null;
  hasErrors: boolean;
  retryingPublication: boolean;
  onGenerate: () => void;
  onReset: () => void;
  onClassificationChange: (itemId: number, packageCode: string) => void;
}

const PAGE_SIZE = 100;
const compact = (value: number, locale: string) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 1, notation: 'compact' }).format(value);

export default function ReviewPanel({
  data,
  busy,
  error,
  hasErrors,
  retryingPublication,
  onGenerate,
  onReset,
  onClassificationChange,
}: Props) {
  const { t, i18n } = useTranslation();
  const [itemsOpen, setItemsOpen] = useState(false);
  const [page, setPage] = useState(0);
  const visibleTrace = Array.from(
    new Map(data.trace.map((event) => [event.stage, event])).values(),
  );
  const ar = i18n.language === 'ar';
  const errors = data.issues.filter((issue) => issue.severity === 'error');
  const warnings = data.issues.filter((issue) => issue.severity === 'warning');
  const grand = data.packages.reduce((sum, workPackage) => sum + workPackage.totalCost, 0);
  const classifications = useMemo(
    () => new Map(data.classifications.map((classification) => [classification.itemId, classification])),
    [data.classifications],
  );
  const packageOptions = useMemo(() => {
    const values = data.packageCatalog.map((workPackage) => ({
      value: workPackage.code,
      label: `${workPackage.code} · ${ar ? workPackage.nameAr : workPackage.nameEn}`,
    }));
    if (!values.some((option) => option.value === 'WP-99')) {
      values.push({ value: 'WP-99', label: `WP-99 · ${t('unclassified')}` });
    }
    return values;
  }, [ar, data.packageCatalog, t]);
  const pageCount = Math.max(1, Math.ceil(data.inspection.items.length / PAGE_SIZE));
  const pageItems = data.inspection.items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="flex h-full flex-col gap-2.5 px-4 pb-3">
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <div className="min-w-0">
          <Text size="sm" fw={600} truncate maw={310}>{data.inspection.projectName}</Text>
          <Text size="xs" c="dimmed">
            {data.inspection.sourceKind.toUpperCase()} · {data.fileName}
          </Text>
        </div>
        <Group gap={6} wrap="nowrap">
          {data.llmUsed && (
            <Tooltip label={t('aiEnhancedDetail')} openDelay={180}>
              <Badge size="xs" color="grape" variant="light">{t('aiEnhanced')}</Badge>
            </Tooltip>
          )}
          {data.memoryApplied > 0 && (
            <Tooltip label={t('memoryAppliedDetail', { count: data.memoryApplied })} openDelay={180}>
              <Badge size="xs" color="teal" variant="light">
                {t('memoryApplied', { count: data.memoryApplied })}
              </Badge>
            </Tooltip>
          )}
          {data.llmFailed && (
            <Tooltip label={t('aiFailedDetail')} openDelay={180}>
              <Badge size="xs" color="orange" variant="light">{t('aiFailed')}</Badge>
            </Tooltip>
          )}
        </Group>
      </Group>

      <Group gap={5} wrap="nowrap" aria-label={t('agentTimeline')}>
        {visibleTrace.map((event) => (
          <Tooltip
            key={event.stage}
            label={`${t(`agentStage.${event.stage}`)}: ${event.detail}`}
            openDelay={120}
          >
            <Badge
              size="xs"
              variant="dot"
              color={event.status === 'failed' ? 'red' : event.status === 'fallback' ? 'orange' : 'teal'}
            >
              {t(`agentStage.${event.stage}`)}
            </Badge>
          </Tooltip>
        ))}
      </Group>

      <div className="min-h-0 flex-1 rounded-xl bg-white shadow-sm ring-1 ring-zinc-300 dark:bg-white/[0.03] dark:shadow-none dark:ring-white/10">
        <ScrollArea h="100%" offsetScrollbars scrollbarSize={4}>
          <AnimatedList className="gap-0.5 p-1.5" stagger={0.04}>
            {data.packages.map((workPackage) => (
              <Tooltip.Floating
                key={workPackage.code}
                label={t('packageDetail', {
                  code: workPackage.code,
                  items: workPackage.itemCount,
                  cost: workPackage.totalCost.toLocaleString(i18n.language),
                })}
              >
                <div className="pkg-row flex items-center justify-between px-2.5 py-1.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-8 shrink-0 text-[11px] font-semibold text-amber-600/80 dark:text-amber-400/70">
                      {workPackage.code.replace('WP-', '')}
                    </span>
                    <span className="truncate text-[13px] text-zinc-800 dark:text-zinc-200">
                      {ar ? workPackage.nameAr : workPackage.nameEn}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 ps-2">
                    <span className="text-xs text-zinc-400">{workPackage.itemCount}</span>
                    <span className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
                      {compact(workPackage.totalCost, i18n.language)}
                    </span>
                  </div>
                </div>
              </Tooltip.Floating>
            ))}
          </AnimatedList>
        </ScrollArea>
      </div>

      <div className="flex items-baseline justify-between px-1">
        <Group gap="xs">
          <Text size="xs" c="dimmed">
            {t('summaryLine', { items: data.inspection.items.length, packages: data.packages.length })}
          </Text>
          <Button variant="subtle" size="compact-xs" onClick={() => setItemsOpen(true)}>
            {t('reviewItems')}
          </Button>
        </Group>
        <div className="flex items-baseline gap-1.5">
          <Text size="xs" c="dimmed">{t('currencyEgp')}</Text>
          <NumberTicker
            value={grand}
            locale={i18n.language}
            className="text-[17px] font-bold text-zinc-900 dark:text-white"
          />
        </div>
      </div>

      {errors.map((issue) => (
        <Text key={issue.code} size="xs" c="red" lh={1.3}>● {ar ? issue.messageAr : issue.messageEn}</Text>
      ))}
      {warnings.slice(0, 3).map((issue) => (
        <Text key={issue.code} size="xs" c="yellow.7" lh={1.3}>
          ● {ar ? issue.messageAr : issue.messageEn}
        </Text>
      ))}
      {warnings.length > 3 && (
        <Text size="xs" c="dimmed">{t('moreIssues', { count: warnings.length - 3 })}</Text>
      )}

      {error && (
        <Text size="xs" c="red" ta="center" role="alert" className="allow-select">{error}</Text>
      )}

      <Group justify="space-between" mt={2}>
        <Button variant="subtle" size="xs" color="gray" onClick={onReset}>← {t('newFile')}</Button>
        <ShimmerButton disabled={busy || hasErrors} onClick={onGenerate} className="px-5 py-2 text-[13px]">
          {busy
            ? t('generatingShort')
            : retryingPublication
              ? t('retryPublish')
              : t('approveGenerate')}
        </ShimmerButton>
      </Group>

      <Modal
        opened={itemsOpen}
        onClose={() => setItemsOpen(false)}
        title={t('reviewItemsTitle')}
        size="xl"
        centered
        closeButtonProps={{ 'aria-label': t('close') }}
      >
        <Text size="xs" c="dimmed" mb="sm">{t('reviewItemsDetail')}</Text>
        <ScrollArea h={420} offsetScrollbars>
          <Table striped highlightOnHover withRowBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('source')}</Table.Th>
                <Table.Th>{t('description')}</Table.Th>
                <Table.Th>{t('workPackage')}</Table.Th>
                <Table.Th>{t('confidence')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {pageItems.map((item) => {
                const classification = classifications.get(item.id);
                return (
                  <Table.Tr key={item.id}>
                    <Table.Td>
                      <Text size="xs">
                        {item.page ? t('pageRef', { page: item.page }) : t('rowRef', { row: item.row })}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" maw={310} className="allow-select">{item.description}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Select
                        aria-label={t('itemPackageLabel', { id: item.id })}
                        data={packageOptions}
                        value={classification?.packageCode ?? 'WP-99'}
                        onChange={(value) => value && onClassificationChange(item.id, value)}
                        size="xs"
                        searchable
                        w={245}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">
                        {Math.round((classification?.confidence ?? 0) * 100)}% ·{' '}
                        {t(`classificationSource.${classification?.source ?? 'fallback'}`)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>
        <Group justify="space-between" mt="sm">
          <Button
            size="xs"
            variant="subtle"
            disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            {t('previous')}
          </Button>
          <Text size="xs">{t('pageCount', { page: page + 1, pages: pageCount })}</Text>
          <Button
            size="xs"
            variant="subtle"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
          >
            {t('next')}
          </Button>
        </Group>
      </Modal>
    </div>
  );
}
