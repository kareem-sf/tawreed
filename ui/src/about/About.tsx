import { useQuery } from "@tanstack/react-query";
import { api, explain, must } from "../api/client";
import { useSettings } from "../app/settings";
import { Alert, link, Page, PageTitle, SectionLabel, Skeleton } from "../app/ui";

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
      <section className="flex flex-col">
        <SectionLabel>{t("about.maker")}</SectionLabel>
        <div className="flex items-center gap-3">
          <FounderMark />
          <div className="flex flex-col items-start gap-0.5">
            <p>{t("about.founder")}</p>
            {/* A new window: in the desktop app it opens in the default browser, never in Tawreed's own window. */}
            <a href="https://kareemsafwat.com" target="_blank" rel="noreferrer" dir="ltr" className={link}>
              kareemsafwat.com
            </a>
          </div>
        </div>
        <p className="pt-3 text-ink-2">{t("about.house")}</p>
      </section>
    </Page>
  );
}

/** Kareem Safwat's K, unchanged from brand/founder/k-mark.svg (only the gradient's id is Tawreed's own). */
function FounderMark() {
  return (
    <svg width="48" height="48" viewBox="0 0 300 300" fill="none" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id="about-founder-k" x1="80" y1="70" x2="220" y2="230" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FEF08A" />
          <stop offset="50%" stopColor="#D97706" />
          <stop offset="100%" stopColor="#78350F" />
        </linearGradient>
      </defs>
      <line x1="80" y1="70" x2="80" y2="230" stroke="url(#about-founder-k)" strokeWidth="8" strokeLinecap="square" />
      <line x1="80" y1="150" x2="220" y2="70" stroke="url(#about-founder-k)" strokeWidth="8" strokeLinecap="square" />
      <line x1="80" y1="150" x2="220" y2="230" stroke="url(#about-founder-k)" strokeWidth="8" strokeLinecap="square" />
    </svg>
  );
}
