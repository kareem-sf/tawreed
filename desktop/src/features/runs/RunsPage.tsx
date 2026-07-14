import {
  ActionIcon,
  Button,
  Group,
  Menu,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconDots,
  IconFileSpreadsheet,
  IconFolder,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import type { HistoryEntry } from "../../lib/engine/types";
import styles from "./RunsPage.module.css";

interface RunsPageProps {
  history: HistoryEntry[];
  loading: boolean;
  onRefresh: () => void;
  onOpen: (path: string) => void;
  onReveal: (path: string) => void;
  onDelete: (id: number) => void;
}

function filenameFromPath(path: string): string {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] || path;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

export function RunsPage({
  history,
  loading,
  onRefresh,
  onOpen,
  onReveal,
  onDelete,
}: RunsPageProps) {
  const { t } = useTranslation();

  return (
    <section className={styles.page} aria-labelledby="runs-title">
      <header className={styles.header}>
        <div>
          <Title id="runs-title" order={1} className={styles.pageTitle}>
            {t("runs.title")}
          </Title>
          <Text className={styles.subtitle}>{t("runs.subtitle")}</Text>
        </div>
        <Tooltip label={t("runs.refresh")} position="left">
          <ActionIcon
            variant="subtle"
            color="gray"
            size="lg"
            loading={loading}
            aria-label={t("runs.refresh")}
            onClick={onRefresh}
          >
            <IconRefresh size={21} stroke={1.55} />
          </ActionIcon>
        </Tooltip>
      </header>

      {history.length ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t("runs.project")}</th>
              <th>{t("runs.fileName")}</th>
              <th>{t("runs.generated")}</th>
              <th>{t("runs.packages")}</th>
              <th className={styles.actionsHeading}>{t("runs.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((entry) => (
              <tr key={entry.id}>
                <td>
                  <Text fw={520} size="sm" truncate>
                    {entry.project_name}
                  </Text>
                </td>
                <td>
                  <Group gap="sm" wrap="nowrap">
                    <IconFileSpreadsheet
                      className={styles.fileIcon}
                      size={20}
                      stroke={1.45}
                      aria-hidden="true"
                    />
                    <Text size="sm" truncate>
                      {filenameFromPath(entry.output_path)}
                    </Text>
                  </Group>
                </td>
                <td className={styles.monoCell}>
                  {formatTimestamp(entry.timestamp)}
                </td>
                <td className={styles.monoCell}>
                  {t("runs.packageCount", { count: entry.packages_count })}
                </td>
                <td>
                  <Group justify="flex-end" gap={4} wrap="nowrap">
                    <Button
                      variant="subtle"
                      size="compact-sm"
                      onClick={() => onOpen(entry.output_path)}
                    >
                      {t("runs.open")}
                    </Button>
                    <Menu position="bottom-end" withinPortal shadow="md">
                      <Menu.Target>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          aria-label={t("runs.actions")}
                        >
                          <IconDots size={19} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Label>
                          <Text className={styles.path} size="xs" lineClamp={2}>
                            {entry.output_path}
                          </Text>
                        </Menu.Label>
                        <Menu.Item
                          leftSection={<IconFolder size={16} />}
                          onClick={() => onReveal(entry.output_path)}
                        >
                          {t("runs.reveal")}
                        </Menu.Item>
                        <Menu.Divider />
                        <Menu.Item
                          color="red"
                          leftSection={<IconTrash size={16} />}
                          onClick={() => onDelete(entry.id)}
                        >
                          {t("runs.remove")}
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className={styles.empty}>
          <IconFileSpreadsheet size={28} stroke={1.35} aria-hidden="true" />
          <Text>{t("runs.empty")}</Text>
        </div>
      )}
    </section>
  );
}
