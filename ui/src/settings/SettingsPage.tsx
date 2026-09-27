import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError, explain, type Connection, type Provider } from "../api/client";
import { useSettings } from "../app/settings";
import type { Key } from "../i18n";
import { PROVIDERS, useAddConnection, useCheckModel, useConnections, useModels, useRemoveConnection } from "./queries";

const field = "h-9 rounded-lg border border-line bg-page px-3 outline-none focus:border-ink";
const quiet = "h-9 rounded-lg border border-line px-3.5 disabled:opacity-50";
const primary = "h-9 rounded-lg bg-button px-4 font-semibold text-button-ink disabled:opacity-40";

export function SettingsPage() {
  const { t, language, theme, change } = useSettings();

  return (
    <div className="mx-auto flex max-w-[760px] flex-col px-4 pt-5 pb-10">
      <h1 className="mb-2 text-[28px] font-light tracking-[-0.01em]">{t("settings.title")}</h1>
      <Row label={t("settings.language")}>
        <Choice
          label={t("settings.language")}
          value={language}
          options={[
            { value: "en", label: "English", lang: "en" },
            { value: "ar", label: "العربية", lang: "ar" },
          ]}
          onChange={(value) => void change({ language: value })}
        />
      </Row>
      <Row label={t("settings.theme")}>
        <Choice
          label={t("settings.theme")}
          value={theme}
          options={(["system", "light", "dark"] as const).map((value) => ({ value, label: t(`theme.${value}` as Key) }))}
          onChange={(value) => void change({ theme: value })}
        />
      </Row>
      <Row label={t("settings.ai")}>
        <TawreedsAI />
      </Row>

      <h2 className="mt-6 mb-1 text-[13px] font-normal text-ink-2">{t("settings.connections")}</h2>
      <Connections />
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-b border-line-soft py-2.5">
      <span className="w-40 shrink-0 font-semibold">{label}</span>
      {children}
    </div>
  );
}

/** A small segmented choice: one pressed button per option. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; lang?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex overflow-hidden rounded-lg border border-line">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          lang={option.lang}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={`px-3.5 py-0.5 ${option.value === value ? "bg-subtle font-semibold text-ink" : "text-ink-2 hover:text-ink"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function connectionName(connection: Connection, t: ReturnType<typeof useSettings>["t"]): string {
  return connection.provider === "openai_compatible" ? connection.label : t(`provider.${connection.provider}` as Key);
}

/** Which checked model Tawreed works with. Only models that passed their check are offered. */
function TawreedsAI() {
  const { t, ai, change } = useSettings();
  const connections = useConnections();
  const [error, setError] = useState<unknown>(null);
  const choices = (connections.data ?? []).flatMap((connection) =>
    Object.entries(connection.checks)
      .filter(([, check]) => check.ok)
      .map(([model]) => ({ connection_id: connection.id, model, label: `${model} · ${connectionName(connection, t)}` })),
  );

  if (choices.length === 0) return <span className="text-ink-2">{t("settings.aiNone")}</span>;
  const current = ai ? JSON.stringify([ai.connection_id, ai.model]) : "";
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <select
        aria-label={t("settings.ai")}
        value={current}
        onChange={async (event) => {
          const [connection_id, model] = JSON.parse(event.target.value) as [string, string];
          setError(await change({ ai: { connection_id, model } }));
        }}
        className={field}
      >
        <option value="" disabled>
          {t("settings.aiChoose")}
        </option>
        {choices.map((choice) => (
          <option key={`${choice.connection_id}|${choice.model}`} value={JSON.stringify([choice.connection_id, choice.model])}>
            {choice.label}
          </option>
        ))}
      </select>
      {error ? (
        <p role="alert" className="text-danger">
          {explain(error, t)}
        </p>
      ) : null}
    </div>
  );
}

function Connections() {
  const { t } = useSettings();
  const connections = useConnections();
  return (
    <>
      {connections.isError && (
        <p role="alert" className="text-danger">
          {explain(connections.error, t)}
        </p>
      )}
      {connections.data?.length === 0 && <p className="py-2 text-ink-2">{t("settings.noConnections")}</p>}
      {connections.data?.map((connection) => <ConnectionRow key={connection.id} connection={connection} />)}
      <AddConnection />
      <p className="mt-3 text-[13px] text-ink-2">{t("settings.keysNote")}</p>
    </>
  );
}

