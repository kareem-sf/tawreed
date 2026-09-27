import { useQuery } from "@tanstack/react-query";
import { api, explain, must } from "../api/client";
import { useSettings } from "../app/settings";

export function About() {
  const { t } = useSettings();
  const about = useQuery({ queryKey: ["about"], queryFn: () => must(api.GET("/about")) });

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-4 pt-5 pb-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-[28px] font-light tracking-[-0.01em]">{t("about.title")}</h1>
        <p className="text-ink-2">{t("about.tagline")}</p>
        {about.data && <p className="text-ink-2">{t("about.version", { version: about.data.version })}</p>}
      </div>
      {about.isError && (
        <p role="alert" className="text-danger">
          {explain(about.error, t)}
        </p>
      )}
      {about.data && (
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">{t("about.data")}</h2>
          <p dir="ltr" className="text-start text-ink-2">
            {about.data.data_folder}
          </p>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">{t("about.licences")}</h2>
        <p className="text-ink-2">{t("about.license")}</p>
        <p className="text-ink-2">{t("about.figtree")}</p>
        <p className="text-ink-2">{t("about.thmanyah")}</p>
      </div>
    </div>
  );
}
