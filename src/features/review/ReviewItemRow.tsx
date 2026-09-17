import type { RowComponentProps } from 'react-window';
import type { BoqItem, Classification } from '../../../shared/types';
import { ModelSelect } from '../settings/ModelSelect';

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
      <span className="font-mono-figures text-xs text-ledger-ink-faint">{sourceReference(item)}</span>
      <span className="allow-select truncate text-xs text-ledger-ink">{item.description}</span>
      <ModelSelect
        ariaLabel={itemPackageLabel(item.id)}
        placeholder=""
        options={packageOptions}
        value={classification?.packageCode ?? 'WP-99'}
        onChange={(value) => {
          if (value) onClassificationChange(item.id, value);
        }}
      />
      <span className={`text-xs ${needsReview ? 'text-ledger-danger' : 'text-ledger-ink-dim'}`}>
        {needsReview ? needsReviewLabel : checkedLabel}
      </span>
    </div>
  );
}
