import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { explain, type Project, type Source, type Work } from "../api/client";
import { ago, size } from "../app/format";
import { useSettings } from "../app/settings";
import { Alert, Amount, button, card, Empty, Icon, iconButton, Page, pill, Skeleton } from "../app/ui";
import type { Key, Translate } from "../i18n";
import { DecisionCard } from "../work/DecisionCard";
import { Packages } from "../work/Packages";
import { Published, RevisionsButton } from "../work/Revisions";
import { Status } from "../work/Status";
import { useRun, useWork } from "../work/queries";
import { DropRegion, PickFiles } from "./files";
import { isReading, useAddFiles, useProject, useRename } from "./queries";
import { SourcePreview } from "./SourcePreview";

const STEPS = ["read", "plan", "place", "check", "publish"] as const;
const VIEWS = ["packages", "files"] as const;
type View = (typeof VIEWS)[number];

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
  const [tab, setTab] = useState<View>();

  if (project.isError) {
    return (
      <Page>
        <Alert onRetry={() => void project.refetch()}>{explain(project.error, t)}</Alert>
      </Page>
    );
  }
  if (!project.data) return <Loading />;
  const { data } = project;
  const stage = work.data?.stage ?? (isReading(data) ? "read" : null);
  const [decision, ...more] = work.data?.decisions ?? [];
  const shown: View = tab ?? (work.data?.packages.length ? "packages" : "files");

  return (
    <DropRegion onFiles={(files) => add.mutate(files)} className="relative min-h-full">
      {(over) => (
        <Page className="gap-6">
          {over && (
            <div className="pointer-events-none fixed inset-3 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-ink bg-page/80 backdrop-blur-[2px] animate-enter">
              <p className="font-heading text-title font-light">{t("project.dropHere")}</p>
            </div>
          )}

          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                <ProjectName project={data} />
                <span className={pill}>{t("project.files", { count: data.sources.length })}</span>
              </div>
              <PickFiles
                onFiles={(files) => add.mutate(files)}
                disabled={add.isPending}
                label={t("project.add")}
                className={button("secondary", "sm")}
              >
                <Icon name="plus" />
                <span className="hidden sm:inline">{add.isPending ? t("drop.busy") : t("project.add")}</span>
              </PickFiles>
              <button type="button" aria-label={t("project.close")} title={t("project.close")} onClick={onClose} className={iconButton("sm")}>
                <Icon name="close" />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <Steps stage={stage} working={work.data?.run.state === "running"} />
              {work.data && <Status projectId={projectId} run={work.data.run} />}
            </div>
          </div>

          {!ai && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-amber-line bg-amber-soft px-4 py-3 text-amber animate-enter">
              <p className="min-w-0 flex-1">{t("project.noAi")}</p>
              <button type="button" onClick={onOpenSettings} className="shrink-0 font-semibold underline underline-offset-[3px] hover:no-underline">
                {t("project.openSettings")}
              </button>
            </div>
          )}

          {add.isError && <Alert>{explain(add.error, t)}</Alert>}
          {work.isError && <Alert onRetry={() => void work.refetch()}>{explain(work.error, t)}</Alert>}

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
              <Tabs
                shown={shown}
                onShow={setTab}
                counts={{ packages: work.data?.packages.length ?? 0, files: data.sources.length }}
              >
                {shown === "packages" ? (
                  work.data ? <PackageSummary work={work.data} onOpen={() => setView("packages")} /> : <Skeleton className="h-40 w-full" />
                ) : (
                  <Files projectId={projectId} project={data} />
                )}
              </Tabs>
            </>
          )}
          <RevisionsButton projectId={projectId} projectName={data.name} latest={work.data?.published?.name} />
        </Page>
      )}
    </DropRegion>
  );
}

/** The project's shape while it is on its way, so the page doesn't jump when it arrives. */
function Loading() {
  return (
    <Page className="gap-6">
      <div aria-hidden="true" className="flex flex-col gap-4">
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="h-5 w-80 max-w-full" />
      </div>
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-48 w-full" />
    </Page>
  );
}

