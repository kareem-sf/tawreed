import { Fragment, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { explain, type Item, type PackageSummary } from "../api/client";
import { figure } from "../app/format";
import { useSettings } from "../app/settings";
import { Alert, Amount, button, Empty, field, fieldSmall, Icon, link, Skeleton, SkeletonRows, useNarrow } from "../app/ui";
import { SourcePreview } from "../home/SourcePreview";
import { whereIs } from "./DecisionCard";
import { NoteForm } from "./NoteForm";
import { useEdits, useItems, useRedo, useWork, type ItemFilter } from "./queries";

/** The packages and their items, to look at and change directly, with the same checked operations the AI's
 *  steps use; or to have the AI place them again, with a note. */
export function Packages({ projectId, opened, onBack }: { projectId: string; opened?: string; onBack: () => void }) {
  const { t } = useSettings();
  const work = useWork(projectId);
  const edits = useEdits(projectId);
  const redo = useRedo(projectId);
  const [adding, setAdding] = useState(false);
  const [placingAll, setPlacingAll] = useState(false);
  const failed = [...Object.values(edits), redo].find((m) => m.isError);

  if (!work.data) return <SkeletonRows rows={6} />;
  const { packages, coverage } = work.data;

  return (
    <div className="flex flex-col gap-5 animate-enter">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <button type="button" onClick={onBack} className={`${button("quiet", "sm")} -ms-2`}>
          <Icon name="back" />
          {t("packages.back")}
        </button>
        <h2 className="font-heading text-title font-light">{t("packages.title")}</h2>
        <div className="hidden flex-1 sm:block" />
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {!placingAll && packages.length > 0 && (
            <button type="button" onClick={() => setPlacingAll(true)} className={button("secondary", "sm")}>
              {t("packages.placeAllAgain")}
            </button>
          )}
          {!adding && (
            <button type="button" onClick={() => setAdding(true)} className={button("secondary", "sm")}>
              <Icon name="plus" size={14} />
              {t("packages.new")}
            </button>
          )}
        </div>
      </div>
      {placingAll && (
        <NoteForm
          busy={redo.isPending}
          onCancel={() => setPlacingAll(false)}
          onRun={(note) => redo.mutate({ step: "place", note }, { onSuccess: () => setPlacingAll(false) })}
        />
      )}
      <p className="text-sm text-ink-2">{t("coverage.summary", { placed: coverage.placed, count: coverage.items })}</p>
      {adding && (
        <NameForm
          label={t("packages.newName")}
          submit={t("packages.add")}
          busy={edits.create.isPending}
          onSave={(name) => edits.create.mutate(name, { onSuccess: () => setAdding(false) })}
          onCancel={() => setAdding(false)}
        />
      )}
      {failed?.error && <Alert>{explain(failed.error, t)}</Alert>}
      {packages.length === 0 && coverage.unplaced === 0 ? (
        <Empty>{t("packages.none")}</Empty>
      ) : (
        <ul className="flex flex-col border-b border-line-soft">
          {coverage.unplaced > 0 && (
            <Group
              projectId={projectId}
              edits={edits}
              filter={{ unplaced: true }}
              title={t("packages.unplaced")}
              count={coverage.unplaced}
              packages={packages}
            />
          )}
          {packages.map((pkg) => (
            <Group
              key={pkg.id}
              projectId={projectId}
              edits={edits}
              redo={redo}
              filter={{ package_id: pkg.id }}
              initiallyOpen={pkg.id === opened}
              package_={pkg}
              title={pkg.name}
              count={pkg.items}
              packages={packages}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NameForm({
  label,
  submit,
  initial = "",
  busy = false,
  onSave,
  onCancel,
}: {
  label: string;
  submit: string;
  initial?: string;
  busy?: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const { t } = useSettings();
  const [name, setName] = useState(initial);
  return (
    <form
      className="flex flex-wrap items-center gap-2 animate-enter"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() && !busy) onSave(name.trim());
      }}
    >
      <input
        aria-label={label}
        placeholder={label}
        value={name}
        dir="auto"
        maxLength={120}
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
        className={`${field} min-w-0 flex-1 basis-56`}
      />
      <button type="submit" disabled={!name.trim() || busy} className={button("primary")}>
        {submit}
      </button>
      <button type="button" onClick={onCancel} className={button("quiet")}>
        {t("packages.cancel")}
      </button>
    </form>
  );
}

/** One package (or the items not placed yet): its heading, and its items once opened. */
type Edits = ReturnType<typeof useEdits>;

function Group({
  projectId,
  edits,
  redo,
  filter,
  package_,
  title,
  count,
  packages,
  initiallyOpen = false,
}: {
  projectId: string;
  edits: Edits;
  redo?: ReturnType<typeof useRedo>;
  filter: ItemFilter;
  package_?: PackageSummary;
  title: string;
  count: number;
  packages: PackageSummary[];
  initiallyOpen?: boolean;
}) {
  const { t } = useSettings();
  const [open, setOpen] = useState(initiallyOpen);
  // A package opened from the project page comes into view, its heading taking the focus.
  const heading = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!initiallyOpen) return;
    heading.current?.scrollIntoView?.({ block: "start" });
    heading.current?.focus({ preventScroll: true });
  }, [initiallyOpen]);
  const [renaming, setRenaming] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [into, setInto] = useState("");
  const others = packages.filter((p) => p.id !== package_?.id);
  // After an inline form closes, the keyboard goes back to where it was.
  const renameButton = useRef<HTMLButtonElement>(null);
  const placeButton = useRef<HTMLButtonElement>(null);
  const back = (target: RefObject<HTMLButtonElement | null>) => requestAnimationFrame(() => target.current?.focus());

  return (
    <li className="flex flex-col border-t border-line-soft">
      {renaming && package_ ? (
        <div className="py-3">
          <NameForm
            label={t("packages.rename")}
            submit={t("packages.save")}
            initial={package_.name}
            busy={edits.rename.isPending}
            onSave={(name) =>
              edits.rename.mutate({ id: package_.id, name }, { onSuccess: () => (setRenaming(false), back(renameButton)) })
            }
            onCancel={() => (setRenaming(false), back(renameButton))}
          />
        </div>
      ) : (
        <button
          ref={heading}
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="-mx-3 grid grid-cols-[1rem_2rem_minmax(0,1fr)_auto] items-baseline gap-x-2 rounded-lg px-3 py-3 text-start transition-colors duration-150 hover:bg-soft sm:grid-cols-[1rem_2rem_minmax(0,1fr)_6.5rem_9rem]"
        >
          <span className={`self-center text-ink-2 transition-transform duration-150 ${open ? "rotate-90 rtl:-rotate-90" : ""}`}>
            <Icon name="next" size={14} />
          </span>
          <span className="text-sm text-ink-2">{package_?.code}</span>
          <span className={`min-w-0 [overflow-wrap:anywhere] [unicode-bidi:plaintext] rtl:text-right ${package_ ? "" : "font-semibold text-amber"}`}>
            {title}
            <span className="block text-sm font-normal text-ink-2 sm:hidden">{t("packages.items", { count })}</span>
          </span>
          <span className="hidden text-end text-sm text-ink-2 sm:block">{t("packages.items", { count })}</span>
          <span className="text-end text-sm whitespace-nowrap text-ink-2">
            {package_ && package_.items > package_.without_amount ? <Amount value={package_.amount} /> : null}
          </span>
        </button>
      )}
      {open && package_ && (
        <div className="flex flex-col gap-3 pb-3 ps-7 animate-enter">
          {package_.scope && <p className="text-sm text-ink-2 [unicode-bidi:plaintext]">{package_.scope}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button ref={renameButton} type="button" onClick={() => setRenaming(true)} className={button("secondary", "sm")}>
              {t("packages.rename")}
            </button>
            {others.length > 0 && (
              <span className="flex items-center gap-1.5">
                <select
                  aria-label={t("packages.mergeInto")}
                  value={into}
                  onChange={(event) => setInto(event.target.value)}
                  className={`${fieldSmall} max-w-48`}
                >
                  <option value="">{t("packages.mergeInto")}</option>
                  {others.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} {p.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!into || edits.merge.isPending}
                  onClick={() => edits.merge.mutate({ into, from: package_.id })}
                  className={button("secondary", "sm")}
                >
                  {t("packages.merge")}
                </button>
              </span>
            )}
            {redo && !placing && (
              <button ref={placeButton} type="button" onClick={() => setPlacing(true)} className={button("secondary", "sm")}>
                {t("packages.placeAgain")}
              </button>
            )}
            <button
              type="button"
              disabled={edits.remove.isPending}
              onClick={() => edits.remove.mutate(package_.id)}
              className={button("danger", "sm")}
            >
              {t("packages.remove")}
            </button>
          </div>
          {redo && placing && (
            <NoteForm
              busy={redo.isPending}
              onCancel={() => (setPlacing(false), back(placeButton))}
              onRun={(note) =>
                redo.mutate({ step: "place", package_id: package_.id, note }, { onSuccess: () => setPlacing(false) })
              }
            />
          )}
        </div>
      )}
      {open && (
        <div className={package_ ? "ps-7 pb-4" : "pb-4"}>
          <Items projectId={projectId} edits={edits} filter={filter} packages={packages} />
        </div>
      )}
    </li>
  );
}

function Items({
  projectId,
  edits,
  filter,
  packages,
}: {
  projectId: string;
  edits: Edits;
  filter: ItemFilter;
  packages: PackageSummary[];
}) {
  const { t } = useSettings();
  const items = useItems(projectId, filter);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [showing, setShowing] = useState<string | null>(null);
  const narrow = useNarrow();
  const { frame, table, fits } = useFits();

  if (items.isError) return <Alert onRetry={() => void items.refetch()}>{explain(items.error, t)}</Alert>;
  if (!items.data) return <Skeleton className="h-32 w-full" />;
  const list = items.data.items;
  if (list.length === 0) return <Empty>{t("packages.emptyGroup")}</Empty>;
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const choices = packages.filter((p) => p.id !== filter.package_id);
  const head = "sticky top-0 z-10 bg-page px-2 py-2 font-normal shadow-[inset_0_-1px_0_var(--line)]";

  return (
    <div ref={frame} className="flex flex-col gap-2">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-subtle px-3 py-2 text-sm animate-enter">
          <span className="font-semibold">{t("packages.selected", { count: selected.size })}</span>
          <select
            aria-label={t("packages.moveTo")}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className={`${fieldSmall} max-w-56`}
          >
            <option value="">{t("packages.moveTo")}</option>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!target || edits.place.isPending}
            onClick={() =>
              edits.place.mutate({ itemIds: [...selected], packageId: target }, { onSuccess: () => setSelected(new Set()) })
            }
            className={button("primary", "sm")}
          >
            {t("packages.move")}
          </button>
        </div>
      )}
      {narrow || !fits ? (
        <ItemCards
          projectId={projectId}
          list={list}
          selected={selected}
          toggle={toggle}
          showing={showing}
          setShowing={setShowing}
        />
      ) : (
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-line">
        <table ref={table} className="w-full border-collapse text-sm">
          <thead className="text-ink-2">
            <tr>
              <th className={`${head} sticky start-0 z-20 w-9`}>
                <span className="sr-only">{t("packages.selectColumn")}</span>
              </th>
              <th className={`${head} w-px text-start whitespace-nowrap`}>{t("item.code")}</th>
              <th className={`${head} w-full min-w-48 text-start`}>{t("item.description")}</th>
              <th className={`${head} w-px text-start whitespace-nowrap`}>{t("item.unit")}</th>
              <th className={`${head} w-px text-end whitespace-nowrap`}>{t("item.quantity")}</th>
              <th className={`${head} w-px text-end whitespace-nowrap`}>{t("item.rate")}</th>
              <th className={`${head} w-px text-end whitespace-nowrap`}>{t("item.amount")}</th>
              <th className={`${head} text-start`}>{t("item.source")}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((item) => (
              <Fragment key={item.id}>
                <tr
                  className={`border-t border-line-soft align-top transition-colors duration-100 hover:bg-soft ${selected.has(item.id) ? "bg-subtle" : ""}`}
                >
                  <td className="sticky start-0 bg-page px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label={t("packages.select", { code: item.code || String(item.ref) })}
                      checked={selected.has(item.id)}
                      onChange={() => toggle(item.id)}
                      className="size-4 pointer-coarse:size-5"
                    />
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">{item.code}</td>
                  <td className="px-2 py-2" dir="auto">
                    {item.description}
                    {item.verify && <span className="ms-2 text-xs text-amber">{t("item.verify")}</span>}
                    {item.decided_by === "engineer" && <span className="ms-2 text-xs text-ink-2">{t("item.byYou")}</span>}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap" dir="auto">
                    {item.unit}
                  </td>
                  <Figure text={item.quantity_text} />
                  <Figure text={item.rate_text} />
                  <Figure text={item.amount_text} />
                  <td className="w-40 min-w-40 px-2 py-2">
                    <button
                      type="button"
                      aria-expanded={showing === item.id}
                      onClick={() => setShowing(showing === item.id ? null : item.id)}
                      className={`text-start [overflow-wrap:anywhere] ${link}`}
                    >
                      {whereIs(item, t)}
                    </button>
                  </td>
                </tr>
                {showing === item.id && (
                  <tr>
                    <td colSpan={8} className="px-2 pb-3">
                      <Source projectId={projectId} item={item} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

/** Whether the items table fits its frame. Measured while the table shows and kept while the cards do, so a window
 *  that grows wide enough brings the table back. With no layout to measure (tests), the table shows. */
function useFits() {
  const [element, frame] = useState<HTMLDivElement | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const [needed, setNeeded] = useState(0);
  const [width, setWidth] = useState(Infinity);
  useLayoutEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setWidth(element.clientWidth);
      if (table.current) setNeeded(table.current.scrollWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  useLayoutEffect(() => {
    if (table.current) setNeeded(table.current.scrollWidth);
  });
  return { frame, table, fits: !(needed > width + 1) };
}

/** The items as cards, for a narrow window (or a table that wouldn't fit): nothing hidden or cut. */
function ItemCards({
  projectId,
  list,
  selected,
  toggle,
  showing,
  setShowing,
}: {
  projectId: string;
  list: Item[];
  selected: Set<string>;
  toggle: (id: string) => void;
  showing: string | null;
  setShowing: (id: string | null) => void;
}) {
  const { t } = useSettings();
  const fields = [
    ["item.unit", "unit"],
    ["item.quantity", "quantity_text"],
    ["item.rate", "rate_text"],
    ["item.amount", "amount_text"],
  ] as const;
  return (
    <ul className="flex flex-col rounded-lg border border-line">
      {list.map((item) => (
        <li key={item.id} className={`flex gap-3 border-t border-line-soft px-3 py-3 first:border-t-0 ${selected.has(item.id) ? "bg-subtle" : ""}`}>
          <input
            type="checkbox"
            aria-label={t("packages.select", { code: item.code || String(item.ref) })}
            checked={selected.has(item.id)}
            onChange={() => toggle(item.id)}
            className="mt-1 size-5 shrink-0"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="[overflow-wrap:anywhere]" dir="auto">
              {item.code && <span className="me-2 font-semibold">{item.code}</span>}
              {item.description}
              {item.verify && <span className="ms-2 text-xs text-amber">{t("item.verify")}</span>}
              {item.decided_by === "engineer" && <span className="ms-2 text-xs text-ink-2">{t("item.byYou")}</span>}
            </p>
            {/* Side by side where there is room; each pair moves to the next line whole, so a figure never breaks. */}
            <dl className="flex flex-wrap gap-x-6 gap-y-0.5 text-sm">
              {fields.map(([label, key]) =>
                item[key] ? (
                  <div key={key} className="flex min-w-0 gap-1.5">
                    <dt className="text-ink-2">{t(label)}</dt>
                    <dd className="min-w-0 break-words" dir="auto" title={figure(item[key]).exact}>
                      {figure(item[key]).shown}
                    </dd>
                  </div>
                ) : null,
              )}
            </dl>
            <button
              type="button"
              aria-expanded={showing === item.id}
              onClick={() => setShowing(showing === item.id ? null : item.id)}
              className={`self-start text-start text-sm ${link}`}
            >
              {whereIs(item, t)}
            </button>
            {showing === item.id && (
              <div className="animate-enter">
                <Source projectId={projectId} item={item} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A table cell holding a figure: as the source wrote it, float noise shown to the cent (the exact value on hover). */
function Figure({ text }: { text: string }) {
  const { shown, exact } = figure(text);
  return (
    <td className="px-2 py-2 text-end whitespace-nowrap" title={exact}>
      {shown}
    </td>
  );
}

function Source({ projectId, item }: { projectId: string; item: Item }) {
  return (
    <SourcePreview
      projectId={projectId}
      sourceId={item.source_id}
      focus={{ page: item.page, row: item.provenance.row as number | undefined, box: item.provenance.box as number[] | undefined }}
    />
  );
}
