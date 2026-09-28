import { useState, type ReactNode } from "react";
import { explain, type Answer, type Decision, type Item, type PackageRef, type Work } from "../api/client";
import { useSettings } from "../app/settings";
import { SourcePreview } from "../home/SourcePreview";
import type { Key } from "../i18n";
import { NoteForm } from "./NoteForm";
import { useAnswer } from "./queries";

/** The one thing waiting for the engineer, and how many more wait behind it. */
export function DecisionCard({
  projectId,
  decision,
  more,
  work,
}: {
  projectId: string;
  decision: Decision;
  more: number;
  work: Work;
}) {
  const { t } = useSettings();
  const answer = useAnswer(projectId);
  const send = (body: Answer) => answer.mutate({ id: decision.id, answer: body });
  const busy = answer.isPending;

  return (
    <section
      aria-label={t("decision.label")}
      className="flex flex-col gap-3 rounded-xl border border-amber-line bg-amber-soft/40 px-5 py-4"
    >
      <div className="flex items-center gap-3 text-sm">
        <span className="font-semibold text-amber">{t("decision.needsYou")}</span>
        {more > 0 && <span className="text-ink-2">{t("decision.more", { count: more })}</span>}
      </div>
      {decision.kind === "consent" && <Consent decision={decision} send={send} busy={busy} />}
      {decision.kind === "overlap" && <Overlap decision={decision} send={send} busy={busy} />}
      {decision.kind === "plan" && <Plan decision={decision} send={send} busy={busy} />}
      {decision.kind === "uncertain" && <Uncertain projectId={projectId} decision={decision} send={send} busy={busy} />}
      {decision.kind === "publish" && <Publish decision={decision} send={send} busy={busy} work={work} />}
      {answer.isError && (
        <p role="alert" className="text-sm text-danger">
          {explain(answer.error, t)}
        </p>
      )}
    </section>
  );
}

type Props = { decision: Decision; send: (answer: Answer) => void; busy: boolean };

/** Where a consent sends the project: the provider in the engineer's language, and a compatible service's address. */
export function serviceOf(decision: Decision, t: ReturnType<typeof useSettings>["t"]): string {
  const provider = t(`provider.${decision.provider}` as Key);
  return decision.host ? `${provider} (${decision.host})` : provider;
}

const primary = "rounded-lg bg-button px-4 py-1.5 text-button-ink disabled:opacity-50";
const secondary = "rounded-lg border border-line bg-page px-4 py-1.5 hover:border-ink disabled:opacity-50";

function Title({ children }: { children: ReactNode }) {
  return <h2 className="text-xl font-light [unicode-bidi:plaintext]">{children}</h2>;
}

function Consent({ decision, send, busy }: Props) {
  const { t } = useSettings();
  const service = serviceOf(decision, t);
  return (
    <>
      <Title>{t("consent.title", { service })}</Title>
      <p className="text-ink-2">{t("consent.body", { service })}</p>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => send({ approve: true })} className={primary}>
          {t("consent.allow")}
        </button>
        <button type="button" disabled={busy} onClick={() => send({ approve: false })} className={secondary}>
          {t("consent.decline")}
        </button>
      </div>
    </>
  );
}

