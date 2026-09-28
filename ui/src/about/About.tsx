import { useQuery } from "@tanstack/react-query";
import { api, explain, must } from "../api/client";
import { useSettings } from "../app/settings";
import { Alert, Page, PageTitle, SectionLabel, Skeleton } from "../app/ui";

export function About() {
  const { t } = useSettings();
  const about = useQuery({ queryKey: ["about"], queryFn: () => must(api.GET("/about")) });

  return (
    <Page className="gap-8">
      <div className="flex flex-col gap-1">
        <PageTitle>{t("about.title")}</PageTitle>
        <p className="text-ink-2">{t("about.tagline")}</p>
        {about.data ? (
          <p className="text-ink-2">{t("about.version", { version: about.data.version })}</p>
        ) : (
          about.isPending && <Skeleton className="mt-1 h-4 w-24" />
        )}
      </div>
      {about.isError && <Alert onRetry={() => void about.refetch()}>{explain(about.error, t)}</Alert>}
      <section className="flex flex-col">
        <SectionLabel>{t("about.data")}</SectionLabel>
        {about.data ? (
          <p dir="ltr" className="text-start break-all text-ink select-all">
            {about.data.data_folder}
          </p>
        ) : (
          about.isPending && <Skeleton className="h-5 w-64 max-w-full" />
        )}
      </section>
      <section className="flex flex-col gap-1">
        <SectionLabel>{t("about.licences")}</SectionLabel>
        <p>{t("about.license")}</p>
        <p className="text-ink-2">{t("about.figtree")}</p>
        <p className="text-ink-2">{t("about.thmanyah")}</p>
      </section>
    </Page>
  );
}
