import { useRef, useState } from "react";
import { explain, type Project, type Source } from "../api/client";
import { ago, size } from "../app/format";
import { useSettings } from "../app/settings";
import type { Key, Translate } from "../i18n";
import { DropRegion, PickFiles } from "./files";
import { isReading, useAddFiles, useProject, useRename } from "./queries";
import { SourcePreview } from "./SourcePreview";

const STEPS = ["read", "plan", "place", "check", "publish"] as const;

export function ProjectView({
  projectId,
  onClose,
  onOpenSettings,
}: {
  projectId: string;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const { t, locale, ai } = useSettings();
  const project = useProject(projectId);
  const add = useAddFiles(projectId);
  const [open, setOpen] = useState<string | null>(null); // the file being previewed

  if (project.isError) {
    return (
      <p role="alert" className="mx-auto max-w-[880px] px-4 pt-6 text-danger">
        {explain(project.error, t)}
      </p>
    );
  }
  if (!project.data) return null;
  const { data } = project;
  const current = isReading(data) ? "read" : null; // the agent reports the later steps

  return (
    <DropRegion onFiles={(files) => add.mutate(files)} className="min-h-full">
      {(over) => (
        <div className={`mx-auto flex max-w-[880px] flex-col gap-4 px-4 pt-6 pb-10 ${over ? "opacity-60" : ""}`}>
          <div className="flex items-center gap-3">
            <ProjectName project={data} />
            <span className="shrink-0 rounded-full border border-line px-2.5 text-[13px] text-ink-2">
              {t("project.files", { count: data.sources.length })}
            </span>
            <div className="flex-1" />
            <PickFiles
              onFiles={(files) => add.mutate(files)}
              disabled={add.isPending}
              className="shrink-0 rounded-lg border border-line px-3.5 py-1 text-sm disabled:opacity-50"
            >
              {t("project.add")}
            </PickFiles>
            <button
              type="button"
              aria-label={t("project.close")}
              onClick={onClose}
              className="shrink-0 rounded-lg border border-line p-1.5 text-ink-2 hover:text-ink"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <ol aria-label={t("steps.label")} className="flex flex-wrap items-center gap-2.5 text-sm text-ink-2">
            {STEPS.map((step, index) => (
              <li key={step} aria-current={step === current ? "step" : undefined} className="group flex items-center gap-2.5">
                <span className="flex items-center gap-1.5 group-aria-[current]:text-ink">
                  <span className="size-[7px] rounded-full bg-idle group-aria-[current]:bg-ink group-aria-[current]:animate-pulse" aria-hidden="true" />
                  {t(`step.${step}` as Key)}
                </span>
                {index < STEPS.length - 1 && <span className="h-px w-6 bg-line" aria-hidden="true" />}
              </li>
            ))}
          </ol>

          {!ai && (
            <div className="flex items-center gap-4 rounded-xl border border-amber-line bg-amber-soft px-4 py-2.5 text-amber">
              <p className="flex-1">{t("project.noAi")}</p>
              <button type="button" onClick={onOpenSettings} className="shrink-0 font-semibold underline">
                {t("project.openSettings")}
              </button>
            </div>
          )}

          {add.isError && (
            <p role="alert" className="text-danger">
              {explain(add.error, t)}
            </p>
          )}

          <ul className="flex flex-col">
            {data.sources.map((source) => {
              const opened = open === source.id && source.status === "read";
              return (
                <li key={source.id} className="flex flex-col gap-3 border-t border-line-soft py-2.5">
                  <div className="flex items-center gap-4">
                    {source.status === "read" ? (
                      <button
                        type="button"
                        aria-expanded={opened}
                        onClick={() => setOpen(opened ? null : source.id)}
                        className="min-w-0 flex-1 truncate text-start [unicode-bidi:plaintext] hover:underline rtl:text-right"
                      >
                        {source.filename}
                      </button>
                    ) : (
                      <span className="min-w-0 flex-1 truncate [unicode-bidi:plaintext] rtl:text-right">
                        {source.filename}
                      </span>
                    )}
                    <span className="text-sm text-ink-2">{t(`kind.${source.kind}` as Key)}</span>
                    <SourceStatus source={source} />
                    <span className="w-20 text-end text-sm text-ink-2">{size(source.size, locale)}</span>
                    <span className="w-28 text-end text-sm text-ink-2">{ago(source.added_at, locale)}</span>
                  </div>
                  {source.status === "failed" && <p className="text-sm text-danger">{problem(source, t)}</p>}
                  {opened && <SourcePreview projectId={projectId} sourceId={source.id} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </DropRegion>
  );
}

/** Where reading a file has got to: waiting or reading, how many sheets or pages, or that it failed. */
function SourceStatus({ source }: { source: Source }) {
  const { t } = useSettings();
  const text =
    source.status === "failed"
      ? t("source.failed")
      : source.status === "read"
        ? t(source.kind === "spreadsheet" || source.kind === "csv" ? "source.sheets" : "source.pages", {
            count: source.page_count,
          })
        : t("source.reading");
  return <span className={`w-24 text-end text-sm ${source.status === "failed" ? "text-danger" : "text-ink-2"}`}>{text}</span>;
}

/** Why a file couldn't be read, in a sentence that says what to do about it. */
function problem(source: Source, t: Translate): string {
  const key = `problem.${source.problem}` as Key;
  return t(key) !== key ? t(key) : t("problem.unreadable_file");
}

/** The project's name as an editable heading. Enter or leaving the field saves; Escape undoes. */
function ProjectName({ project }: { project: Project }) {
  const { t } = useSettings();
  const rename = useRename(project.id);
  const [name, setName] = useState(project.name);
  const undoing = useRef(false); // Escape blurs the field, and leaving the field must not save then

  const save = () => {
    if (undoing.current) {
      undoing.current = false;
      return;
    }
    const trimmed = name.trim();
    setName(trimmed || project.name);
    if (trimmed && trimmed !== project.name) rename.mutate(trimmed, { onError: () => setName(project.name) });
  };

  return (
    <input
      aria-label={t("project.rename")}
      value={name}
      dir="auto"
      maxLength={200}
      onChange={(event) => setName(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          undoing.current = true;
          setName(project.name);
          event.currentTarget.blur();
        }
      }}
      className="field-sizing-content min-w-0 max-w-full -mx-1 rounded-md border border-transparent bg-transparent px-1 text-[28px] font-light tracking-[-0.01em] hover:border-line focus:border-line focus:outline-none"
    />
  );
}