function Overlap({ decision, send, busy }: Props) {
  const { t } = useSettings();
  const names = { file: decision.file ?? "", earlier: decision.earlier ?? "" };
  const relations = ["revision", "replacement", "addition"] as const;
  return (
    <>
      <Title>{t("overlap.title", names)}</Title>
      <p className="text-ink-2">{t("overlap.body", { ...names, share: Math.round((decision.share ?? 0) * 100) })}</p>
      <div className="flex flex-col gap-2">
        {relations.map((relation) => (
          <button
            key={relation}
            type="button"
            disabled={busy}
            onClick={() => send({ relation })}
            className="flex flex-col items-start rounded-lg border border-line bg-page px-4 py-2 text-start hover:border-ink disabled:opacity-50"
          >
            <span className="flex items-center gap-2 font-semibold">
              {t(`overlap.${relation}` as Key)}
              {decision.recommended === relation && <Suggested />}
            </span>
            <span className="text-sm text-ink-2">{t(`overlap.${relation}Note` as Key, names)}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function Suggested() {
  const { t } = useSettings();
  return <span className="rounded-full border border-amber-line px-2 text-xs font-normal text-amber">{t("decision.suggested")}</span>;
}

type Entry = { key: number; name: string; scope: string; reason: string; keeps: PackageRef[] };

/** The proposed packages: approved as they are, edited first (rename, scope, remove, merge, add), or proposed
 *  again with a note. */
function Plan({ decision, send, busy }: Props) {
  const { t, locale } = useSettings();
  const list = (names: string[]) => new Intl.ListFormat(locale).format(names);
  const planned = decision.packages ?? [];
  const removed = decision.removed ?? [];
  // A first plan is all new; a change to current packages says what each one keeps, merges or adds.
  const revising = removed.length > 0 || planned.some((entry) => entry.keeps.length > 0);
  const [editing, setEditing] = useState(false);
  const [redoing, setRedoing] = useState(false);
  const [entries, setEntries] = useState<Entry[]>(() => planned.map((e, key) => ({ key, ...e })));
  const change = (key: number, patch: Partial<Entry>) =>
    setEntries(entries.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  const merge = (from: Entry, into: number) =>
    setEntries(
      entries
        .filter((e) => e.key !== from.key)
        .map((e) =>
          e.key === into
            ? { ...e, keeps: [...e.keeps, ...from.keeps], scope: [e.scope, from.scope].filter(Boolean).join(" ") }
            : e,
        ),
    );
  const add = () =>
    setEntries([...entries, { key: Math.max(-1, ...entries.map((e) => e.key)) + 1, name: "", scope: "", reason: "", keeps: [] }]);
  const names = entries.map((e) => e.name.trim().toLocaleLowerCase(locale));
  const ready = entries.length > 0 && names.every((n) => n) && new Set(names).size === names.length;
  const approve = () =>
    send(
      editing
        ? {
            approve: true,
            packages: entries.map((e) => ({ name: e.name.trim(), scope: e.scope, reason: e.reason, keeps: e.keeps.map((k) => k.id) })),
          }
        : { approve: true },
    );
  const field = "rounded-lg border border-line bg-page px-3 py-1.5 focus:border-ink focus:outline-none";

  return (
    <>
      <Title>{t("plan.title", { count: entries.length })}</Title>
      {decision.note && <p className="whitespace-pre-line text-ink-2 [unicode-bidi:plaintext]">{decision.note}</p>}
      <ol className="flex flex-col">
        {entries.map((entry, index) => (
          <li key={entry.key} className="flex flex-col gap-1 border-t border-line-soft py-2 first:border-t-0">
            {editing ? (
              <>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-ink-2 tabular-nums">{index + 1}.</span>
                  <input
                    aria-label={t("plan.name", { number: index + 1 })}
                    placeholder={t("plan.newName")}
                    value={entry.name}
                    dir="auto"
                    maxLength={120}
                    onChange={(event) => change(entry.key, { name: event.target.value })}
                    className={`${field} min-w-0 flex-1 font-semibold`}
                  />
                  {entries.length > 1 && (
                    <select
                      aria-label={t("plan.mergeInto", { number: index + 1 })}
                      value=""
                      onChange={(event) => event.target.value && merge(entry, Number(event.target.value))}
                      className="rounded-md border border-line bg-page px-2 py-1 text-sm"
                    >
                      <option value="">{t("packages.mergeInto")}</option>
                      {entries
                        .filter((other) => other.key !== entry.key)
                        .map((other) => (
                          <option key={other.key} value={other.key}>
                            {entries.indexOf(other) + 1}. {other.name}
                          </option>
                        ))}
                    </select>
                  )}
                  <button
                    type="button"
                    aria-label={t("plan.remove", { number: index + 1 })}
                    onClick={() => setEntries(entries.filter((e) => e.key !== entry.key))}
                    className="rounded-md border border-line px-2 py-1 text-sm text-danger hover:border-danger"
                  >
                    {t("packages.remove")}
                  </button>
                </span>
                <textarea
                  aria-label={t("plan.scope", { number: index + 1 })}
                  value={entry.scope}
                  rows={2}
                  dir="auto"
                  maxLength={1000}
                  onChange={(event) => change(entry.key, { scope: event.target.value })}
                  className={field}
                />
              </>
            ) : (
              <>
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm text-ink-2 tabular-nums">{index + 1}.</span>
                  <span className="font-semibold [unicode-bidi:plaintext]">{entry.name}</span>
                  {revising && (
                    <span className="text-sm text-ink-2">
                      {entry.keeps.length === 0
                        ? t("plan.new")
                        : t(entry.keeps.length === 1 ? "plan.continues" : "plan.merges", {
                            codes: list(entry.keeps.map((k) => `${k.code} ${k.name}`)),
                          })}
                    </span>
                  )}
                </span>
                {entry.scope && <span className="[unicode-bidi:plaintext]">{entry.scope}</span>}
                {entry.reason && <span className="text-sm text-ink-2 [unicode-bidi:plaintext]">{entry.reason}</span>}
              </>
            )}
          </li>
        ))}
      </ol>
      {editing && (
        <button type="button" onClick={add} className={`${secondary} self-start text-sm`}>
          {t("plan.add")}
        </button>
      )}
      {removed.length > 0 && !editing && (
        <p className="text-sm text-amber">{t("plan.removes", { names: list(removed.map((r) => `${r.code} ${r.name}`)) })}</p>
      )}
      {redoing ? (
        <NoteForm
          busy={busy}
          onCancel={() => setRedoing(false)}
          onRun={(note) => {
            send({ approve: false, note });
            setRedoing(false);
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || !ready} onClick={approve} className={primary}>
            {t("plan.approve")}
          </button>
          {!editing && (
            <button type="button" disabled={busy} onClick={() => setEditing(true)} className={secondary}>
              {t("plan.edit")}
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => setRedoing(true)} className={secondary}>
            {t("plan.redo")}
          </button>
          {revising && (
            <button type="button" disabled={busy} onClick={() => send({ approve: false })} className={secondary}>
              {t("plan.keep")}
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** Where an item is in its file, in words: "Tower BOQ.xlsx, row 12" or "MEP.pdf, page 3". */
export function whereIs(item: Item, t: ReturnType<typeof useSettings>["t"]): string {
  const row = item.provenance.row as number | undefined;
  return row
    ? t("source.atRow", { file: item.file, sheet: String(item.provenance.sheet ?? ""), row })
    : t("source.atPage", { file: item.file, page: item.page });
}

function Uncertain({ projectId, decision, send, busy }: Props & { projectId: string }) {
  const { t } = useSettings();
  const [scope, setScope] = useState<"item" | "project" | "all">("project");
  const [showing, setShowing] = useState(false);
  const item = decision.item;
  return (
    <>
      <Title>{t("uncertain.title")}</Title>
      {item && (
        <div className="flex flex-col gap-1 rounded-lg border border-line bg-page px-4 py-3">
          <span className="flex flex-wrap gap-x-3">
            <span className="font-semibold tabular-nums">{item.code}</span>
            <span className="[unicode-bidi:plaintext]">{item.description}</span>
          </span>
          <span className="flex flex-wrap gap-x-4 text-sm text-ink-2">
            {item.unit && <span>{item.unit}</span>}
            {item.quantity_text && <span className="tabular-nums">{item.quantity_text}</span>}
            <button type="button" onClick={() => setShowing(!showing)} className="underline hover:text-ink">
              {whereIs(item, t)}
            </button>
          </span>
          {showing && (
            <div className="pt-2">
              <SourcePreview
                projectId={projectId}
                sourceId={item.source_id}
                focus={{
                  page: item.page,
                  row: item.provenance.row as number | undefined,
                  box: item.provenance.box as number[] | undefined,
                }}
              />
            </div>
          )}
        </div>
      )}
      {decision.reason && <p className="text-ink-2 [unicode-bidi:plaintext]">{decision.reason}</p>}
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <legend className="sr-only">{t("uncertain.scope")}</legend>
        <span className="text-ink-2">{t("uncertain.scope")}</span>
        {(["item", "project", "all"] as const).map((option) => (
          <label key={option} className="flex items-center gap-1.5">
            <input type="radio" name={`scope-${decision.id}`} checked={scope === option} onChange={() => setScope(option)} />
            {t(`scope.${option}` as Key)}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        {(decision.candidates ?? []).map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            disabled={busy}
            onClick={() => send({ package_id: candidate.id, scope })}
            className={`${secondary} flex items-center gap-2`}
          >
            <span className="tabular-nums text-ink-2">{candidate.code}</span>
            <span className="[unicode-bidi:plaintext]">{candidate.name}</span>
            {decision.recommended === candidate.id && <Suggested />}
          </button>
        ))}
      </div>
    </>
  );
}

/** What the revision would hold, as Tawreed computed it, and whether the package workbooks show rates. */
function Publish({ send, busy, work }: Props & { work: Work }) {
  const { t, locale } = useSettings();
  const [prices, setPrices] = useState(true);
  const amount = Number(work.coverage.amount).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <>
      <Title>{t("publish.title")}</Title>
      <p className="text-ink-2">
        {t("publish.body", { packages: work.packages.length, items: work.coverage.items, amount })}
      </p>
      {work.coverage.totals_differ > 0 && (
        <p className="text-sm text-amber">{t("publish.totalsDiffer", { count: work.coverage.totals_differ })}</p>
      )}
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={prices} onChange={(e) => setPrices(e.target.checked)} className="mt-1" />
        <span className="flex flex-col">
          <span>{t("publish.prices")}</span>
          <span className="text-sm text-ink-2">{t("publish.pricesNote")}</span>
        </span>
      </label>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => send({ approve: true, prices })} className={primary}>
          {t("publish.approve")}
        </button>
        <button type="button" disabled={busy} onClick={() => send({ approve: false })} className={secondary}>
          {t("publish.notYet")}
        </button>
      </div>
    </>
  );
}
