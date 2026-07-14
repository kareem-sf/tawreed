import { useEffect, useState } from "react";
import {
  Accordion,
  Button,
  Center,
  Group,
  Loader,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import {
  IconActivityHeartbeat,
  IconLock,
  IconRefresh,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import type {
  AppSettings,
  ModelCatalog,
  Provider,
} from "../../lib/engine/types";
import { AboutPage } from "../about/AboutPage";
import styles from "./SettingsPage.module.css";

interface SettingsPageProps {
  settings: AppSettings | null;
  catalog: ModelCatalog | null;
  busy: boolean;
  onSave: (settings: AppSettings, apiKey?: string) => Promise<void>;
  onRefreshModels: (provider: Provider, baseUrl: string) => Promise<void>;
  onTestConnection: (
    provider: Provider,
    model: string,
    baseUrl: string,
  ) => Promise<void>;
}

type SettingsSection = "connection" | "appearance" | "about";

const providers: Provider[] = [
  "Codex",
  "OpenAI",
  "Claude",
  "Google",
  "OpenAI Compatible",
];

const defaultSettings: AppSettings = {
  provider: "Codex",
  model: "",
  base_url: "",
  language: "en",
  theme: "system",
  has_api_key: false,
};

const sections: SettingsSection[] = ["connection", "appearance", "about"];

export function SettingsPage({
  settings,
  catalog,
  busy,
  onSave,
  onRefreshModels,
  onTestConnection,
}: SettingsPageProps) {
  const { t } = useTranslation();
  const [section, setSection] = useState<SettingsSection>("connection");
  const [apiKey, setApiKey] = useState("");
  const form = useForm<AppSettings>({
    initialValues: settings ?? defaultSettings,
  });
  const { setValues } = form;

  useEffect(() => {
    if (settings) setValues(settings);
  }, [setValues, settings]);

  const modelOptions = catalog?.models.length
    ? catalog.models
    : form.values.model
      ? [form.values.model]
      : [];

  const submit = form.onSubmit(async (values) => {
    await onSave(values, apiKey.trim() || undefined);
    setApiKey("");
  });

  return (
    <section className={styles.page} aria-labelledby="settings-title">
      <Title id="settings-title" order={1} className={styles.pageTitle}>
        {t("settings.title")}
      </Title>

      <form onSubmit={submit}>
        <div className={styles.workspace}>
          <nav
            className={styles.sectionNav}
            aria-label={t("settings.sectionsLabel")}
          >
            {sections.map((item) => (
              <UnstyledButton
                key={item}
                className={styles.sectionLink}
                type="button"
                data-active={section === item || undefined}
                aria-current={section === item ? "page" : undefined}
                onClick={() => setSection(item)}
              >
                {t(`settings.sections.${item}`)}
              </UnstyledButton>
            ))}
          </nav>

          <div className={styles.content}>
            {!settings ? (
              <Center h={260}>
                <Loader size="sm" aria-label={t("common.loading")} />
              </Center>
            ) : null}

            {settings && section === "connection" ? (
              <Stack gap={26} className={styles.fields}>
                <Select
                  label={t("settings.provider")}
                  data={providers}
                  allowDeselect={false}
                  {...form.getInputProps("provider")}
                />
                <Select
                  searchable
                  allowDeselect={false}
                  label={t("settings.model")}
                  data={modelOptions}
                  value={form.values.model}
                  onChange={(value) => form.setFieldValue("model", value ?? "")}
                />

                <Group className={styles.primaryActions}>
                  <Button
                    type="button"
                    variant="default"
                    leftSection={
                      <IconActivityHeartbeat size={18} stroke={1.6} />
                    }
                    loading={busy}
                    onClick={() =>
                      onTestConnection(
                        form.values.provider,
                        form.values.model,
                        form.values.base_url,
                      )
                    }
                  >
                    {t("settings.test")}
                  </Button>
                  <Button type="submit" loading={busy}>
                    {t("settings.save")}
                  </Button>
                </Group>

                <Accordion className={styles.advanced} variant="contained">
                  <Accordion.Item value="advanced">
                    <Accordion.Control>
                      {t("settings.advanced")}
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="lg">
                        <TextInput
                          label={t("settings.baseUrl")}
                          placeholder="https://api.example.com/v1"
                          disabled={
                            form.values.provider !== "OpenAI Compatible"
                          }
                          {...form.getInputProps("base_url")}
                        />
                        <PasswordInput
                          label={t("settings.apiKey")}
                          description={
                            settings.has_api_key
                              ? t("settings.apiKeyStored")
                              : t("settings.apiKeyDescription")
                          }
                          placeholder={
                            form.values.provider === "Codex"
                              ? t("settings.apiKeyNotRequired")
                              : t("settings.apiKeyPlaceholder")
                          }
                          value={apiKey}
                          onChange={(event) =>
                            setApiKey(event.currentTarget.value)
                          }
                          disabled={form.values.provider === "Codex"}
                          autoComplete="new-password"
                        />
                        <Group justify="space-between" align="center">
                          {catalog?.error ? (
                            <Text
                              c={catalog.source === "error" ? "red" : "dimmed"}
                              size="sm"
                            >
                              {catalog.error}
                            </Text>
                          ) : (
                            <span />
                          )}
                          <Button
                            type="button"
                            variant="subtle"
                            leftSection={<IconRefresh size={17} />}
                            loading={busy}
                            onClick={() =>
                              onRefreshModels(
                                form.values.provider,
                                form.values.base_url,
                              )
                            }
                          >
                            {t("settings.refreshModels")}
                          </Button>
                        </Group>
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>

                <div className={styles.securityNote}>
                  <IconLock size={18} stroke={1.55} aria-hidden="true" />
                  <Text size="sm">{t("settings.secretNote")}</Text>
                </div>
              </Stack>
            ) : null}

            {settings && section === "appearance" ? (
              <Stack gap={26} className={styles.fields}>
                <Title order={2} className={styles.sectionTitle}>
                  {t("settings.appearance")}
                </Title>
                <Select
                  label={t("settings.theme")}
                  data={[
                    { value: "system", label: t("common.system") },
                    { value: "dark", label: t("common.dark") },
                    { value: "light", label: t("common.light") },
                  ]}
                  allowDeselect={false}
                  {...form.getInputProps("theme")}
                />
                <Select
                  label={t("settings.language")}
                  data={[
                    { value: "en", label: t("common.english") },
                    { value: "ar", label: t("common.arabic") },
                  ]}
                  allowDeselect={false}
                  {...form.getInputProps("language")}
                />
                <Group className={styles.primaryActions}>
                  <Button type="submit" loading={busy}>
                    {t("settings.save")}
                  </Button>
                </Group>
              </Stack>
            ) : null}

            {settings && section === "about" ? <AboutPage /> : null}
          </div>
        </div>
      </form>
    </section>
  );
}