/** Packages | Files: one list at a time. Arrow keys move between the two, as in any tab list. */
function Tabs({
  shown,
  onShow,
  counts,
  children,
}: {
  shown: View;
  onShow: (view: View) => void;
  counts: Record<View, number>;
  children: ReactNode;
}) {
  const { t } = useSettings();
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const label = (view: View) => t(view === "packages" ? "packages.title" : "files.title");
  const move = (event: KeyboardEvent) => {
    const rtl = document.documentElement.dir === "rtl";
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[event.key];
    const index = VIEWS.indexOf(shown);
    const next =
      event.key === "Home" ? 0 : event.key === "End" ? VIEWS.length - 1 : step ? (index + step + VIEWS.length) % VIEWS.length : -1;
    if (next < 0) return;
    event.preventDefault();
    onShow(VIEWS[next]!);
    buttons.current[VIEWS[next]!]?.focus();
  };
  return (
    <div className="flex flex-col">
      <div role="tablist" aria-label={t("project.views")} onKeyDown={move} className="flex gap-6 border-b border-line">
        {VIEWS.map((view) => (
          <button
            key={view}
            ref={(element) => {
              buttons.current[view] = element;
            }}
            id={`tab-${view}`}
            type="button"
            role="tab"
            aria-selected={shown === view}
            aria-controls={`panel-${view}`}
            aria-label={`${label(view)}, ${counts[view]}`}
            tabIndex={shown === view ? 0 : -1}
            onClick={() => onShow(view)}
            className="-mb-px flex h-10 items-center gap-1.5 border-b-2 border-transparent text-ink-2 transition-colors duration-150 hover:text-ink focus-visible:outline-offset-[-2px] aria-selected:border-ink aria-selected:text-ink"
          >
            {label(view)}
            <span className="rounded-full bg-subtle px-1.5 text-sm leading-5 text-ink-2">{counts[view]}</span>
          </button>
        ))}
      </div>
      <div id={`panel-${shown}`} role="tabpanel" aria-labelledby={`tab-${shown}`} className="pt-4">
        {children}
      </div>
    </div>
  );
}

