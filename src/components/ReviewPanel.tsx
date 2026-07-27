import { useMemo, useState } from 'react';
import {
  Button,
  Group,
  Modal,
  ScrollArea,
  Select,
  Table,
  Text,
} from '@mantine/core';
import { AlertTriangle, ArrowLeft, Check, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  AgentEvent,
  AiProvider,
  Classification,
  InspectionResult,
  ValidationIssue,
  WorkPackage,
} from '../../shared/types';
import {
  Legend,
  LegendLabel,
  LegendMarker,
  LegendProgress,
  LegendValue,
  useLegend,
  useLegendItem,
} from './charts/legend';
import { NumberTicker } from './ui/number-ticker';

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

interface PackageLegendRowProps {
  packages: WorkPackage[];
  locale: string;
  flaggedCodes: Set<string>;
  formatItemCount: (value: number) => string;
  currencyLabel: string;
  needsReviewLabel: string;
  onSelect: (workPackage: WorkPackage) => void;
}

const PAGE_SIZE = 100;

function PackageLegendRow({
  packages,
  locale,
  flaggedCodes,
  formatItemCount,
  currencyLabel,
  needsReviewLabel,
  onSelect,
}: PackageLegendRowProps) {
  const { setHoveredIndex } = useLegend();
  const { index, isHovered } = useLegendItem();
  const workPackage = packages[index];
  if (!workPackage) return null;

  const compactCost = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    notation: 'compact',
  }).format(workPackage.totalCost);

  return (
    <button
      type="button"
      className="group w-full rounded-xl border-0 bg-transparent px-3 py-2.5 text-start text-inherit transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70 dark:hover:bg-white/[0.045]"
      data-hovered={isHovered || undefined}
      onMouseEnter={() => setHoveredIndex(index)}
      onMouseLeave={() => setHoveredIndex(null)}
      onFocus={() => setHoveredIndex(index)}
      onBlur={() => setHoveredIndex(null)}
      onClick={() => onSelect(workPackage)}
    >
      <div className="flex items-start gap-3">
        <LegendMarker className="mt-1.5 size-2 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <LegendLabel className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100" />
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-400">
                <span>{workPackage.code}</span>
                {flaggedCodes.has(workPackage.code) && (
                  <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                    <AlertTriangle size={10} /> {needsReviewLabel}
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <LegendValue
                showPercentage
                className="gap-1.5 text-xs text-zinc-500"
                percentageClassName="text-xs tabular-nums text-zinc-400"
                formatValue={formatItemCount}
                formatPercentage={(percentage) => new Intl.NumberFormat(locale, {
                  style: 'percent',
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                }).format(percentage / 100)}
              />
              <span className="w-14 text-end text-[12px] font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">
                {currencyLabel} {compactCost}
              </span>
              <ChevronRight className="size-3 text-zinc-300 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
            </div>
          </div>
          <LegendProgress height="h-1" trackClassName="mt-2 bg-zinc-100 dark:bg-white/[0.07]" />
        </div>
      </div>
    </button>
  );
}

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
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [packageFilter, setPackageFilter] = useState<string | null>(null);
  const ar = i18n.language === 'ar';
  const locale = ar ? 'ar-EG' : 'en-EG';
  const totalItems = Math.max(1, data.inspection.items.length);
  const grand = data.packages.reduce((sum, workPackage) => sum + workPackage.totalCost, 0);

  const classifications = useMemo(
    () => new Map(data.classifications.map((classification) => [classification.itemId, classification])),
    [data.classifications],
  );
  const reviewItemIds = useMemo(() => {
    const ids = new Set<number>();
    for (const issue of data.issues) {
      for (const itemId of issue.itemIds) ids.add(itemId);
    }
    for (const classification of data.classifications) {
      if (classification.packageCode === 'WP-99' || classification.confidence < 0.55) {
        ids.add(classification.itemId);
      }
    }
    return ids;
  }, [data.classifications, data.issues]);
  const flaggedCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const itemId of reviewItemIds) {
      codes.add(classifications.get(itemId)?.packageCode ?? 'WP-99');
    }
    return codes;
  }, [classifications, reviewItemIds]);
  const legendItems = useMemo(
    () => data.packages.map((workPackage) => ({
      label: ar ? workPackage.nameAr : workPackage.nameEn,
      value: workPackage.itemCount,
      maxValue: totalItems,
      color: workPackage.code === 'WP-99' ? '#dc2626' : '#f5a800',
    })),
    [ar, data.packages, totalItems],
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
  const filteredItems = packageFilter
    ? data.inspection.items.filter(
      (item) => classifications.get(item.id)?.packageCode === packageFilter,
    )
    : data.inspection.items;
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filteredItems.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const openItems = (workPackage?: WorkPackage) => {
    setPackageFilter(workPackage?.code ?? null);
    setPage(0);
    setItemsOpen(true);
  };

  return (
    <div className="flex h-full flex-col gap-3 px-4 pb-3">
      <div className="flex items-start justify-between gap-4 px-1">
        <div className="min-w-0">
          <Text size="sm" fw={650} truncate>{data.inspection.projectName}</Text>
          <Text size="xs" c="dimmed" truncate>
            {data.fileName} · {t('summaryLine', {
              items: data.inspection.items.length,
              packages: data.packages.length,
            })}
          </Text>
        </div>
        <div className="shrink-0 text-end">
          <Text size="xs" c="dimmed">{t('totalValue')}</Text>
          <div className="flex items-baseline justify-end gap-1.5">
            <Text size="xs" c="dimmed">{t('currencyEgp')}</Text>
            <NumberTicker
              value={grand}
              locale={locale}
              className="text-[18px] font-bold text-zinc-950 dark:text-white"
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.025]">
        <ScrollArea h="100%" offsetScrollbars scrollbarSize={4}>
          <Legend
            items={legendItems}
            hoveredIndex={hoveredIndex}
            onHoverChange={setHoveredIndex}
            className="gap-0 p-1.5"
          >
            <PackageLegendRow
              packages={data.packages}
              locale={locale}
              flaggedCodes={flaggedCodes}
              formatItemCount={(value) => t('packageItemCount', { count: value })}
              currencyLabel={t('currencyEgp')}
              needsReviewLabel={t('needsReview')}
              onSelect={openItems}
            />
          </Legend>
        </ScrollArea>
      </div>

      {(hasErrors || reviewItemIds.size > 0) && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle size={14} className="shrink-0" />
          <span>{t('itemsNeedReview', { count: reviewItemIds.size })}</span>
        </div>
      )}

      {error && (
        <Text size="xs" c="red" ta="center" role="alert" className="allow-select">{error}</Text>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="subtle"
          size="xs"
          color="gray"
          leftSection={<ArrowLeft size={13} className="rtl:rotate-180" />}
          onClick={onReset}
        >
          {t('newFile')}
        </Button>
        <Group gap="xs">
          <Button variant="subtle" color="gray" size="xs" onClick={() => openItems()}>
            {reviewItemIds.size
              ? t('reviewCountItems', { count: reviewItemIds.size })
              : t('reviewItems')}
          </Button>
          <Button
            color="yellow"
            size="sm"
            disabled={busy || hasErrors}
            onClick={onGenerate}
            leftSection={<Check size={15} />}
            styles={{ root: { color: '#18181b', fontWeight: 650 } }}
          >
            {busy
              ? t('generatingShort')
              : retryingPublication
                ? t('retryPublish')
                : t('approveGenerate')}
          </Button>
        </Group>
      </div>

      <Modal
        opened={itemsOpen}
        onClose={() => setItemsOpen(false)}
        title={packageFilter
          ? packageOptions.find((option) => option.value === packageFilter)?.label
          : t('reviewItemsTitle')}
        size="xl"
        centered
        closeButtonProps={{ 'aria-label': t('close') }}
      >
        <Text size="xs" c="dimmed" mb="sm">{t('reviewItemsSimpleDetail')}</Text>
        <ScrollArea h={420} offsetScrollbars>
          <Table striped highlightOnHover withRowBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('source')}</Table.Th>
                <Table.Th>{t('description')}</Table.Th>
                <Table.Th>{t('workPackage')}</Table.Th>
                <Table.Th>{t('status')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {pageItems.map((item) => {
                const classification = classifications.get(item.id);
                const needsReview = reviewItemIds.has(item.id);
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
                      <Text size="xs" c={needsReview ? 'yellow.8' : 'dimmed'}>
                        {needsReview ? t('needsReview') : t('checked')}
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
            disabled={safePage === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            {t('previous')}
          </Button>
          <Text size="xs">{t('pageCount', { page: safePage + 1, pages: pageCount })}</Text>
          <Button
            size="xs"
            variant="subtle"
            disabled={safePage + 1 >= pageCount}
            onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
          >
            {t('next')}
          </Button>
        </Group>
      </Modal>
    </div>
  );
}
