import { useState } from "react";
import { explain, type Decision, type Message, type Work } from "../api/client";
import { useSettings } from "../app/settings";
import type { Key, Translate } from "../i18n";
import { serviceOf } from "./DecisionCard";
import { useSend, useStop } from "./queries";

type Entry = { at: string; key: string; message?: Message; decision?: Decision };

/** What the agent said, what the engineer wrote and decided, and Tawreed's notices, in the order they happened.
 *  Only real records appear here: nothing is made up to look like progress. */
export function Conversation({ projectId, work, canWrite }: { projectId: string; work: Work; canWrite: boolean }) {
  const { t } = useSettings();
  const entries: Entry[] = [
    ...work.messages.map((m) => ({ at: m.created_at, key: `m${m.id}`, message: m })),
    ...work.answered.map((d) => ({ at: d.answered_at ?? d.created_at, key: `d${d.id}`, decision: d })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <section aria-label={t("chat.label")} className="flex flex-col gap-3">
      {work.agent === "working" && <Working projectId={projectId} />}
      {entries.length > 0 && (
        <ol className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={entry.key}>
              {entry.message ? <Said message={entry.message} /> : <Decided decision={entry.decision!} />}
            </li>
          ))}
        </ol>
      )}
      {canWrite && <Composer projectId={projectId} />}
    </section>
  );
}

function Working({ projectId }: { projectId: string }) {
  const { t } = useSettings();
  const stop = useStop(projectId);
  return (
    <div className="flex items-center gap-3 text-sm text-ink-2">
      <span className="size-[7px] animate-pulse rounded-full bg-ink" aria-hidden="true" />
      <span role="status">{t("work.working")}</span>
      <button
        type="button"
        disabled={stop.isPending}
        onClick={() => stop.mutate()}
        className="rounded-md border border-line px-2 py-0.5 text-ink hover:border-ink disabled:opacity-50"
      >
        {t("work.stop")}
      </button>
    </div>
  );
}

function Said({ message }: { message: Message }) {
  const { t } = useSettings();
  if (message.sender === "tawreed") {
    return <p className="text-sm text-ink-2">{notice(message, t)}</p>;
  }
  const mine = message.sender === "engineer";
  return (
    <div className={`flex flex-col gap-0.5 ${mine ? "items-end" : "items-start"}`}>
      <span className="text-xs text-ink-2">{t(mine ? "chat.you" : "chat.agent")}</span>
      <p
        dir="auto"
        className={`max-w-[85%] whitespace-pre-line rounded-xl px-3.5 py-2 ${mine ? "bg-subtle" : "border border-line"}`}
      >
        {message.text}
      </p>
    </div>
  );
}

/** Tawreed's own notices are codes, said in the engineer's language. */
export function notice(message: Message, t: Translate): string {
  const params = (message.params ?? {}) as Record<string, string>;
  if (message.notice === "ai_failed") {
    const reason = `error.${params.problem}` as Key;
    return t("notice.ai_failed", { problem: t(reason) !== reason ? t(reason, params) : t("error.unknown", { status: "?" }) });
  }
  const key = `notice.${message.notice}` as Key;
  return t(key) !== key ? t(key, params) : t("notice.agent_failed");
}

function Decided({ decision }: { decision: Decision }) {
  const { t } = useSettings();
  return <p className="text-sm text-ink-2 [unicode-bidi:plaintext]">{decided(decision, t)}</p>;
}

/** The engineer's answer, in a sentence. */
export function decided(decision: Decision, t: Translate): string {
  const a = (decision.answer ?? {}) as Record<string, string | boolean | null>;
  const note = a.note ? `: ${a.note}` : ".";
  switch (decision.kind) {
    case "consent":
      return a.approve ? t("answered.consent", { service: serviceOf(decision, t) }) : t("answered.consentNo");
    case "overlap":
      return t(`answered.${a.relation}` as Key, { file: decision.file ?? "", earlier: decision.earlier ?? "" });
    case "plan":
      return a.approve ? t("answered.plan") : t("answered.planNo") + note;
    case "uncertain":
      return t(`answered.uncertain.${a.scope ?? "item"}` as Key, {
        code: decision.item?.code || String(decision.item?.ref ?? ""),
        package: String(a.package ?? ""),
      });
    case "question":
      return t("answered.question", { question: decision.question ?? "", answer: String(a.choice ?? a.note ?? "") });
    default:
      return a.approve ? t("answered.publish") : t("answered.publishNo") + note;
  }
}

function Composer({ projectId }: { projectId: string }) {
  const { t } = useSettings();
  const send = useSend(projectId);
  const [text, setText] = useState("");
  const submit = () => {
    const message = text.trim();
    if (!message || send.isPending) return;
    send.mutate(message, { onSuccess: () => setText("") });
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex items-end gap-2">
        <textarea
          aria-label={t("chat.write")}
          placeholder={t("chat.placeholder")}
          value={text}
          rows={1}
          dir="auto"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          className="field-sizing-content max-h-40 min-h-10 flex-1 resize-none rounded-lg border border-line bg-page px-3 py-2 focus:border-ink focus:outline-none"
        />
        <button
          type="submit"
          disabled={!text.trim() || send.isPending}
          className="rounded-lg bg-button px-4 py-2 text-button-ink disabled:opacity-40"
        >
          {t("chat.send")}
        </button>
      </div>
      {send.isError && (
        <p role="alert" className="text-sm text-danger">
          {explain(send.error, t)}
        </p>
      )}
    </form>
  );
}
