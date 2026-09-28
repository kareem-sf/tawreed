import { Fragment, useState } from "react";
import { explain, type Item, type PackageSummary } from "../api/client";
import { useSettings } from "../app/settings";
import { SourcePreview } from "../home/SourcePreview";
import { whereIs } from "./DecisionCard";
import { NoteForm } from "./NoteForm";
import { useEdits, useItems, useRedo, useWork, type ItemFilter } from "./queries";

/** The packages and their items, to look at and change directly, with the same checked operations the AI's
 *  steps use; or to have the AI place them again, with a note. */
export function Packages({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const { t } = useSettings();
  const work = useWork(projectId);
  const edits = useEdits(projectId);
  const redo = useRedo(projectId);
  const [adding, setAdding] = useState(false);
  const [placingAll, setPlacingAll] = useState(false);
  const failed = [...Object.values(edits), redo].find((m) => m.isError);

  if (!work.data) return null;
  const { packages, coverage } = work.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-ink-2 hover:text-ink">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="rtl:-scale-x-100">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          {t("packages.back")}
        </button>
        <h2 className="text-[28px] font-light">{t("packages.title")}</h2>
        <div className="flex-1" />
        {!placingAll && packages.length > 0 && (
          <button type="button" onClick={() => setPlacingAll(true)} className="rounded-lg border border-line px-3.5 py-1 text-sm">
            {t("packages.placeAllAgain")}
          </button>
        )}
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="rounded-lg border border-line px-3.5 py-1 text-sm">
            {t("packages.new")}
          </button>
        )}
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
          onSave={(name) => edits.create.mutate(name, { onSuccess: () => setAdding(false) })}
          onCancel={() => setAdding(false)}
        />
      )}
      {failed?.error && (
        <p role="alert" className="text-danger">
          {explain(failed.error, t)}
        </p>
      )}
      <ul className="flex flex-col">
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
            package_={pkg}
            title={pkg.name}
            count={pkg.items}
            packages={packages}
          />
        ))}
      </ul>
    </div>
  );
}

