import { useMutation, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api, explain, must } from "../api/client";
import { Logo } from "../app/Logo";
import { useSettings } from "../app/settings";
import { Alert, Page, Skeleton, link } from "../app/ui";

export function About() {
  const { t } = useSettings();
  const about = useQuery({ queryKey: ["about"], queryFn: () => must(api.GET("/about")) });
  const website = useMutation({ mutationFn: () => must(api.POST("/about/website")) });

  return (
    <Page className="gap-8">
      <div className="flex flex-col items-start gap-1">
        <Logo size={64} />
        <h1 className="mt-4 font-heading text-title font-light">{t("app.name")}</h1>
        <p className="text-ink-2">{t("about.tagline")}</p>
        {about.data ? (
          <p className="text-ink-2">{t("about.version", { version: about.data.version })}</p>
        ) : (
          about.isPending && <Skeleton className="mt-1 h-4 w-24" />
        )}
      </div>
      {about.isError && <Alert onRetry={() => void about.refetch()}>{explain(about.error, t)}</Alert>}
      <dl className="flex flex-col border-b border-line-soft">
        <Row label={t("about.madeBy")}>
          <button type="button" disabled={website.isPending} onClick={() => website.mutate()} className={`w-fit ${link}`}>
            {t("about.company")}
          </button>
          {website.isError && <Alert>{explain(website.error, t)}</Alert>}
        </Row>
        <Row label={t("about.licence")}>{t("about.license")}</Row>
        <Row label={t("about.data")}>
          {about.data ? (
            // Kumbh Sans kerns "/." so tightly that the dot of ".tawreed" hides under the slash.
            <span dir="ltr" className="break-all select-all [font-kerning:none]">
              {about.data.data_folder}
            </span>
          ) : (
            about.isPending && <Skeleton className="h-5 w-64 max-w-full" />
          )}
        </Row>
      </dl>
      <p className="text-sm text-ink-2">{t("about.copyright")}</p>
    </Page>
  );
}

/** One fact about Tawreed: what it is, then its value. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-x-6 gap-y-0.5 border-t border-line-soft py-3 sm:flex-row sm:items-baseline">
      <dt className="shrink-0 text-ink-2 sm:w-40">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1 text-start">{children}</dd>
    </div>
  );
}
