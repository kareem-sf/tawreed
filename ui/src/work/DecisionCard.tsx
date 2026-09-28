import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { explain, type Answer, type Decision, type Item, type PackageRef, type Work } from "../api/client";
import { money } from "../app/format";
import { useSettings } from "../app/settings";
import { Alert, button, field, fieldSmall, Icon, link, textArea } from "../app/ui";
import { SourcePreview } from "../home/SourcePreview";
import type { Key } from "../i18n";
import { NoteForm } from "./NoteForm";
import { useAnswer } from "./queries";

// Answering unmounts the pressed button; the next card then takes the focus, so a keyboard user carries on there.
let justAnswered = false;

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
  const title = useRef<HTMLHeadingElement>(null);
  const send = (body: Answer) => {
    justAnswered = true;
    answer.mutate({ id: decision.id, answer: body });
  };
  const busy = answer.isPending;

  useEffect(() => {
    if (!justAnswered) return;
    justAnswered = false;
    title.current?.focus();
  }, []);

  return (
    <section
      aria-label={t("decision.label")}
      aria-busy={busy}
      className="flex flex-col gap-4 rounded-xl border border-amber-line bg-amber-soft/40 px-5 py-5 shadow-[0_1px_2px_var(--shadow-near)] animate-enter"
    >
      <div className="flex items-center gap-2.5 text-sm">
        <span className="size-2 rounded-full bg-amber" aria-hidden="true" />
        <span className="font-semibold text-amber">{t("decision.needsYou")}</span>
        {more > 0 && <span className="text-ink-2">{t("decision.more", { count: more })}</span>}
      </div>
      <TitleContext.Provider value={title}>
        {decision.kind === "consent" && <Consent decision={decision} send={send} busy={busy} />}
        {decision.kind === "overlap" && <Overlap decision={decision} send={send} busy={busy} />}
        {decision.kind === "plan" && <Plan decision={decision} send={send} busy={busy} />}
        {decision.kind === "uncertain" && <Uncertain projectId={projectId} decision={decision} send={send} busy={busy} />}
        {decision.kind === "publish" && <Publish decision={decision} send={send} busy={busy} work={work} />}
      </TitleContext.Provider>
      {answer.isError && <Alert>{explain(answer.error, t)}</Alert>}
    </section>
  );
}

type Props = { decision: Decision; send: (answer: Answer) => void; busy: boolean };

/** Where a consent sends the project: the provider in the engineer's language, and a compatible service's address. */
export function serviceOf(decision: Decision, t: ReturnType<typeof useSettings>["t"]): string {
  const provider = t(`provider.${decision.provider}` as Key);
  return decision.host ? `${provider} (${decision.host})` : provider;
}

const TitleContext = createContext<RefObject<HTMLHeadingElement | null> | null>(null);

