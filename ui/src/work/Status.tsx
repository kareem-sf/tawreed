import { explain, type Run } from "../api/client";
import { useSettings } from "../app/settings";
import { Alert, button } from "../app/ui";
import type { Key, Translate } from "../i18n";
import { useRun } from "./queries";

/** What runs on the project now, with Stop; or why it paused, with Continue. Always Tawreed's own words. */
export function Status({ projectId, run }: { projectId: string; run: Run }) {
  const { t } = useSettings();
  const { stop, carryOn } = useRun(projectId);
  if (run.state !== "running" && run.state !== "paused") return null;
  const failed = stop.error ?? carryOn.error;
  const share = run.total ? Math.min(1, (run.done ?? 0) / run.total) : null;
  return (
    <div className="flex flex-col gap-1.5 animate-enter">
      {run.state === "running" ? (
        <div className="flex flex-col gap-2 rounded-lg bg-subtle px-3 py-2">
          <div className="flex items-center gap-3 text-sm">
            <span className="size-[7px] shrink-0 rounded-full bg-ink motion-safe:animate-pulse" aria-hidden="true" />
            {/* Read out once per step; the counts beside it change every second, so they stay visual. */}
            <span role="status" className="min-w-0 flex-1 [unicode-bidi:plaintext]">
              <span className="sr-only">{t(`step.${run.step ?? "read"}` as Key)}</span>
              <span aria-hidden="true">{running(run, t)}</span>
            </span>
            <button type="button" disabled={stop.isPending} onClick={() => stop.mutate()} className={button("secondary", "sm")}>
              {stop.isPending ? t("run.stopping") : t("run.stop")}
            </button>
          </div>
          {share !== null && (
            <div className="h-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
              <div className="h-full rounded-full bg-ink transition-[width] duration-700 ease-out" style={{ width: `${share * 100}%` }} />
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-line bg-amber-soft px-3 py-2 text-sm">
          <span role="status" className="min-w-0 flex-1 text-amber">
            {pausedBecause(run, t)}
          </span>
          <button type="button" disabled={carryOn.isPending} onClick={() => carryOn.mutate()} className={button("secondary", "sm")}>
            {t("run.continue")}
          </button>
        </div>
      )}
      {failed && <Alert>{explain(failed, t)}</Alert>}
    </div>
  );
}

function running(run: Run, t: Translate): string {
  if (run.step === "read") return t("run.read", { file: run.file ?? "", done: run.done ?? 0, total: run.total ?? 0 });
  if (run.step === "place") return t("run.place", { done: run.done ?? 0, total: run.total ?? 0 });
  return t("run.plan");
}

/** Why the project paused, as a code said in the engineer's language. */
export function pausedBecause(run: Run, t: Translate): string {
  const problem = (run.problem ?? {}) as Record<string, string>;
  if (problem.code === "ai_failed") {
    const reason = `error.${problem.problem}` as Key;
    return t("paused.ai_failed", {
      problem: t(reason) !== reason ? t(reason, problem) : t("error.unknown", { status: "?" }),
    });
  }
  const key = (problem.code === "no_progress" ? `paused.no_progress.${problem.step}` : `paused.${problem.code}`) as Key;
  return t(key) !== key ? t(key) : t("paused.step_failed");
}
