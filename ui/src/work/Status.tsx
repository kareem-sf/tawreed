import { explain, type Decision, type Run } from "../api/client";
import { useSettings } from "../app/settings";
import type { Key, Translate } from "../i18n";
import { serviceOf } from "./DecisionCard";
import { useRun } from "./queries";

/** What runs on the project now, with Stop; or why it paused, with Continue. Always Tawreed's own words. */
export function Status({ projectId, run }: { projectId: string; run: Run }) {
  const { t } = useSettings();
  const { stop, carryOn } = useRun(projectId);
  if (run.state !== "running" && run.state !== "paused") return null;
  const failed = stop.error ?? carryOn.error;
  const button = "shrink-0 rounded-md border border-line px-2 py-0.5 text-ink hover:border-ink disabled:opacity-50";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3 text-sm text-ink-2">
        {run.state === "running" ? (
          <>
            <span className="size-[7px] shrink-0 animate-pulse rounded-full bg-ink" aria-hidden="true" />
            <span role="status" className="[unicode-bidi:plaintext]">
              {running(run, t)}
            </span>
            <button type="button" disabled={stop.isPending} onClick={() => stop.mutate()} className={button}>
              {t("run.stop")}
            </button>
          </>
        ) : (
          <>
            <span role="status" className="flex-1 text-amber">
              {pausedBecause(run, t)}
            </span>
            <button type="button" disabled={carryOn.isPending} onClick={() => carryOn.mutate()} className={button}>
              {t("run.continue")}
            </button>
          </>
        )}
      </div>
      {failed && (
        <p role="alert" className="text-sm text-danger">
          {explain(failed, t)}
        </p>
      )}
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

/** What the engineer decided so far, one sentence each, oldest first. */
export function History({ answered }: { answered: Decision[] }) {
  const { t } = useSettings();
  if (answered.length === 0) return null;
  return (
    <section aria-label={t("history.label")}>
      <ol className="flex flex-col gap-1.5">
        {answered.map((decision) => (
          <li key={decision.id} className="text-sm text-ink-2 [unicode-bidi:plaintext]">
            {decided(decision, t)}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The engineer's answer, in a sentence. */
export function decided(decision: Decision, t: Translate): string {
  const a = (decision.answer ?? {}) as Record<string, unknown>;
  const note = a.note ? `: ${String(a.note)}` : ".";
  switch (decision.kind) {
    case "consent":
      return a.approve ? t("answered.consent", { service: serviceOf(decision, t) }) : t("answered.consentNo");
    case "overlap":
      return t(`answered.${String(a.relation)}` as Key, { file: decision.file ?? "", earlier: decision.earlier ?? "" });
    case "plan":
      if (!a.approve) return t("answered.planNo") + note;
      return t(a.edited ? "answered.planEdited" : "answered.plan");
    case "uncertain":
      return t(`answered.uncertain.${String(a.scope ?? "item")}` as Key, {
        code: decision.item?.code || String(decision.item?.ref ?? ""),
        package: String(a.package ?? ""),
      });
    default:
      return a.approve ? t("answered.publish") : t("answered.publishNo") + ".";
  }
}
