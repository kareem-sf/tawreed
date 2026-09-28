import { useEffect, useRef, useState } from "react";
import { explain, type Revision } from "../api/client";
import { ago, size } from "../app/format";
import { useSettings } from "../app/settings";
import { useExportRevision, useOpenRevision, useRevisions, useRun } from "./queries";

/** The revision that holds the current work, in one line: what it holds, Open folder, Export and Publish again. */
export function Published({ projectId, projectName, revision }: { projectId: string; projectName: string; revision: Revision }) {
  const { t, locale } = useSettings();
  return (
    <section
      aria-label={t("revision.label")}
      className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-line px-5 py-3.5"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 className="text-xl font-heading font-light">{t("revision.published", { name: revision.name })}</h2>
        <span className="text-sm text-ink-2">
          {t("revision.holds", { packages: revision.packages, count: revision.items })} · {ago(revision.created_at, locale)}
          {!revision.prices && ` · ${t("revision.forPricing")}`}
        </span>
      </div>
      <div className="flex flex-col items-end gap-1.5">
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
      <button
        type="button"
        disabled={publish.isPending}
        onClick={() => publish.mutate()}
        className="text-sm text-ink-2 underline hover:text-ink disabled:opacity-50"
      >
        {t("publish.again")}
      </button>
      {publish.isError && (
        <p role="alert" className="text-sm text-danger">
          {explain(publish.error, t)}
        </p>
      )}
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
  const button = primary
    ? "rounded-lg border border-line px-3.5 py-1.5 hover:border-ink disabled:opacity-50"
    : "text-sm text-ink-2 underline hover:text-ink disabled:opacity-50";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-3">
        <button
          type="button"
          disabled={open.isPending}
          onClick={() => open.mutate(revision.number)}
          className={primary ? "rounded-lg bg-button px-3.5 py-1.5 text-button-ink disabled:opacity-50" : button}
        >
          {t("revision.open")}
        </button>
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate({ number: revision.number, filename: `${projectName} - ${revision.name}.zip` })}
          className={button}
        >
          {t("revision.export")}
        </button>
      </div>
      {failed && (
        <p role="alert" className="text-sm text-danger">
          {explain(failed, t)}
        </p>
      )}
    </div>
  );
}

/** Every published revision, newest first, behind a button that floats in the corner of the page. */
export function RevisionsButton({ projectId, projectName, latest }: { projectId: string; projectName: string; latest?: string }) {
  const { t } = useSettings();
  const revisions = useRevisions(projectId, latest ?? "none");
  const [open, setOpen] = useState(false);
  const here = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Escape, or a click anywhere else on the page, closes the panel.
    const key = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    const away = (event: MouseEvent) => !here.current?.contains(event.target as Node) && setOpen(false);
    window.addEventListener("keydown", key);
    window.addEventListener("mousedown", away);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("mousedown", away);
    };
  }, [open]);

  const list = revisions.data ?? [];
  if (list.length === 0) return null;
  return (
    <div ref={here} className="fixed end-6 bottom-6 z-30 flex flex-col items-end gap-3">
      {open && (
        <section
          role="dialog"
          aria-label={t("revision.list")}
          className="flex max-h-[70vh] w-[min(460px,calc(100vw-3rem))] flex-col overflow-hidden rounded-xl border border-line bg-page shadow-lg"
        >
          <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
            <h2 className="flex-1 font-semibold">{t("revision.list")}</h2>
            <button type="button" aria-label={t("revision.close")} onClick={() => setOpen(false)} className="rounded-md p-1 text-ink-2 hover:text-ink">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <ul className="overflow-y-auto">
            {list.map((revision) => (
              <RevisionRow key={revision.name} projectId={projectId} projectName={projectName} revision={revision} />
            ))}
          </ul>
        </section>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-label={t("revision.button", { count: list.length })}
        onClick={() => setOpen(!open)}
        className="relative flex size-12 items-center justify-center rounded-full border border-line bg-page text-ink shadow-md hover:border-ink"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l9 5-9 5-9-5 9-5z" />
          <path d="M3 13l9 5 9-5" />
        </svg>
        <span className="absolute -end-1 -top-1 min-w-5 rounded-full bg-button px-1.5 text-xs leading-5 text-button-ink tabular-nums">
          {list.length}
        </span>
      </button>
    </div>
  );
}

function RevisionRow({ projectId, projectName, revision }: { projectId: string; projectName: string; revision: Revision }) {
  const { t, locale } = useSettings();
  const [files, setFiles] = useState(false);
  return (
    <li className="flex flex-col gap-1.5 border-b border-line-soft px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-expanded={files}
          onClick={() => setFiles(!files)}
          className="font-semibold hover:underline"
        >
          {revision.name}
        </button>
        <span className="flex-1 text-sm text-ink-2">{!revision.prices && t("revision.forPricing")}</span>
        <Actions projectId={projectId} projectName={projectName} revision={revision} />
      </div>
      <span className="text-sm text-ink-2">
        {t("revision.holds", { packages: revision.packages, count: revision.items })} · {ago(revision.created_at, locale)}
      </span>
      {files && (
        <ul className="flex flex-col text-sm">
          {revision.files
            .filter((file) => file.path.endsWith(".xlsx"))
            .map((file) => (
              <li key={file.path} className="flex gap-3 border-t border-line-soft py-1">
                <span className="flex-1 [unicode-bidi:plaintext] rtl:text-right">{file.path.replace(/^Packages\//, "")}</span>
                <span className="text-ink-2">{size(file.bytes, locale)}</span>
              </li>
            ))}
        </ul>
      )}
    </li>
  );
}
