import { useEffect, useId, useRef, useState } from "react";
import { explain, type Revision } from "../api/client";
import { ago, size } from "../app/format";
import { useSettings } from "../app/settings";
import { Alert, button, card, Icon, iconButton, link } from "../app/ui";
import { useExportRevision, useOpenRevision, useRevisions, useRun } from "./queries";

/** The revision that holds the current work, in one line: what it holds, Open folder, Export and Publish again. */
export function Published({ projectId, projectName, revision }: { projectId: string; projectName: string; revision: Revision }) {
  const { t, locale } = useSettings();
  return (
    <section aria-label={t("revision.label")} className={`${card} flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6`}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 className="flex items-center gap-2 font-heading text-xl leading-7 font-light">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-ink text-page" aria-hidden="true">
            <Icon name="check" size={12} />
          </span>
          {t("revision.published", { name: revision.name })}
        </h2>
        <span className="text-sm text-ink-2">
          {t("revision.holds", { packages: revision.packages, count: revision.items })} · {ago(revision.created_at, locale)}
          {!revision.prices && ` · ${t("revision.forPricing")}`}
        </span>
      </div>
      <div className="flex flex-col items-start gap-1.5 sm:items-end">
        <Actions projectId={projectId} projectName={projectName} revision={revision} primary />
        <PublishAgain projectId={projectId} />
      </div>
    </section>
  );
}

/** Publish the same work again, for instance once with rates and once for suppliers to price. */
function PublishAgain({ projectId }: { projectId: string }) {
  const { t } = useSettings();
  const { publish } = useRun(projectId);
  return (
    <>
      <button type="button" disabled={publish.isPending} onClick={() => publish.mutate()} className={`text-sm ${link}`}>
        {t("publish.again")}
      </button>
      {publish.isError && <Alert>{explain(publish.error, t)}</Alert>}
    </>
  );
}

function Actions({
  projectId,
  projectName,
  revision,
  primary = false,
}: {
  projectId: string;
  projectName: string;
  revision: Revision;
  primary?: boolean;
}) {
  const { t } = useSettings();
  const open = useOpenRevision(projectId);
  const save = useExportRevision(projectId);
  const failed = open.error ?? save.error;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={open.isPending}
          onClick={() => open.mutate(revision.number)}
          className={primary ? button("primary") : button("quiet", "sm")}
        >
          {t("revision.open")}
        </button>
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate({ number: revision.number, filename: `${projectName} - ${revision.name}.zip` })}
          className={primary ? button("secondary") : button("quiet", "sm")}
        >
          {t("revision.export")}
        </button>
      </div>
      {failed && <Alert>{explain(failed, t)}</Alert>}
    </div>
  );
}

/** Every published revision, newest first, behind a button that floats in the corner of the page. */
export function RevisionsButton({ projectId, projectName, latest }: { projectId: string; projectName: string; latest?: string }) {
  const { t } = useSettings();
  const revisions = useRevisions(projectId, latest ?? "none");
  const [open, setOpen] = useState(false);
  const here = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const id = useId();

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    panel.current?.focus(); // into the panel, so the keyboard carries on there
    const away = (event: MouseEvent) => !here.current?.contains(event.target as Node) && setOpen(false);
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [open]);

  const list = revisions.data ?? [];
  if (list.length === 0) return null;
  return (
    // The button comes first in the page's order, so Tab goes from it into the panel shown above it.
    <div
      ref={here}
      className="fixed end-4 bottom-4 z-30 flex flex-col-reverse items-end gap-3 sm:end-6 sm:bottom-6"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          close(true);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? id : undefined}
        aria-label={t("revision.button", { count: list.length })}
        title={t("revision.list")}
        onClick={() => (open ? close(false) : setOpen(true))}
        className={`relative flex size-12 items-center justify-center rounded-full border bg-page text-ink shadow-float transition-[border-color,transform] duration-150 hover:-translate-y-px hover:border-ink/40 active:translate-y-0 ${open ? "border-ink" : "border-line"}`}
      >
        <Icon name="layers" size={20} />
        <span className="absolute -end-1 -top-1 min-w-5 rounded-full bg-button px-1.5 text-xs leading-5 text-button-ink">{list.length}</span>
      </button>
      {open && (
        <section
          ref={panel}
          id={id}
          role="dialog"
          aria-label={t("revision.list")}
          tabIndex={-1}
          className="flex max-h-[min(70vh,560px)] w-[min(460px,calc(100vw-2rem))] origin-bottom-right flex-col overflow-hidden rounded-xl border border-line bg-page shadow-panel animate-rise focus:outline-none rtl:origin-bottom-left"
        >
          <div className="flex items-center gap-3 border-b border-line px-4 py-2">
            <h2 className="flex-1 font-semibold">{t("revision.list")}</h2>
            <button type="button" aria-label={t("revision.close")} onClick={() => close(true)} className={iconButton("sm")}>
              <Icon name="close" />
            </button>
          </div>
          <ul className="overflow-y-auto overscroll-contain">
            {list.map((revision) => (
              <RevisionRow key={revision.name} projectId={projectId} projectName={projectName} revision={revision} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RevisionRow({ projectId, projectName, revision }: { projectId: string; projectName: string; revision: Revision }) {
  const { t, locale } = useSettings();
  const [files, setFiles] = useState(false);
  return (
    <li className="flex flex-col gap-1 border-b border-line-soft px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          aria-expanded={files}
          onClick={() => setFiles(!files)}
          className="group flex items-center gap-1 font-semibold"
        >
          <span className={`text-ink-2 transition-transform duration-150 ${files ? "rotate-90 rtl:-rotate-90" : ""}`}>
            <Icon name="next" size={14} />
          </span>
          <span className="group-hover:underline">{revision.name}</span>
        </button>
        <span className="min-w-0 flex-1 text-sm text-ink-2">{!revision.prices && t("revision.forPricing")}</span>
        <Actions projectId={projectId} projectName={projectName} revision={revision} />
      </div>
      <span className="ps-5 text-sm text-ink-2">
        {t("revision.holds", { packages: revision.packages, count: revision.items })} · {ago(revision.created_at, locale)}
      </span>
      {files && (
        <ul className="ms-5 mt-1 flex flex-col text-sm animate-enter">
          {revision.files
            .filter((file) => file.path.endsWith(".xlsx"))
            .map((file) => (
              <li key={file.path} className="flex gap-3 border-t border-line-soft py-1.5">
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere] [unicode-bidi:plaintext] rtl:text-right">{file.path.replace(/^Packages\//, "")}</span>
                <span className="shrink-0 text-ink-2">{size(file.bytes, locale)}</span>
              </li>
            ))}
        </ul>
      )}
    </li>
  );
}
