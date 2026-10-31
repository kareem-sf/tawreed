import { useQuery } from "@tanstack/react-query";
import { api, must, explain } from "../api/client";
import { ago } from "../app/format";
import { useSettings } from "../app/settings";
import { Alert, button, SectionLabel, Skeleton } from "../app/ui";
import { DropRegion, PickFiles } from "./files";
import { useProjects, useStartProject } from "./queries";

export function Start({ onOpen, onOpenSettings }: { onOpen: (id: string) => void; onOpenSettings: () => void }) {
  const { t, locale } = useSettings();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => must(api.GET("/settings")) });
  const projects = useProjects();
  const start = useStartProject();
  const begin = (files: File[]) => start.mutate(files, { onSuccess: (project) => onOpen(project.id) });
  const recent = (projects.data ?? []).slice(0, 3);

  return (
    <DropRegion onFiles={begin} disabled={start.isPending} className="flex min-h-full flex-col items-center justify-center gap-10 px-4 py-10 sm:px-6">
      {(over) => (
        <>
          {(settings.isPending || settings.isError || (settings.isSuccess && !settings.data.ai) || projects.isError) && (
            <div className="flex w-full max-w-[640px] flex-col gap-3">
              {settings.isPending && <Skeleton className="h-20 w-full" />}
              {settings.isError && <Alert onRetry={() => void settings.refetch()}>{explain(settings.error, t)}</Alert>}
              {settings.isSuccess && !settings.data.ai && (
                <section aria-labelledby="connect-ai" className="flex flex-col items-start gap-3 rounded-xl border border-amber p-5">
                  <h2 id="connect-ai" className="font-heading text-xl font-light">{t("start.connectTitle")}</h2>
                  <p className="text-ink-2">{t("start.connectNote")}</p>
                  <button type="button" onClick={onOpenSettings} className={button("primary")}>{t("start.connect")}</button>
                </section>
              )}
              {projects.isError && <Alert onRetry={() => void projects.refetch()}>{explain(projects.error, t)}</Alert>}
            </div>
          )}
          <section
            aria-label={t("drop.label")}
            aria-busy={start.isPending}
            className={`flex w-full max-w-[640px] flex-col items-center justify-center gap-3 rounded-2xl border-[1.5px] border-dashed px-6 py-12 text-center transition-colors duration-200 sm:min-h-[300px] ${over ? "border-ink bg-subtle" : "border-dash bg-soft"}`}
          >
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className={`transition-[transform,color] duration-200 ${over ? "translate-y-1 text-ink" : "text-ink-2"} ${start.isPending ? "animate-pulse motion-reduce:animate-none" : ""}`}
            >
              <path d="M12 4v10M8 10l4 4 4-4" />
              <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
            </svg>
            <h1 className="font-heading text-title font-light text-balance">
              {start.isPending ? t("drop.busy") : t("drop.title")}
            </h1>
            <p className="text-balance text-ink-2">{t("drop.formats")}</p>
            <PickFiles onFiles={begin} disabled={start.isPending} className={`mt-2 font-semibold ${button("secondary")}`}>
              {t("drop.choose")}
            </PickFiles>
          </section>
          <p className="-mt-6 w-full max-w-[640px] text-center text-sm text-balance text-ink-2">{t("policy.summary")}</p>

          {start.isError && (
            <div className="w-full max-w-[640px]">
              <Alert>{explain(start.error, t)}</Alert>
            </div>
          )}

          {recent.length > 0 && (
            <section aria-labelledby="recent" className="flex w-full max-w-[640px] flex-col">
              <SectionLabel id="recent">{t("recent.title")}</SectionLabel>
              {recent.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onOpen(project.id)}
                  className="-mx-3 flex flex-col gap-0.5 rounded-lg border-t border-line-soft px-3 py-3 text-start transition-colors duration-150 hover:border-transparent hover:bg-soft sm:flex-row sm:items-baseline sm:gap-4 [&+button]:hover:border-transparent first-of-type:border-t-0"
                >
                  <span className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere] [unicode-bidi:plaintext] rtl:text-right">{project.name}</span>
                  <span className="flex shrink-0 gap-3 text-sm text-ink-2 sm:text-[15px]">
                    <span>{t("project.files", { count: project.files })}</span>
                    <span>{ago(project.updated_at, locale)}</span>
                  </span>
                </button>
              ))}
            </section>
          )}
        </>
      )}
    </DropRegion>
  );
}
