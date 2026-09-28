import { explain } from "../api/client";
import { ago } from "../app/format";
import { useSettings } from "../app/settings";
import { Alert, Empty, Page, PageTitle, SkeletonRows } from "../app/ui";
import { useProjects } from "../home/queries";

export function History({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, locale } = useSettings();
  const projects = useProjects();

  return (
    <Page className="gap-4">
      <PageTitle>{t("history.title")}</PageTitle>
      {projects.isError && <Alert onRetry={() => void projects.refetch()}>{explain(projects.error, t)}</Alert>}
      {projects.isPending && <SkeletonRows rows={4} />}
      {projects.data?.length === 0 && <Empty>{t("history.empty")}</Empty>}
      {projects.data && projects.data.length > 0 && (
        <div className="flex flex-col">
          {projects.data.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => onOpen(project.id)}
              className="-mx-3 flex flex-col gap-0.5 rounded-lg border-t border-line-soft px-3 py-3 text-start transition-colors duration-150 hover:border-transparent hover:bg-soft sm:flex-row sm:items-baseline sm:gap-4 [&+button]:hover:border-transparent first:border-t-0"
            >
              <span className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere] [unicode-bidi:plaintext] rtl:text-right">
                {project.name}
              </span>
              <span className="flex shrink-0 flex-wrap gap-x-3 text-sm text-ink-2 sm:text-[15px]">
                {project.revision && <span>{project.revision}</span>}
                <span>{t("project.files", { count: project.files })}</span>
                <span className="sm:w-28 sm:text-end">{ago(project.updated_at, locale)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Page>
  );
}
