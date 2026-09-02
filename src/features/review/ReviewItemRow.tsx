import { Select, Text } from '@mantine/core';
import type { RowComponentProps } from 'react-window';
import type { BoqItem, Classification } from '../../../shared/types';

interface PackageOption {
  value: string;
  label: string;
}

export interface ReviewItemRowProps {
  items: BoqItem[];
  classifications: Map<number, Classification>;
  reviewItemIds: Set<number>;
  packageOptions: PackageOption[];
  needsReviewLabel: string;
  checkedLabel: string;
  onClassificationChange: (itemId: number, packageCode: string) => void;
  sourceReference: (item: BoqItem) => string;
  itemPackageLabel: (itemId: number) => string;
}

export function ReviewItemRow({
  index,
  style,
  items,
  classifications,
  reviewItemIds,
  packageOptions,
  needsReviewLabel,
  checkedLabel,
  onClassificationChange,
  sourceReference,
  itemPackageLabel,
}: RowComponentProps<ReviewItemRowProps>) {
  const item = items[index];
  if (!item) return null;
  const classification = classifications.get(item.id);
  const needsReview = reviewItemIds.has(item.id);

  return (
    <div
      style={style}
      className="grid grid-cols-[110px_minmax(0,1fr)_261px_90px] items-center gap-2 border-b border-ledger-line px-3"
    >
      <Text size="xs" className="font-mono-figures" c="var(--ink-faint)">{sourceReference(item)}</Text>
      <Text size="xs" truncate className="allow-select" c="var(--ink)">{item.description}</Text>
      <Select
        aria-label={itemPackageLabel(item.id)}
        data={packageOptions}
        value={classification?.packageCode ?? 'WP-99'}
        onChange={(value) => value && onClassificationChange(item.id, value)}
        size="xs"
        searchable
        w={245}
        comboboxProps={{ withinPortal: true }}
      />
      <Text size="xs" c={needsReview ? 'var(--danger)' : 'dimmed'}>
        {needsReview ? needsReviewLabel : checkedLabel}
      </Text>
    </div>
  );
}