function NameForm({
  label,
  submit,
  initial = "",
  onSave,
  onCancel,
}: {
  label: string;
  submit: string;
  initial?: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const { t } = useSettings();
  const [name, setName] = useState(initial);
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) onSave(name.trim());
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
        onKeyDown={(event) => event.key === "Escape" && onCancel()}
        className="min-w-0 flex-1 rounded-lg border border-line bg-page px-3 py-1.5 focus:border-ink focus:outline-none"
      />
      <button type="submit" disabled={!name.trim()} className="rounded-lg bg-button px-3.5 py-1.5 text-button-ink disabled:opacity-40">
        {submit}
      </button>
      <button type="button" onClick={onCancel} className="rounded-lg border border-line px-3.5 py-1.5">
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
}: {
  projectId: string;
  edits: Edits;
  redo?: ReturnType<typeof useRedo>;
  filter: ItemFilter;
  package_?: PackageSummary;
  title: string;
  count: number;
  packages: PackageSummary[];
}) {
  const { t } = useSettings();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [into, setInto] = useState("");
  const others = packages.filter((p) => p.id !== package_?.id);

  return (
    <li className="flex flex-col gap-3 border-t border-line-soft py-3">
      {renaming && package_ ? (
        <NameForm
          label={t("packages.rename")}
          submit={t("packages.save")}
          initial={package_.name}
          onSave={(name) => edits.rename.mutate({ id: package_.id, name }, { onSuccess: () => setRenaming(false) })}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-baseline gap-3 text-start">
          {package_ && <span className="text-sm tabular-nums text-ink-2">{package_.code}</span>}
          <span className={`flex-1 [unicode-bidi:plaintext] ${package_ ? "" : "text-amber"}`}>{title}</span>
          <span className="text-sm text-ink-2">{t("packages.items", { count })}</span>
          {package_ && package_.items > package_.without_amount && (
            <span className="w-32 text-end text-sm tabular-nums text-ink-2">{package_.amount}</span>
          )}
        </button>
      )}
      {open && package_ && (
        <div className="flex flex-col gap-2">
          {package_.scope && <p className="text-sm text-ink-2 [unicode-bidi:plaintext]">{package_.scope}</p>}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button type="button" onClick={() => setRenaming(true)} className="rounded-md border border-line px-2.5 py-0.5 hover:border-ink">
              {t("packages.rename")}
            </button>
            {others.length > 0 && (
              <>
                <select
                  aria-label={t("packages.mergeInto")}
                  value={into}
                  onChange={(event) => setInto(event.target.value)}
                  className="rounded-md border border-line bg-page px-2 py-0.5"
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
                  className="rounded-md border border-line px-2.5 py-0.5 hover:border-ink disabled:opacity-40"
                >
                  {t("packages.merge")}
                </button>
              </>
            )}
            {redo && !placing && (
              <button type="button" onClick={() => setPlacing(true)} className="rounded-md border border-line px-2.5 py-0.5 hover:border-ink">
                {t("packages.placeAgain")}
              </button>
            )}
            <button
              type="button"
              disabled={edits.remove.isPending}
              onClick={() => edits.remove.mutate(package_.id)}
              className="rounded-md border border-line px-2.5 py-0.5 text-danger hover:border-danger"
            >
              {t("packages.remove")}
            </button>
          </div>
          {redo && placing && (
            <NoteForm
              busy={redo.isPending}
              onCancel={() => setPlacing(false)}
              onRun={(note) =>
                redo.mutate({ step: "place", package_id: package_.id, note }, { onSuccess: () => setPlacing(false) })
              }
            />
          )}
        </div>
      )}
      {open && <Items projectId={projectId} edits={edits} filter={filter} packages={packages} />}
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

  if (items.isError) {
    return (
      <p role="alert" className="text-danger">
        {explain(items.error, t)}
      </p>
    );
  }
  if (!items.data) return null;
  const list = items.data.items;
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const choices = packages.filter((p) => p.id !== filter.package_id);

  return (
    <div className="flex flex-col gap-2">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t("packages.selected", { count: selected.size })}</span>
          <select
            aria-label={t("packages.moveTo")}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className="rounded-md border border-line bg-page px-2 py-0.5"
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
            className="rounded-md bg-button px-2.5 py-0.5 text-button-ink disabled:opacity-40"
          >
            {t("packages.move")}
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="text-ink-2">
            <tr>
              <th className="w-6" />
              <th className="px-2 py-1 text-start font-normal">{t("item.code")}</th>
              <th className="px-2 py-1 text-start font-normal">{t("item.description")}</th>
              <th className="px-2 py-1 text-start font-normal">{t("item.unit")}</th>
              <th className="px-2 py-1 text-end font-normal">{t("item.quantity")}</th>
              <th className="px-2 py-1 text-end font-normal">{t("item.rate")}</th>
              <th className="px-2 py-1 text-end font-normal">{t("item.amount")}</th>
              <th className="px-2 py-1 text-start font-normal">{t("item.source")}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((item) => (
              <Fragment key={item.id}>
                <tr className="border-t border-line-soft align-top">
                  <td className="py-1">
                    <input
                      type="checkbox"
                      aria-label={t("packages.select", { code: item.code || String(item.ref) })}
                      checked={selected.has(item.id)}
                      onChange={() => toggle(item.id)}
                    />
                  </td>
                  <td className="px-2 py-1 tabular-nums whitespace-nowrap">{item.code}</td>
                  <td className="px-2 py-1" dir="auto">
                    {item.description}
                    {item.verify && <span className="ms-2 text-xs text-amber">{t("item.verify")}</span>}
                    {item.decided_by === "engineer" && <span className="ms-2 text-xs text-ink-2">{t("item.byYou")}</span>}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap" dir="auto">{item.unit}</td>
                  <td className="px-2 py-1 text-end tabular-nums whitespace-nowrap">{item.quantity_text}</td>
                  <td className="px-2 py-1 text-end tabular-nums whitespace-nowrap">{item.rate_text}</td>
                  <td className="px-2 py-1 text-end tabular-nums whitespace-nowrap">{item.amount_text}</td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    <button
                      type="button"
                      aria-expanded={showing === item.id}
                      onClick={() => setShowing(showing === item.id ? null : item.id)}
                      className="text-ink-2 underline hover:text-ink"
                    >
                      {whereIs(item, t)}
                    </button>
                  </td>
                </tr>
                {showing === item.id && (
                  <tr>
                    <td colSpan={8} className="pb-3">
                      <Source projectId={projectId} item={item} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
