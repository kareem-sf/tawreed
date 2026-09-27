import { explain } from "../api/client";
import { ago } from "../app/format";
import { useSettings } from "../app/settings";
import { useProjects } from "../home/queries";

export function History({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, locale } = useSettings();
  const projects = useProjects();

  return (
    <div className="mx-auto flex max-w-[880px] flex-col px-4 pt-6 pb-10">
      <h1 className="mb-3 text-[28px] font-light tracking-[-0.01em]">{t("history.title")}</h1>
      {projects.isError && (
        <p role="alert" className="text-danger">
          {explain(projects.error, t)}
        </p>
      )}
      {projects.data?.length === 0 && <p className="text-ink-2">{t("history.empty")}</p>}
      {projects.data?.map((project) => (
        <button
          key={project.id}
          type="button"
          onClick={() => onOpen(project.id)}
          className="flex items-center gap-4 border-t border-line-soft px-0.5 py-3 text-start hover:bg-soft"
        >
          <span className="min-w-0 flex-1 truncate font-semibold [unicode-bidi:plaintext] rtl:text-right">
            {project.name}
          </span>
          <span className="text-ink-2">{t("project.files", { count: project.files })}</span>
          <span className="w-28 text-end text-ink-2">{ago(project.updated_at, locale)}</span>
        </button>
      ))}
    </div>
  );
}
