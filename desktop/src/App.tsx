import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Center, Loader } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { isTauri } from "@tauri-apps/api/core";
import { useMachine } from "@xstate/react";
import { useTranslation } from "react-i18next";

import { NavigationRail, type AppPage } from "./components/NavigationRail";
import type { WorkflowStatus } from "./features/workbench/WorkbenchPage";
import { engineClient } from "./lib/engine/client";
import {
  approvalRequestSchema,
  historySchema,
  modelCatalogSchema,
  progressSchema,
  settingsSchema,
} from "./lib/engine/schemas";
import type {
  AppSettings,
  EngineMessage,
  HistoryEntry,
  ModelCatalog,
  Provider,
  SelectedWorkbook,
} from "./lib/engine/types";
import { chooseWorkbook, openOutput, revealOutput } from "./lib/platform";
import { workflowMachine } from "./machines/workflowMachine";
import styles from "./App.module.css";

const RunsPage = lazy(() =>
  import("./features/runs/RunsPage").then((module) => ({
    default: module.RunsPage,
  })),
);
const WorkbenchPage = lazy(() =>
  import("./features/workbench/WorkbenchPage").then((module) => ({
    default: module.WorkbenchPage,
  })),
);
const SettingsPage = lazy(() =>
  import("./features/settings/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);
function settingsPayload(settings: AppSettings) {
  return {
    provider: settings.provider,
    model: settings.model,
    model_id: settings.model,
    base_url: settings.base_url,
    language: settings.language,
    theme: settings.theme,
  };
}

interface AppProps {
  onColorSchemeChange: (colorScheme: "auto" | "dark" | "light") => void;
}

export default function App({ onColorSchemeChange }: AppProps) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState<AppPage>("workbench");
  const [workflow, send] = useMachine(workflowMachine);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const previewFileLoaded = useRef(false);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const value = await engineClient.request<unknown>("get_history");
      setHistory(historySchema.parse(value));
    } catch (error) {
      notifications.show({
        color: "red",
        title: t("common.error"),
        message: String(error),
      });
    } finally {
      setHistoryLoading(false);
    }
  }, [t]);

  const handleEngineMessage = useCallback(
    (message: EngineMessage) => {
      if (message.kind === "progress") {
        const progress = progressSchema.safeParse(message.payload);
        if (progress.success)
          send({ type: "PROGRESS", progress: progress.data });
      } else if (message.kind === "approval_required") {
        const request = approvalRequestSchema.safeParse(message.payload);
        if (request.success)
          send({ type: "APPROVAL_REQUIRED", request: request.data });
      } else if (
        message.kind === "completed" &&
        typeof message.payload === "string"
      ) {
        send({ type: "COMPLETE", outputPath: message.payload });
        void refreshHistory();
      } else if (message.kind === "run_error") {
        const text =
          typeof message.payload === "string"
            ? message.payload
            : t("common.error");
        send({ type: "FAIL", message: text });
      } else if (message.kind === "cancelled") {
        send({ type: "CANCEL" });
      }
    },
    [refreshHistory, send, t],
  );

  useEffect(() => {
    const unsubscribe = engineClient.subscribe(handleEngineMessage);
    void engineClient
      .initialize()
      .then(async () => {
        const [settingsValue, historyValue] = await Promise.all([
          engineClient.request<unknown>("get_settings"),
          engineClient.request<unknown>("get_history"),
        ]);
        setSettings(settingsSchema.parse(settingsValue));
        setHistory(historySchema.parse(historyValue));
      })
      .catch((error: unknown) => {
        notifications.show({
          color: "red",
          title: t("common.error"),
          message: String(error),
        });
      });
    return unsubscribe;
  }, [handleEngineMessage, t]);

  useEffect(() => {
    if (!settings) return;
    onColorSchemeChange(settings.theme === "system" ? "auto" : settings.theme);
    if (i18n.resolvedLanguage !== settings.language) {
      void i18n.changeLanguage(settings.language);
    }
    document.documentElement.dir = settings.language === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = settings.language;
  }, [i18n, onColorSchemeChange, settings]);

  const selectFile = useCallback(
    (file: SelectedWorkbook) => {
      if (!file.name.toLowerCase().endsWith(".xlsx")) {
        notifications.show({
          color: "red",
          message: "Select an .xlsx workbook.",
        });
        return;
      }
      send({ type: "SELECT_FILE", file });
      setPage("workbench");
    },
    [send],
  );

  const browse = useCallback(async () => {
    const file = await chooseWorkbook();
    if (file) selectFile(file);
  }, [selectFile]);

  useEffect(() => {
    if (previewFileLoaded.current || !import.meta.env.DEV || isTauri()) return;
    if (
      new URLSearchParams(window.location.search).get("preview") !== "workflow"
    )
      return;

    const timeout = window.setTimeout(() => {
      if (previewFileLoaded.current) return;
      previewFileLoaded.current = true;
      selectFile({
        path: "C:/browser-preview/BOQ_Master.xlsx",
        name: "BOQ_Master.xlsx",
        size: 42_680,
      });
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [selectFile]);

  const startRun = useCallback(
    async (retry = false) => {
      const file = workflow.context.selectedFile;
      if (!file) return;
      send({ type: retry ? "RETRY" : "START" });
      try {
        await engineClient.request("start_run", { file_path: file.path });
      } catch (error) {
        send({ type: "FAIL", message: String(error) });
      }
    },
    [send, workflow.context.selectedFile],
  );

  const approve = useCallback(async () => {
    const token = workflow.context.approval?.token;
    if (!token) return;
    send({ type: "APPROVE" });
    try {
      await engineClient.request("approve_run", { token });
    } catch (error) {
      send({ type: "FAIL", message: String(error) });
    }
  }, [send, workflow.context.approval?.token]);

  const cancel = useCallback(async () => {
    send({ type: "CANCEL" });
    try {
      await engineClient.cancelRun();
    } catch (error) {
      notifications.show({ color: "red", message: String(error) });
    }
  }, [send]);

  const saveSettings = useCallback(
    async (next: AppSettings, apiKey?: string) => {
      setSettingsBusy(true);
      try {
        if (apiKey) {
          await engineClient.request("set_api_key", {
            provider: next.provider,
            api_key: apiKey,
          });
        }
        const value = await engineClient.request<unknown>("save_settings", {
          settings: settingsPayload(next),
        });
        setSettings(settingsSchema.parse(value));
        notifications.show({ color: "green", message: t("settings.saved") });
      } catch (error) {
        notifications.show({
          color: "red",
          title: t("common.error"),
          message: String(error),
        });
      } finally {
        setSettingsBusy(false);
      }
    },
    [t],
  );

  const refreshModels = useCallback(
    async (provider: Provider, baseUrl: string) => {
      setSettingsBusy(true);
      try {
        const value = await engineClient.request<unknown>("refresh_models", {
          provider,
          base_url: baseUrl,
        });
        setCatalog(modelCatalogSchema.parse(value));
      } catch (error) {
        notifications.show({
          color: "red",
          title: t("common.error"),
          message: String(error),
        });
      } finally {
        setSettingsBusy(false);
      }
    },
    [t],
  );

  const testConnection = useCallback(
    async (provider: Provider, model: string, baseUrl: string) => {
      setSettingsBusy(true);
      try {
        const result = await engineClient.request<{
          success: boolean;
          message: string;
        }>("test_connection", { provider, model, base_url: baseUrl });
        notifications.show({
          color: result.success ? "green" : "red",
          message: result.message,
        });
      } catch (error) {
        notifications.show({
          color: "red",
          title: t("common.error"),
          message: String(error),
        });
      } finally {
        setSettingsBusy(false);
      }
    },
    [t],
  );

  const deleteHistory = useCallback(
    async (id: number) => {
      try {
        await engineClient.request("delete_history", { id });
        setHistory((current) => current.filter((entry) => entry.id !== id));
      } catch (error) {
        notifications.show({
          color: "red",
          title: t("common.error"),
          message: String(error),
        });
      }
    },
    [t],
  );

  const outputPath = workflow.context.outputPath;
  const workflowStatus = workflow.value as WorkflowStatus;

  return (
    <div className={styles.shell}>
      <NavigationRail active={page} onNavigate={setPage} />
      <main className={styles.main}>
        <Suspense
          fallback={
            <Center h={320}>
              <Loader aria-label={t("common.loading")} />
            </Center>
          }
        >
          {page === "workbench" ? (
            <WorkbenchPage
              status={workflowStatus}
              context={workflow.context}
              onBrowse={browse}
              onSelectFile={selectFile}
              onStart={() => void startRun()}
              onApprove={() => void approve()}
              onCancel={() => void cancel()}
              onRetry={() => void startRun(true)}
              onReset={() => send({ type: "RESET" })}
              onOpenOutput={() => outputPath && void openOutput(outputPath)}
              onRevealOutput={() => outputPath && void revealOutput(outputPath)}
            />
          ) : null}
          {page === "runs" ? (
            <RunsPage
              history={history}
              loading={historyLoading}
              onRefresh={() => void refreshHistory()}
              onOpen={(path) => void openOutput(path)}
              onReveal={(path) => void revealOutput(path)}
              onDelete={(id) => void deleteHistory(id)}
            />
          ) : null}
          {page === "settings" ? (
            <SettingsPage
              settings={settings}
              catalog={catalog}
              busy={settingsBusy}
              onSave={saveSettings}
              onRefreshModels={refreshModels}
              onTestConnection={testConnection}
            />
          ) : null}
        </Suspense>
      </main>
    </div>
  );
}