function Title({ children }: { children: ReactNode }) {
  const ref = useContext(TitleContext);
  return (
    <h2 ref={ref} tabIndex={-1} className="font-heading text-xl leading-7 font-light [unicode-bidi:plaintext] focus:outline-hidden focus-visible:outline-2">
      {children}
    </h2>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2 pt-1">{children}</div>;
}

function Consent({ decision, send, busy }: Props) {
  const { t } = useSettings();
  const service = serviceOf(decision, t);
  return (
    <>
      <Title>{t("consent.title", { service })}</Title>
      <p className="text-ink-2">{t("consent.body", { service })}</p>
      <Actions>
        <button type="button" disabled={busy} onClick={() => send({ approve: true })} className={button("primary")}>
          {t("consent.allow")}
        </button>
        <button type="button" disabled={busy} onClick={() => send({ approve: false })} className={button("secondary")}>
          {t("consent.decline")}
        </button>
      </Actions>
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
            className="flex flex-col items-start gap-0.5 rounded-lg border border-line-strong bg-page px-4 py-3 text-start transition-colors duration-150 hover:border-ink/40 hover:bg-soft active:bg-subtle disabled:opacity-45"
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

/** Tawreed's suggestion: shown plainly, since amber means only that something needs the engineer. */
function Suggested() {
  const { t } = useSettings();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-subtle px-2 text-xs leading-5 font-normal text-ink">
      <Icon name="check" size={12} />
      {t("decision.suggested")}
    </span>
  );
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
  const [focus, setFocus] = useState<number | null>(null); // the entry whose name takes the focus
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
  const add = () => {
    const key = Math.max(-1, ...entries.map((e) => e.key)) + 1;
    setEntries([...entries, { key, name: "", scope: "", reason: "", keeps: [] }]);
    setFocus(key);
  };
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

  return (
    <>
      <Title>{t("plan.title", { count: entries.length })}</Title>
      {decision.note && <p className="whitespace-pre-line text-ink-2 [unicode-bidi:plaintext]">{decision.note}</p>}
      <ol className="flex flex-col rounded-lg border border-line bg-page">
        {entries.map((entry, index) => (
          <li key={entry.key} className="flex flex-col gap-1.5 border-t border-line-soft px-4 py-3 first:border-t-0">
            {editing ? (
              <>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="w-5 text-sm text-ink-2">{index + 1}.</span>
                  <input
                    aria-label={t("plan.name", { number: index + 1 })}
                    placeholder={t("plan.newName")}
                    value={entry.name}
                    dir="auto"
                    maxLength={120}
                    autoFocus={focus === null ? index === 0 : entry.key === focus}
                    onChange={(event) => change(entry.key, { name: event.target.value })}
                    className={`${field} min-w-0 flex-1 basis-48 font-semibold`}
                  />
                  {entries.length > 1 && (
                    <select
                      aria-label={t("plan.mergeInto", { number: index + 1 })}
                      value=""
                      onChange={(event) => event.target.value && merge(entry, Number(event.target.value))}
                      className={`${fieldSmall} w-40 max-w-full`}
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
                    className={button("danger", "sm")}
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
                  className={`${textArea} ms-7`}
                />
              </>
            ) : (
              <>
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="w-5 shrink-0 text-sm text-ink-2">{index + 1}.</span>
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
                {entry.scope && <span className="ps-7 [unicode-bidi:plaintext]">{entry.scope}</span>}
                {entry.reason && <span className="ps-7 text-sm text-ink-2 [unicode-bidi:plaintext]">{entry.reason}</span>}
              </>
            )}
          </li>
        ))}
      </ol>
      {editing && (
        <button type="button" onClick={add} className={`${button("secondary", "sm")} self-start`}>
          <Icon name="plus" size={14} />
          {t("plan.add")}
        </button>
      )}
      {removed.length > 0 && !editing && (
        <p className="text-sm text-ink-2">{t("plan.removes", { names: list(removed.map((r) => `${r.code} ${r.name}`)) })}</p>
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
        <Actions>
          <button type="button" disabled={busy || !ready} onClick={approve} className={button("primary")}>
            {t("plan.approve")}
          </button>
          {!editing && (
            <button type="button" disabled={busy} onClick={() => setEditing(true)} className={button("secondary")}>
              {t("plan.edit")}
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => setRedoing(true)} className={button("secondary")}>
            {t("plan.redo")}
          </button>
          {revising && (
            <button type="button" disabled={busy} onClick={() => send({ approve: false })} className={button("quiet")}>
              {t("plan.keep")}
            </button>
          )}
        </Actions>
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
            <span className="font-semibold">{item.code}</span>
            <span className="[unicode-bidi:plaintext]">{item.description}</span>
          </span>
          <span className="flex flex-wrap items-center gap-x-4 text-sm text-ink-2">
            {item.unit && <span>{item.unit}</span>}
            {item.quantity_text && <span>{item.quantity_text}</span>}
            <button type="button" aria-expanded={showing} onClick={() => setShowing(!showing)} className={link}>
              {whereIs(item, t)}
            </button>
          </span>
          {showing && (
            <div className="pt-2 animate-enter">
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
        <legend className="float-start me-1 text-ink-2">{t("uncertain.scope")}</legend>
        {(["item", "project", "all"] as const).map((option) => (
          <label key={option} className="flex cursor-pointer items-center gap-1.5 pointer-coarse:py-2">
            <input type="radio" name={`scope-${decision.id}`} checked={scope === option} onChange={() => setScope(option)} />
            {t(`scope.${option}` as Key)}
          </label>
        ))}
      </fieldset>
      <Actions>
        {(decision.candidates ?? []).map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            disabled={busy}
            onClick={() => send({ package_id: candidate.id, scope })}
            className={button("secondary")}
          >
            <span className="text-ink-2">{candidate.code}</span>
            <span className="[unicode-bidi:plaintext]">{candidate.name}</span>
            {decision.recommended === candidate.id && <Suggested />}
          </button>
        ))}
      </Actions>
    </>
  );
}

/** What the revision would hold, as Tawreed computed it, and whether the package workbooks show rates. */
function Publish({ send, busy, work }: Props & { work: Work }) {
  const { t, locale } = useSettings();
  const [prices, setPrices] = useState(true);
  return (
    <>
      <Title>{t("publish.title")}</Title>
      <p className="text-ink-2">
        {t("publish.body", { packages: work.packages.length, items: work.coverage.items, amount: money(work.coverage.amount, locale) })}
      </p>
      {work.coverage.totals_differ > 0 && (
        <p className="text-sm text-amber">{t("publish.totalsDiffer", { count: work.coverage.totals_differ })}</p>
      )}
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-page px-4 py-3 transition-colors hover:border-line-strong">
        <input type="checkbox" checked={prices} onChange={(e) => setPrices(e.target.checked)} className="mt-1 size-4" />
        <span className="flex flex-col gap-0.5">
          <span>{t("publish.prices")}</span>
          <span className="text-sm text-ink-2">{t("publish.pricesNote")}</span>
        </span>
      </label>
      <Actions>
        <button type="button" disabled={busy} onClick={() => send({ approve: true, prices })} className={button("primary")}>
          {busy ? t("publish.publishing") : t("publish.approve")}
        </button>
        <button type="button" disabled={busy} onClick={() => send({ approve: false })} className={button("secondary")}>
          {t("publish.notYet")}
        </button>
      </Actions>
    </>
  );
}
