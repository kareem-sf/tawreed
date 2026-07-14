import { useEffect } from "react";
import {
  Accordion,
  Button,
  Drawer,
  Group,
  Progress,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { useDisclosure } from "@mantine/hooks";
import {
  IconAlertTriangle,
  IconCheck,
  IconFileSpreadsheet,
  IconFolder,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import {
  WorkflowRoute,
  type WorkflowStage,
} from "../../components/WorkflowRoute";
import type { SelectedWorkbook } from "../../lib/engine/types";
import {
  registerNativeWorkbookDrop,
  workbookFromPath,
} from "../../lib/platform";
import type { WorkflowContext } from "../../machines/workflowMachine";
import styles from "./WorkbenchPage.module.css";

export type WorkflowStatus =
  | "empty"
  | "ready"
  | "processing"
  | "approval"
  | "exporting"
  | "complete"
  | "error";

interface WorkbenchPageProps {
  status: WorkflowStatus;
  context: WorkflowContext;
  onBrowse: () => void;
  onSelectFile: (file: SelectedWorkbook) => void;
  onStart: () => void;
  onApprove: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onReset: () => void;
  onOpenOutput: () => void;
  onRevealOutput: () => void;
}

const workbookMime = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

const hiddenDropInputProps = {
  tabIndex: -1,
  "aria-hidden": true,
} as const;

function formatBytes(bytes?: number): string | null {
  if (!bytes) return null;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function routeState(status: WorkflowStatus): {
  stage: WorkflowStage;
  complete?: boolean;
} {
  if (status === "approval") return { stage: "review" };
  if (status === "exporting") return { stage: "export" };
  if (status === "complete") return { stage: "export", complete: true };
  if (status === "processing" || status === "error") {
    return { stage: "process" };
  }
  return { stage: "workbook" };
}

export function WorkbenchPage(props: WorkbenchPageProps) {
  const { onSelectFile, status } = props;

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void registerNativeWorkbookDrop(onSelectFile).then((value) => {
      unlisten = value;
    });
    return () => unlisten?.();
  }, [onSelectFile]);

  const route = routeState(status);

  return (
    <section
      className={styles.page}
      aria-live={
        status === "processing" || status === "exporting" ? "polite" : undefined
      }
    >
      <WorkflowRoute {...route} />
      {status === "approval" ? <ApprovalView {...props} /> : null}
      {status === "complete" ? <CompleteView {...props} /> : null}
      {status === "error" ? <ErrorView {...props} /> : null}
      {status === "processing" || status === "exporting" ? (
        <ProcessingView {...props} />
      ) : null}
      {status === "empty" || status === "ready" ? (
        <SelectionView {...props} />
      ) : null}
    </section>
  );
}

function SelectionView({
  context,
  onBrowse,
  onSelectFile,
  onStart,
}: WorkbenchPageProps) {
  const { t } = useTranslation();
  const file = context.selectedFile;

  const handleFiles = (files: File[]) => {
    const selected = files[0] as File & { path?: string };
    onSelectFile(
      workbookFromPath(selected.path || selected.name, selected.size),
    );
  };

  return (
    <div className={styles.task}>
      <header className={styles.taskHeader}>
        <Title id="workbench-title" order={1} className={styles.pageTitle}>
          {t("workbench.title")}
        </Title>
        <Text className={styles.subtitle}>{t("workbench.subtitle")}</Text>
      </header>

      {file ? (
        <>
          <div className={styles.fileRow}>
            <IconFileSpreadsheet
              className={styles.fileIcon}
              size={29}
              stroke={1.45}
              aria-hidden="true"
            />
            <div className={styles.fileCopy}>
              <Text fw={520} truncate>
                {file.name}
              </Text>
              {formatBytes(file.size) ? (
                <Text className={styles.monoMeta}>
                  {formatBytes(file.size)}
                </Text>
              ) : null}
            </div>
            <Button variant="subtle" onClick={onBrowse}>
              {t("workbench.replace")}
            </Button>
          </div>

          <Button
            className={styles.primaryAction}
            leftSection={<IconSearch size={23} stroke={1.7} />}
            onClick={onStart}
          >
            {t("workbench.start")}
          </Button>
        </>
      ) : null}

      <Dropzone
        className={`${styles.browseRow} ${file ? "" : styles.browseRowEmpty}`}
        multiple={false}
        accept={workbookMime}
        activateOnClick={false}
        activateOnKeyboard={false}
        onClick={onBrowse}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") onBrowse();
        }}
        onDrop={handleFiles}
        onReject={() => undefined}
        inputProps={hiddenDropInputProps}
        role="button"
        tabIndex={0}
        aria-label={
          file ? t("workbench.browseDifferent") : t("workbench.browse")
        }
      >
        <IconFolder size={25} stroke={1.5} aria-hidden="true" />
        <div>
          <Text fw={500}>
            {file ? t("workbench.browseDifferent") : t("workbench.browse")}
          </Text>
          {!file ? (
            <Text className={styles.supported}>{t("workbench.supported")}</Text>
          ) : null}
        </div>
      </Dropzone>
    </div>
  );
}

