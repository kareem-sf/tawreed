import { explain } from "../api/client";
import { ago } from "../app/format";
import { useSettings } from "../app/settings";
import { DropRegion, PickFiles } from "./files";
import { useProjects, useStartProject } from "./queries";

export function Start({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, locale } = useSettings();
  const projects = useProjects();
  const start = useStartProject();
  const begin = (files: File[]) => start.mutate(files, { onSuccess: (project) => onOpen(project.id) });
  const recent = (projects.data ?? []).slice(0, 3);

  return (
    <DropRegion onFiles={begin} className="flex min-h-full flex-col items-center justify-center gap-10 px-4 py-10">
      {(over) => (
        <>
          <section
            aria-label={t("drop.label")}
            className={`flex h-[300px] w-full max-w-[640px] flex-col items-center justify-center gap-3 rounded-2xl border-[1.5px] border-dashed ${over ? "border-ink bg-subtle" : "border-dash bg-soft"}`}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-ink-2">
              <path d="M12 4v10M8 10l4 4 4-4" />
              <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
            </svg>
            <p className="text-[30px] font-light tracking-[-0.01em]">{start.isPending ? t("drop.busy") : t("drop.title")}</p>
            <p className="text-ink-2">{t("drop.formats")}</p>
            <PickFiles
              onFiles={begin}
              disabled={start.isPending}
              className="mt-1.5 rounded-lg border border-line bg-page px-5 py-2 font-semibold disabled:opacity-50"
            >
              {t("drop.choose")}
            </PickFiles>
          </section>

          {start.isError && (
            <p role="alert" className="w-full max-w-[640px] text-danger">
              {explain(start.error, t)}
            </p>
          )}

          {recent.length > 0 && (
            <section aria-labelledby="recent" className="flex w-full max-w-[640px] flex-col">
              <h2 id="recent" className="pb-1.5 text-[13px] font-normal text-ink-2">
                {t("recent.title")}
              </h2>
              {recent.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onOpen(project.id)}
                  className="flex items-center gap-4 border-t border-line-soft px-0.5 py-2.5 text-start hover:bg-soft"
                >
                  <span className="min-w-0 flex-1 truncate font-semibold [unicode-bidi:plaintext] rtl:text-right">{project.name}</span>
                  <span className="text-ink-2">{t("project.files", { count: project.files })}</span>
                  <span className="w-28 text-end text-ink-2">{ago(project.updated_at, locale)}</span>
                </button>
              ))}
            </section>
          )}
        </>
      )}
    </DropRegion>
  );
}