function ConnectionRow({ connection }: { connection: Connection }) {
  const { t } = useSettings();
  const models = useModels(connection.id);
  const check = useCheckModel(connection.id);
  const remove = useRemoveConnection();
  const [model, setModel] = useState("");
  const result = model ? connection.checks[model] : undefined;
  const name = connectionName(connection, t);

  return (
    <section aria-label={name} className="flex flex-col gap-2 border-b border-line-soft py-3">
      <div className="flex items-center gap-4">
        <span className="w-40 shrink-0 font-semibold">{name}</span>
        <span className="flex-1 text-sm text-ink-2">{t("connection.key", { hint: connection.key_hint })}</span>
        <button type="button" onClick={() => remove.mutate(connection.id)} disabled={remove.isPending} className={quiet}>
          {t("connection.remove")}
        </button>
      </div>
      <div className="flex items-center gap-2 ps-44">
        {models.data && models.data.length > 0 ? (
          <select aria-label={t("connection.model")} value={model} onChange={(e) => setModel(e.target.value)} className={`${field} min-w-0 flex-1`}>
            <option value="">{t("connection.chooseModel")}</option>
            {models.data.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <input
            aria-label={t("connection.model")}
            value={model}
            dir="ltr"
            onChange={(e) => setModel(e.target.value.trim())}
            placeholder={models.isPending ? t("connection.loadingModels") : t("connection.modelName")}
            className={`${field} min-w-0 flex-1`}
          />
        )}
        <button type="button" disabled={!model || check.isPending} onClick={() => check.mutate(model)} className={quiet}>
          {check.isPending ? t("connection.checking") : t("connection.check")}
        </button>
      </div>
      <div className="flex flex-col gap-1 ps-44 text-sm">
        {check.isPending && <p className="text-ink-2">{t("connection.checkingNote")}</p>}
        {(models.isError || check.isError || remove.isError) && (
          <p role="alert" className="text-danger">
            {explain(models.error ?? check.error ?? remove.error, t)}
          </p>
        )}
        {result && !check.isPending && (
          <p className={`flex items-start gap-1.5 ${result.ok ? "text-ink-2" : "text-danger"}`}>
            <span className={`mt-[7px] size-1.5 shrink-0 rounded-full ${result.ok ? "bg-ink" : "bg-danger"}`} aria-hidden="true" />
            {result.ok
              ? `${t("check.works")} ${result.sees_images ? t("check.sees") : t("check.blind")}`
              : explain(new ApiError(result.problem ?? "unknown"), t)}
          </p>
        )}
      </div>
    </section>
  );
}

function AddConnection() {
  const { t } = useSettings();
  const add = useAddConnection();
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [address, setAddress] = useState("");
  const needsAddress = provider === "openai_compatible";

  function submit(event: FormEvent) {
    event.preventDefault();
    add.mutate(
      { provider, api_key: key.trim(), base_url: needsAddress ? address.trim() : null },
      {
        onSuccess: () => {
          setKey("");
          setAddress("");
          setShowKey(false);
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5 pt-4">
      <h3 className="text-[13px] font-normal text-ink-2">{t("add.title")}</h3>
      <fieldset className="flex flex-wrap gap-1.5">
        <legend className="sr-only">{t("add.service")}</legend>
        {PROVIDERS.map((id) => (
          <label
            key={id}
            className="flex h-9 cursor-pointer items-center rounded-lg border border-line px-3 text-ink-2 hover:text-ink has-checked:border-ink has-checked:bg-subtle has-checked:font-semibold has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-ink"
          >
            <input
              type="radio"
              name="provider"
              value={id}
              checked={provider === id}
              onChange={() => setProvider(id)}
              className="sr-only"
            />
            {t(`provider.${id}` as Key)}
          </label>
        ))}
      </fieldset>
      {/* Keys read left to right in either language, so the field and its eye button do too. */}
      <div className="relative flex" dir="ltr">
        <input
          aria-label={t("add.key")}
          type={showKey ? "text" : "password"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={t("add.key")}
          autoComplete="off"
          spellCheck={false}
          className={`${field} min-w-0 flex-1 pe-10`}
        />
        <button
          type="button"
          aria-label={showKey ? t("add.hide") : t("add.show")}
          aria-pressed={showKey}
          onClick={() => setShowKey(!showKey)}
          className="absolute inset-y-0 end-0 flex w-10 items-center justify-center text-ink-2 hover:text-ink"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            {showKey && <path d="M4 4l16 16" />}
          </svg>
        </button>
      </div>
      {needsAddress && (
        <input
          aria-label={t("add.address")}
          value={address}
          dir="ltr"
          onChange={(e) => setAddress(e.target.value)}
          placeholder="https://api.example.com/v1"
          className={field}
        />
      )}
      {add.isError && (
        <p role="alert" className="text-danger">
          {explain(add.error, t)}
        </p>
      )}
      <button
        type="submit"
        disabled={!key.trim() || (needsAddress && !address.trim()) || add.isPending}
        className={`${primary} self-start`}
      >
        {add.isPending ? t("add.checking") : t("add.submit")}
      </button>
    </form>
  );
}