/** Every item is placed and publishing was held back: the engineer publishes when they are ready. */
function ReadyToPublish({ projectId }: { projectId: string }) {
  const { t } = useSettings();
  const { publish } = useRun(projectId);
  return (
    <div className={`${card} flex flex-col gap-2`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <p className="min-w-0 flex-1">{t("publish.ready")}</p>
        <button type="button" disabled={publish.isPending} onClick={() => publish.mutate()} className={button("primary")}>
          {t("publish.ask")}
        </button>
      </div>
      {publish.isError && <Alert>{explain(publish.error, t)}</Alert>}
    </div>
  );
}

/** Read · Plan · Place · Check · Publish: done, where the work is now, and still to come. */
function Steps({ stage, working }: { stage: string | null; working: boolean }) {
  const { t } = useSettings();
  const now = stage === "published" ? STEPS.length : STEPS.findIndex((step) => step === stage);
  return (
    <ol aria-label={t("steps.label")} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2 sm:gap-x-2.5">
      {STEPS.map((step, index) => (
        <li
          key={step}
          aria-current={index === now ? "step" : undefined}
          data-done={index < now || undefined}
          className="group flex items-center gap-2 sm:gap-2.5"
        >
          <span className="flex items-center gap-1.5 group-aria-[current]:font-semibold group-aria-[current]:text-ink group-data-[done]:text-ink">
            <span
              className={`size-[7px] rounded-full bg-idle transition-colors duration-300 group-aria-[current]:bg-ink group-data-[done]:bg-ink ${index === now && working ? "motion-safe:animate-pulse" : ""}`}
              aria-hidden="true"
            />
            {t(`step.${step}` as Key)}
          </span>
          {index < STEPS.length - 1 && (
            <span className="h-px w-3 bg-line transition-colors group-data-[done]:bg-ink/40 sm:w-6" aria-hidden="true" />
          )}
        </li>
      ))}
    </ol>
  );
}

/** The packages at a glance: each one's items and amount, computed by Tawreed, and the way into editing them. */
function PackageSummary({ work, onOpen }: { work: Work; onOpen: () => void }) {
  const { t } = useSettings();
  const { coverage } = work;
  const row = "grid grid-cols-[2rem_minmax(0,1fr)_auto] items-baseline gap-x-3 sm:grid-cols-[2rem_minmax(0,1fr)_6.5rem_9rem]";
  return (
    <section aria-label={t("packages.title")} className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-3">
        <span className="min-w-0 flex-1 text-sm text-ink-2">
          {t("coverage.summary", { placed: coverage.placed, count: coverage.items })}
          {coverage.waiting > 0 && <span className="text-amber"> · {t("coverage.waiting", { count: coverage.waiting })}</span>}
        </span>
        <button type="button" onClick={onOpen} className={button("secondary", "sm")}>
          {t("packages.view")}
        </button>
      </div>
      {work.packages.length === 0 ? (
        <Empty>{t("packages.none")}</Empty>
      ) : (
        <ul className="flex flex-col">
          {work.packages.map((pkg) => (
            <li key={pkg.id} className={`${row} border-t border-line-soft py-2.5`}>
              <span className="text-sm text-ink-2">{pkg.code}</span>
              <span className="min-w-0 [overflow-wrap:anywhere] [unicode-bidi:plaintext]">
                {pkg.name}
                <span className="block text-sm text-ink-2 sm:hidden">{t("packages.items", { count: pkg.items })}</span>
              </span>
              <span className="hidden text-end text-sm text-ink-2 sm:block">{t("packages.items", { count: pkg.items })}</span>
              <span className="text-end text-sm whitespace-nowrap text-ink-2">
                {pkg.items > pkg.without_amount ? <Amount value={pkg.amount} /> : null}
              </span>
            </li>
          ))}
          <li className={`${row} border-t border-line-strong py-3 font-semibold`}>
            <span />
            <span>
              {t("packages.total")}
              <span className="block text-sm font-normal text-ink-2 sm:hidden">{t("packages.items", { count: coverage.placed })}</span>
            </span>
            <span className="hidden text-end text-sm sm:block">{t("packages.items", { count: coverage.placed })}</span>
            <span className="text-end whitespace-nowrap">
              <Amount value={coverage.amount} />
            </span>
          </li>
        </ul>
      )}
    </section>
  );
}

function Files({ projectId, project }: { projectId: string; project: Project }) {
  const { t, locale } = useSettings();
  const [open, setOpen] = useState<string | null>(null); // the file being previewed
  return (
    <section aria-label={t("files.title")} className="flex flex-col">
      <ul className="flex flex-col">
        {project.sources.map((source) => {
          const opened = open === source.id && source.status === "read";
          return (
            <li key={source.id} className="flex flex-col gap-3 border-t border-line-soft py-3 first:border-t-0 first:pt-0">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                {source.status === "read" ? (
                  <button
                    type="button"
                    aria-expanded={opened}
                    onClick={() => setOpen(opened ? null : source.id)}
                    className="group flex min-w-0 flex-1 items-start gap-1.5 text-start font-semibold rtl:text-right"
                  >
                    <span className={`mt-1 text-ink-2 transition-transform duration-150 ${opened ? "rotate-90 rtl:-rotate-90" : ""}`}>
                      <Icon name="next" size={14} />
                    </span>
                    <span className="min-w-0 [overflow-wrap:anywhere] [unicode-bidi:plaintext] group-hover:underline">{source.filename}</span>
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere] [unicode-bidi:plaintext] rtl:text-right">
                    {source.filename}
                  </span>
                )}
                <span className="flex flex-wrap items-center gap-x-3 text-sm text-ink-2 sm:shrink-0">
                  <span>{t(`kind.${source.kind}` as Key)}</span>
                  <SourceStatus source={source} />
                  <span>{size(source.size, locale)}</span>
                  <span>{ago(source.added_at, locale)}</span>
                </span>
              </div>
              {source.status === "failed" && <p className="text-sm text-danger">{problem(source, t)}</p>}
              {opened && (
                <div className="animate-enter">
                  <SourcePreview projectId={projectId} sourceId={source.id} editable />
                </div>
              )}
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
  return (
    <span className={`inline-flex items-center gap-1.5 ${source.status === "failed" ? "text-danger" : ""}`}>
      {(source.status === "added" || source.status === "reading") && (
        <span className="size-1.5 rounded-full bg-ink motion-safe:animate-pulse" aria-hidden="true" />
      )}
      {text}
    </span>
  );
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

  const text = "border border-transparent px-1.5 py-0 font-heading text-title font-light [overflow-wrap:anywhere]";
  return (
    <div className="flex min-w-0 max-w-full flex-col">
      {/* An invisible copy of the name gives the field its size: as wide as the name, wrapping onto more lines when
          the window is narrower than it, so the whole name always shows. */}
      <span className="-mx-1.5 grid min-w-0">
        <span aria-hidden="true" className={`invisible col-start-1 row-start-1 whitespace-pre-wrap ${text}`}>
          {`${name} `}
        </span>
        <textarea
          aria-label={t("project.rename")}
          title={t("project.rename")}
          value={name}
          rows={1}
          dir="auto"
          maxLength={200}
          spellCheck={false}
          onChange={(event) => setName(event.target.value.replace(/\s*\n\s*/g, " "))}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault(); // a name is one line
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              undoing.current = true;
              setName(project.name);
              event.currentTarget.blur();
            }
          }}
          className={`col-start-1 row-start-1 w-full min-w-0 resize-none overflow-hidden rounded-lg bg-transparent ${text} transition-colors duration-150 hover:border-line-strong focus-visible:border-edge ${rename.isPending ? "text-ink-2" : ""}`}
        />
      </span>
      {rename.isError && <Alert>{explain(rename.error, t)}</Alert>}
    </div>
  );
}
