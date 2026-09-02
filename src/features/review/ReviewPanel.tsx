import { useMemo, useState } from 'react';
import { Button, Group, ScrollArea, Text } from '@mantine/core';
import { AlertTriangle, ArrowLeft, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { REVIEW_CONFIDENCE_THRESHOLD, type WorkPackage } from '../../../shared/types';
import { PackageSummaryList } from './PackageSummaryList';
import { ReviewItemsDialog } from './ReviewItemsDialog';
import type { PipelineData } from '../workflow/types';
import { NumberTicker } from '../../components/ui/number-ticker';

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
  const [packageFilter, setPackageFilter] = useState<string | null>(null);
  const ar = i18n.language === 'ar';
  const locale = ar ? 'ar-EG' : 'en-EG';
  const totalItems = data.inspection.items.length;
  const grandTotal = data.packages.reduce((sum, workPackage) => sum + workPackage.totalCost, 0);

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
      if (classification.packageCode === 'WP-99' || classification.confidence < REVIEW_CONFIDENCE_THRESHOLD) {
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

  const packageOptions = useMemo(() => {
    const options = data.packageCatalog.map((workPackage) => ({
      value: workPackage.code,
      label: `${workPackage.code} · ${ar ? workPackage.nameAr : workPackage.nameEn}`,
    }));
    if (!options.some((option) => option.value === 'WP-99')) {
      options.push({ value: 'WP-99', label: `WP-99 · ${t('unclassified')}` });
    }
    return options;
  }, [ar, data.packageCatalog, t]);

  const filteredItems = useMemo(
    () => packageFilter
      ? data.inspection.items.filter(
        (item) => classifications.get(item.id)?.packageCode === packageFilter,
      )
      : data.inspection.items,
    [classifications, data.inspection.items, packageFilter],
  );
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filteredItems.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const openItems = (workPackage?: WorkPackage) => {
    setPackageFilter(workPackage?.code ?? null);
    setPage(0);
    setItemsOpen(true);
  };

  const dialogTitle = packageFilter
    ? packageOptions.find((option) => option.value === packageFilter)?.label ?? t('reviewItemsTitle')
    : t('reviewItemsTitle');

  return (
    <div className="flex h-full flex-col gap-3 px-4 pb-3">
      <header className="flex items-start justify-between gap-4 px-1">
        <div className="min-w-0">
          <Text className="font-serif-display" size="sm" fw={650} truncate c="var(--ink)">
            {data.inspection.projectName}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {data.fileName} · {t('summaryLine', {
              items: totalItems,
              packages: data.packages.length,
            })}
          </Text>
        </div>
        <div className="shrink-0 text-end">
          <Text size="xs" tt="uppercase" style={{ letterSpacing: '0.09em' }} c="dimmed">
            {t('totalValue')} · {t('currencyEgp')}
          </Text>
          <NumberTicker
            value={grandTotal}
            locale={locale}
            className="font-serif-display text-[24px] font-semibold text-gold-deep dark:text-gold"
          />
        </div>
      </header>

      <section
        className="min-h-0 flex-1 rounded-2xl border border-ledger-line bg-ledger-surface shadow-sm"
        aria-label={t('workPackage')}
      >
        <ScrollArea h="100%" offsetScrollbars scrollbarSize={4}>
          <PackageSummaryList
            packages={data.packages}
            totalItems={totalItems}
            locale={locale}
            flaggedCodes={flaggedCodes}
            currencyLabel={t('currencyEgp')}
            needsReviewLabel={t('needsReview')}
            itemCountLabel={(count) => t('packageItemCount', { count })}
            packageName={(workPackage) => ar ? workPackage.nameAr : workPackage.nameEn}
            onSelect={openItems}
          />
        </ScrollArea>
      </section>

      {(hasErrors || reviewItemIds.size > 0) && (
        <div className="flex items-center gap-2 rounded-xl border border-ledger-line bg-gold/8 px-3 py-2.5 text-xs text-gold-deep dark:text-[#f0d8a0]">
          <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
          <span>{t('itemsNeedReview', { count: reviewItemIds.size })}</span>
        </div>
      )}

      {data.aiSkipped > 0 && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border border-ledger-line bg-gold/8 px-3 py-2.5 text-xs text-gold-deep dark:text-[#f0d8a0]"
        >
          <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
          <span>{t('aiSkippedItems', { count: data.aiSkipped, total: totalItems })}</span>
        </div>
      )}

      {error && (
        <Text size="xs" c="red" ta="center" role="alert" className="allow-select">{error}</Text>
      )}

      <footer className="flex items-center justify-between gap-3">
        <Button
          variant="subtle"
          size="xs"
          color="gray"
          leftSection={<ArrowLeft size={13} className="rtl:rotate-180" aria-hidden="true" />}
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
            color="gold"
            size="sm"
            disabled={busy || hasErrors}
            onClick={onGenerate}
            leftSection={<Check size={15} aria-hidden="true" />}
            styles={{
              root: {
                color: '#1c1408',
                fontWeight: 700,
                background: 'linear-gradient(180deg, #f3c968, var(--gold))',
                boxShadow: '0 8px 20px -6px rgba(232,181,74,0.5)',
              },
            }}
          >
            {busy
              ? t('generatingShort')
              : retryingPublication
                ? t('retryPublish')
                : t('approveGenerate')}
          </Button>
        </Group>
      </footer>

      <ReviewItemsDialog
        opened={itemsOpen}
        title={dialogTitle}
        detail={t('reviewItemsSimpleDetail')}
        closeLabel={t('close')}
        sourceLabel={t('source')}
        descriptionLabel={t('description')}
        packageLabel={t('workPackage')}
        statusLabel={t('status')}
        needsReviewLabel={t('needsReview')}
        checkedLabel={t('checked')}
        previousLabel={t('previous')}
        nextLabel={t('next')}
        pageLabel={t('pageCount', { page: safePage + 1, pages: pageCount })}
        items={pageItems}
        classifications={classifications}
        reviewItemIds={reviewItemIds}
        packageOptions={packageOptions}
        page={safePage}
        pageCount={pageCount}
        onClose={() => setItemsOpen(false)}
        onPageChange={setPage}
        onClassificationChange={onClassificationChange}
        sourceReference={(item) => item.page
          ? t('pageRef', { page: item.page })
          : t('rowRef', { row: item.row })}
        itemPackageLabel={(itemId) => t('itemPackageLabel', { id: itemId })}
      />
    </div>
  );
}
