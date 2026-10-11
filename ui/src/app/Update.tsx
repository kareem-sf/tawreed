import { useMutation, useQuery } from "@tanstack/react-query";
import { installUpdate, newerVersion } from "../api/client";
import { useSettings } from "./settings";
import { Alert, button } from "./ui";

/** A line under the header when a newer Tawreed is published: the engineer chooses when to install it. */
export function Update() {
  const { t } = useSettings();
  const version = useQuery({ queryKey: ["update"], queryFn: newerVersion, staleTime: Infinity, retry: false });
  const install = useMutation({ mutationFn: installUpdate });
  if (!version.data) return null;

  return (
    <div className="shrink-0 border-b border-amber-line bg-amber-soft">
      <div className="mx-auto flex w-full max-w-[880px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
        <span role="status" className="min-w-0 flex-1 text-amber">
          {install.isPending ? t("update.installing") : t("update.ready", { version: version.data })}
        </span>
        {!install.isPending && (
          <button type="button" onClick={() => install.mutate()} className={button("secondary", "sm")}>
            {t("update.install")}
          </button>
        )}
        {install.isError && <Alert>{t("update.failed")}</Alert>}
      </div>
    </div>
  );
}