function ProcessingView({ status, context, onCancel }: WorkbenchPageProps) {
  const { t } = useTranslation();
  const progress = context.progress;
  const determinate = progress?.current != null && Boolean(progress.total);
  const value = determinate ? (progress.current! / progress.total!) * 100 : 100;

  return (
    <div className={styles.task}>
      <header className={styles.taskHeader}>
        <Title order={1} className={styles.pageTitle}>
          {status === "exporting"
            ? t("workbench.exportingTitle")
            : t("workbench.processingTitle")}
        </Title>
        <Text className={styles.subtitle}>{context.selectedFile?.name}</Text>
      </header>

      <div className={styles.processingPanel}>
        <Text fw={520} size="lg">
          {progress?.message || t("common.loading")}
        </Text>
        <Progress
          value={value}
          animated={!determinate}
          size="sm"
          radius="xl"
          aria-label={progress?.message || t("common.loading")}
        />
        <Group justify="space-between" wrap="nowrap">
          <Text className={styles.monoMeta}>
            {determinate
              ? `${progress.current} / ${progress.total}`
              : t("workbench.working")}
          </Text>
          <Text className={styles.monoMeta}>
            {Math.floor(progress?.elapsed_seconds || 0)}s
          </Text>
        </Group>
      </div>

      <Button
        variant="default"
        className={styles.quietAction}
        onClick={onCancel}
        disabled={status === "exporting" || progress?.cancellable === false}
      >
        {t("workbench.cancel")}
      </Button>
    </div>
  );
}

