import { explain, type Revision } from "../api/client";
import { ago, size } from "../app/format";
import { useSettings } from "../app/settings";
import { useExportRevision, useOpenRevision, useRevisions } from "./queries";

/** The revision the project's current work is in: what was written, and where it is. */
export function Published({ projectId, projectName, revision }: { projectId: string; projectName: string; revision: Revision }) {
  const { t, locale } = useSettings();
  return (
    <section aria-label={t("revision.label")} className="flex flex-col gap-3 rounded-xl border border-line px-5 py-4">
      <h2 className="text-xl font-light">{t("revision.published", { name: revision.name })}</h2>
      <p className="text-ink-2">
        {t("revision.holds", { packages: revision.packages, count: revision.items })} · {ago(revision.created_at, locale)}
      </p>
      {!revision.prices && <p className="text-sm text-ink-2">{t("revision.noPrices")}</p>}
      <ul className="flex flex-col text-sm">
        {revision.files
          .filter((file) => file.path.endsWith(".xlsx"))
          .map((file) => (
            <li key={file.path} className="flex gap-3 border-t border-line-soft py-1.5">
              <span className="flex-1 [unicode-bidi:plaintext] rtl:text-right">{file.path.replace(/^Packages\//, "")}</span>
              <span className="text-ink-2">{size(file.bytes, locale)}</span>
            </li>
          ))}
      </ul>
      <Actions projectId={projectId} projectName={projectName} revision={revision} primary />
    </section>
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

/** Published revisions, other than the one shown as current (`latest`, when the work hasn't changed since). */
export function Revisions({ projectId, projectName, latest }: { projectId: string; projectName: string; latest: string }) {
  const { t, locale } = useSettings();
  const revisions = useRevisions(projectId, latest || "all");
  const earlier = (revisions.data ?? []).filter((r) => r.name !== latest);
  if (earlier.length === 0) return null;
  return (
    <section aria-label={t("revision.list")} className="flex flex-col">
      <h2 className="pb-1.5 font-semibold">{t("revision.list")}</h2>
      <ul className="flex flex-col">
        {earlier.map((revision) => (
          <li key={revision.name} className="flex items-center gap-4 border-t border-line-soft py-2">
            <span className="w-16 font-semibold">{revision.name}</span>
            <span className="flex-1 text-sm text-ink-2">
              {t("revision.holds", { packages: revision.packages, count: revision.items })} ·{" "}
              {ago(revision.created_at, locale)}
            </span>
            <Actions projectId={projectId} projectName={projectName} revision={revision} />
          </li>
        ))}
      </ul>
    </section>
  );
}
