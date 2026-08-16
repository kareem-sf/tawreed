import { Button, Group, Modal, ScrollArea, Select, Table, Text } from '@mantine/core';
import type { BoqItem, Classification } from '../../../shared/types';

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
      <ScrollArea h={420} offsetScrollbars>
        <Table striped highlightOnHover withRowBorders stickyHeader>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{sourceLabel}</Table.Th>
              <Table.Th>{descriptionLabel}</Table.Th>
              <Table.Th>{packageLabel}</Table.Th>
              <Table.Th>{statusLabel}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((item) => {
              const classification = classifications.get(item.id);
              const needsReview = reviewItemIds.has(item.id);
              return (
                <Table.Tr key={item.id}>
                  <Table.Td><Text size="xs">{sourceReference(item)}</Text></Table.Td>
                  <Table.Td>
                    <Text size="xs" maw={310} className="allow-select">{item.description}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Select
                      aria-label={itemPackageLabel(item.id)}
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
                      {needsReview ? needsReviewLabel : checkedLabel}
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