function ApprovalView({ context, onApprove, onCancel }: WorkbenchPageProps) {
  const { t } = useTranslation();
  const [warningsOpened, warnings] = useDisclosure(false);
  const request = context.approval;
  if (!request) return null;

  const { summary } = request;
  const packageCount = summary.package_counts.length;
  const warningCount = summary.warnings.length;
  const primaryWarning = summary.warnings[0]?.split(";")[0] ?? "";

  return (
    <div className={styles.task}>
      <header className={styles.taskHeader}>
        <Title id="approval-title" order={1} className={styles.pageTitle}>
          {t("approval.title")}
        </Title>
        <Text className={styles.subtitle}>{t("approval.subtitle")}</Text>
      </header>

      <div
        className={styles.summaryBand}
        aria-label={t("approval.summaryLabel")}
      >
        <div className={styles.metric}>
          <Text className={styles.metricValue}>{summary.total_items}</Text>
          <Text className={styles.metricLabel}>{t("approval.items")}</Text>
        </div>
        <div className={styles.metric}>
          <Text className={styles.metricValue}>{packageCount}</Text>
          <Text className={styles.metricLabel}>{t("approval.packages")}</Text>
        </div>
        <div className={styles.metric}>
          <Text className={styles.metricValue}>{warningCount}</Text>
          <Text className={styles.metricLabel}>
            {warningCount === 1
              ? t("approval.warning")
              : t("approval.warnings")}
          </Text>
        </div>
      </div>

      <div className={`${styles.statusRow} ${styles.statusSuccess}`}>
        <IconCheck size={22} stroke={2} aria-hidden="true" />
        <Text>{t("approval.coverage", { count: summary.total_items })}</Text>
      </div>

      {warningCount ? (
        <div className={`${styles.statusRow} ${styles.statusWarning}`}>
          <IconAlertTriangle size={22} stroke={1.8} aria-hidden="true" />
          <Text className={styles.statusCopy}>{primaryWarning}</Text>
          <Button variant="subtle" color="yellow" onClick={warnings.open}>
            {t("approval.reviewWarning")}
          </Button>
        </div>
      ) : null}

      <Accordion className={styles.disclosure} variant="contained">
        <Accordion.Item value="packages">
          <Accordion.Control>{t("approval.viewPackages")}</Accordion.Control>
          <Accordion.Panel>
            <ul className={styles.packageList}>
              {summary.package_counts.map(([name, count]) => (
                <li key={name}>
                  <Text size="sm">{name}</Text>
                  <Text className={styles.monoCount}>{count}</Text>
                </li>
              ))}
            </ul>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      <div className={styles.actionBar}>
        <div className={styles.runMeta}>
          <IconFileSpreadsheet size={18} stroke={1.5} aria-hidden="true" />
          <span>{summary.source_filename}</span>
          <span aria-hidden="true">·</span>
          <span>{summary.provider}</span>
          <span aria-hidden="true">·</span>
          <span>{summary.model}</span>
        </div>
        <Group wrap="nowrap">
          <Button
            variant="default"
            className={styles.secondaryAction}
            onClick={onCancel}
          >
            {t("workbench.cancel")}
          </Button>
          <Button className={styles.generateAction} onClick={onApprove}>
            {t("approval.approve")}
          </Button>
        </Group>
      </div>

      <Drawer
        opened={warningsOpened}
        onClose={warnings.close}
        title={t("approval.warnings")}
        position="right"
        size="md"
        closeButtonProps={{ "aria-label": t("common.close") }}
      >
        <Stack component="ul" gap="md" className={styles.warningList}>
          {summary.warnings.map((warning) => (
            <Text component="li" key={warning}>
              {warning}
            </Text>
          ))}
        </Stack>
      </Drawer>
    </div>
  );
}

function CompleteView({
  context,
  onOpenOutput,
  onRevealOutput,
  onReset,
}: WorkbenchPageProps) {
  const { t } = useTranslation();
  const outputSegments = context.outputPath?.split(/[\\/]/);
  const outputName = outputSegments?.[outputSegments.length - 1];

  return (
    <div className={styles.centered} aria-live="polite">
      <span className={styles.completeIcon}>
        <IconCheck size={34} stroke={2} aria-hidden="true" />
      </span>
      <Title order={1} className={styles.pageTitle}>
        {t("complete.title")}
      </Title>
      <Text className={styles.subtitle}>{t("complete.subtitle")}</Text>
      <Text className={styles.outputName}>{outputName}</Text>
      <Group mt="xl">
        <Button
          leftSection={<IconFileSpreadsheet size={18} />}
          onClick={onOpenOutput}
        >
          {t("complete.open")}
        </Button>
        <Button
          variant="default"
          leftSection={<IconFolder size={18} />}
          onClick={onRevealOutput}
        >
          {t("complete.reveal")}
        </Button>
        <Button
          variant="subtle"
          leftSection={<IconRefresh size={18} />}
          onClick={onReset}
        >
          {t("complete.another")}
        </Button>
      </Group>
    </div>
  );
}

function ErrorView({ context, onRetry, onReset }: WorkbenchPageProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.task} aria-live="assertive">
      <header className={styles.taskHeader}>
        <Title order={1} className={styles.pageTitle}>
          {t("workbench.errorTitle")}
        </Title>
        <Text className={styles.subtitle}>{t("workbench.errorSubtitle")}</Text>
      </header>
      <div className={`${styles.statusRow} ${styles.statusError}`}>
        <IconAlertTriangle size={22} stroke={1.8} aria-hidden="true" />
        <Text className={styles.statusCopy}>{context.error}</Text>
      </div>
      <Group mt="xl">
        <Button onClick={onRetry}>{t("workbench.retry")}</Button>
        <Button variant="default" onClick={onReset}>
          {t("workbench.reset")}
        </Button>
      </Group>
    </div>
  );
}
