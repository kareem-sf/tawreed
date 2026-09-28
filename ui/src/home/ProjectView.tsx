import { useRef, useState } from "react";
import { explain, type Project, type Source, type Work } from "../api/client";
import { ago, size } from "../app/format";
import { useSettings } from "../app/settings";
import type { Key, Translate } from "../i18n";
import { DecisionCard } from "../work/DecisionCard";
import { Packages } from "../work/Packages";
import { Published, Revisions } from "../work/Revisions";
import { History, Status } from "../work/Status";
import { useRun, useWork } from "../work/queries";
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
  const { t, ai } = useSettings();
  const project = useProject(projectId);
  const work = useWork(projectId);
  const add = useAddFiles(projectId);
  const [view, setView] = useState<"work" | "packages">("work");

  if (project.isError) {
    return (
      <p role="alert" className="mx-auto max-w-[880px] px-4 pt-6 text-danger">
        {explain(project.error, t)}
      </p>
    );
  }
  if (!project.data) return null;
  const { data } = project;
  const stage = work.data?.stage ?? (isReading(data) ? "read" : null);
  const [decision, ...more] = work.data?.decisions ?? [];

  return (
    <DropRegion onFiles={(files) => add.mutate(files)} className="min-h-full">
      {(over) => (
        <div className={`mx-auto flex max-w-[880px] flex-col gap-5 px-4 pt-6 pb-10 ${over ? "opacity-60" : ""}`}>
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

          <Steps stage={stage} working={work.data?.run.state === "running"} />
          {work.data && <Status projectId={projectId} run={work.data.run} />}

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
          {work.isError && (
            <p role="alert" className="text-danger">
              {explain(work.error, t)}
            </p>
          )}

          {view === "packages" ? (
            <Packages projectId={projectId} onBack={() => setView("work")} />
          ) : (
            <>
              {decision && work.data && (
                <DecisionCard key={decision.id} projectId={projectId} decision={decision} more={more.length} work={work.data} />
              )}
              {stage === "check" && !decision && work.data?.run.state !== "running" && <ReadyToPublish projectId={projectId} />}
              {stage === "published" && work.data?.published && (
                <Published projectId={projectId} projectName={data.name} revision={work.data.published} />
              )}
              {work.data && <History answered={work.data.answered} />}
              {work.data && work.data.packages.length > 0 && (
                <PackageSummary work={work.data} onOpen={() => setView("packages")} />
              )}
              {work.data?.published && (
                <Revisions
                  projectId={projectId}
                  projectName={data.name}
                  latest={stage === "published" ? work.data.published.name : ""}
                />
              )}
              <Files projectId={projectId} project={data} />
            </>
          )}
        </div>
      )}
    </DropRegion>
  );
}

/** Every item is placed and publishing was held back: the engineer publishes when they are ready. */
function ReadyToPublish({ projectId }: { projectId: string }) {
  const { t } = useSettings();
  const { publish } = useRun(projectId);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <p className="text-ink-2">{t("publish.ready")}</p>
        <button
          type="button"
          disabled={publish.isPending}
          onClick={() => publish.mutate()}
          className="rounded-lg bg-button px-3.5 py-1 text-button-ink disabled:opacity-50"
        >
          {t("publish.ask")}
        </button>
      </div>
      {publish.isError && (
        <p role="alert" className="text-sm text-danger">
          {explain(publish.error, t)}
        </p>
      )}
    </div>
  );
}

/** Read · Plan · Place · Check · Publish: done, where the work is now, and still to come. */
function Steps({ stage, working }: { stage: string | null; working: boolean }) {
  const { t } = useSettings();
  const now = stage === "published" ? STEPS.length : STEPS.findIndex((step) => step === stage);
  return (
    <ol aria-label={t("steps.label")} className="flex flex-wrap items-center gap-2.5 text-sm text-ink-2">
      {STEPS.map((step, index) => (
        <li
          key={step}
          aria-current={index === now ? "step" : undefined}
          data-done={index < now || undefined}
          className="group flex items-center gap-2.5"
        >
          <span className="flex items-center gap-1.5 group-aria-[current]:text-ink group-data-[done]:text-ink">
            <span
              className={`size-[7px] rounded-full bg-idle group-aria-[current]:bg-ink group-data-[done]:bg-ink ${index === now && working ? "animate-pulse" : ""}`}
              aria-hidden="true"
            />
            {t(`step.${step}` as Key)}
          </span>
          {index < STEPS.length - 1 && <span className="h-px w-6 bg-line" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

function PackageSummary({ work, onOpen }: { work: Work; onOpen: () => void }) {
  const { t } = useSettings();
  const { coverage } = work;
  return (
    <section aria-label={t("packages.title")} className="flex flex-col">
      <div className="flex items-baseline gap-3 pb-1.5">
        <h2 className="font-semibold">{t("packages.title")}</h2>
        <span className="text-sm text-ink-2">
          {t("coverage.summary", { placed: coverage.placed, count: coverage.items })}
          {coverage.waiting > 0 && ` · ${t("coverage.waiting", { count: coverage.waiting })}`}
        </span>
        <div className="flex-1" />
        <button type="button" onClick={onOpen} className="text-sm underline">
          {t("packages.view")}
        </button>
      </div>
      <ul className="flex flex-col">
        {work.packages.map((pkg) => (
          <li key={pkg.id} className="flex items-baseline gap-3 border-t border-line-soft py-2">
            <span className="text-sm tabular-nums text-ink-2">{pkg.code}</span>
            <span className="flex-1 [unicode-bidi:plaintext]">{pkg.name}</span>
            <span className="text-sm text-ink-2">{t("packages.items", { count: pkg.items })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Files({ projectId, project }: { projectId: string; project: Project }) {
  const { t, locale } = useSettings();
  const [open, setOpen] = useState<string | null>(null); // the file being previewed
  return (
    <section aria-label={t("files.title")} className="flex flex-col">
      <h2 className="pb-1.5 font-semibold">{t("files.title")}</h2>
      <ul className="flex flex-col">
        {project.sources.map((source) => {
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
              {opened && <SourcePreview projectId={projectId} sourceId={source.id} editable />}
            </li>
          );
        })}
      </ul>
    </section>
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
