import { Button, Group, Modal, Text } from '@mantine/core';
import { List } from 'react-window';
import type { BoqItem, Classification } from '../../../shared/types';
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
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      size="xl"
      centered
      closeButtonProps={{ 'aria-label': closeLabel }}
      styles={{ content: { borderRadius: 18 } }}
    >
      <Text size="xs" c="dimmed" mb="sm">{detail}</Text>
      <div className="grid grid-cols-[110px_minmax(0,1fr)_261px_90px] gap-2 border-b border-ledger-line px-3 pb-2">
        <Text size="xs" fw={600} c="dimmed">{sourceLabel}</Text>
        <Text size="xs" fw={600} c="dimmed">{descriptionLabel}</Text>
        <Text size="xs" fw={600} c="dimmed">{packageLabel}</Text>
        <Text size="xs" fw={600} c="dimmed">{statusLabel}</Text>
      </div>
      <List
        rowComponent={ReviewItemRow}
        rowCount={items.length}
        rowHeight={ROW_HEIGHT}
        rowProps={rowProps}
        style={{ height: LIST_HEIGHT }}
      />
      <Group justify="space-between" mt="sm">
        <Button
          size="xs"
          variant="subtle"
          disabled={page === 0}
          onClick={() => onPageChange(Math.max(0, page - 1))}
        >
          {previousLabel}
        </Button>
        <Text size="xs">{pageLabel}</Text>
        <Button
          size="xs"
          variant="subtle"
          disabled={page + 1 >= pageCount}
          onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
        >
          {nextLabel}
        </Button>
      </Group>
    </Modal>
  );
}
