import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { List } from 'react-window';
import type { BoqItem, Classification } from '../../../shared/types';
import { Button } from '../../components/ui/button';
import {
  ResponsiveModal,
  ResponsiveModalDescription,
  ResponsiveModalOverlay,
  ResponsiveModalTitle,
} from '../../components/spectrumui/responsive-modal-dependencies';
import { ReviewItemRow, type ReviewItemRowProps } from './ReviewItemRow';

interface PackageOption {
  value: string;
  label: string;
}

interface Props {
  opened: boolean;
  title: string;
  detail: string;
  closeLabel: string;
  sourceLabel: string;
  descriptionLabel: string;
  packageLabel: string;
  statusLabel: string;
  needsReviewLabel: string;
  checkedLabel: string;
  previousLabel: string;
  nextLabel: string;
  pageLabel: string;
  items: BoqItem[];
  classifications: Map<number, Classification>;
  reviewItemIds: Set<number>;
  packageOptions: PackageOption[];
  page: number;
  pageCount: number;
  onClose: () => void;
  onPageChange: (page: number) => void;
  onClassificationChange: (itemId: number, packageCode: string) => void;
  sourceReference: (item: BoqItem) => string;
  itemPackageLabel: (itemId: number) => string;
}

const ROW_HEIGHT = 44;
const LIST_HEIGHT = 420;

export function ReviewItemsDialog({
  opened,
  title,
  detail,
  closeLabel,
  sourceLabel,
  descriptionLabel,
  packageLabel,
  statusLabel,
  needsReviewLabel,
  checkedLabel,
  previousLabel,
  nextLabel,
  pageLabel,
  items,
  classifications,
  reviewItemIds,
  packageOptions,
  page,
  pageCount,
  onClose,
  onPageChange,
  onClassificationChange,
  sourceReference,
  itemPackageLabel,
}: Props) {
  const rowProps: ReviewItemRowProps = {
    items,
    classifications,
    reviewItemIds,
    packageOptions,
    needsReviewLabel,
    checkedLabel,
    onClassificationChange,
    sourceReference,
    itemPackageLabel,
  };

  return (
    <ResponsiveModal
      open={opened}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <ResponsiveModalOverlay />
      <DialogPrimitive.Content
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-ledger-line bg-background p-6 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
      >
        <div className="mb-1 flex items-start justify-between gap-4">
          <ResponsiveModalTitle className="font-serif-display">{title}</ResponsiveModalTitle>
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className="rounded-md p-1.5 text-ledger-ink-faint transition hover:bg-ledger-surface-2 hover:text-ledger-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <X size={15} aria-hidden="true" />
          </DialogPrimitive.Close>
        </div>
        <ResponsiveModalDescription>{detail}</ResponsiveModalDescription>
        <div className="mt-3 grid grid-cols-[110px_minmax(0,1fr)_261px_90px] gap-2 border-b border-ledger-line px-3 pb-2">
          <span className="text-xs font-semibold text-ledger-ink-dim">{sourceLabel}</span>
          <span className="text-xs font-semibold text-ledger-ink-dim">{descriptionLabel}</span>
          <span className="text-xs font-semibold text-ledger-ink-dim">{packageLabel}</span>
          <span className="text-xs font-semibold text-ledger-ink-dim">{statusLabel}</span>
        </div>
        <List
          rowComponent={ReviewItemRow}
          rowCount={items.length}
          rowHeight={ROW_HEIGHT}
          rowProps={rowProps}
          style={{ height: LIST_HEIGHT }}
        />
        <div className="mt-3 flex items-center justify-between">
          <Button
            size="sm"
            variant="ghost"
            disabled={page === 0}
            onClick={() => onPageChange(Math.max(0, page - 1))}
          >
            {previousLabel}
          </Button>
          <span className="text-xs text-ledger-ink">{pageLabel}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page + 1 >= pageCount}
            onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
          >
            {nextLabel}
          </Button>
        </div>
      </DialogPrimitive.Content>
    </ResponsiveModal>
  );
}
