import { useEffect, useRef, useState } from "react";
import { explain, type SheetLayout, type SheetView, type SourcePage } from "../api/client";
import { figure } from "../app/format";
import { useSettings } from "../app/settings";
import { Alert, button, field, fieldSmall, Icon, iconButton, Skeleton } from "../app/ui";
import type { Key } from "../i18n";
import { NoteForm } from "../work/NoteForm";
import { useLayouts, useRedo } from "../work/queries";
import { usePageImage, useSheet, useSource } from "./queries";

/** Where an item is: its page, and its row on a sheet or its box (points from the top left) on a PDF page. */
export type Focus = { page: number; row?: number; box?: number[] };

/** A read file as Tawreed has it: each sheet as a grid of cells, each page or image as a picture. With a focus,
 *  it opens at that item and marks it. Editable, it says how each page was read, and the engineer can set a sheet's
 *  columns, set a page aside, or have it read again. */
export function SourcePreview({
  projectId,
  sourceId,
  focus,
  editable = false,
}: {
  projectId: string;
  sourceId: string;
  focus?: Focus;
  editable?: boolean;
}) {
  const { t } = useSettings();
  const source = useSource(projectId, sourceId);
  const [number, setNumber] = useState(focus?.page ?? 1);

  if (source.isError) return <Alert onRetry={() => void source.refetch()}>{explain(source.error, t)}</Alert>;
  if (!source.data) return <Skeleton className="h-64 w-full rounded-lg" />;
  const { pages } = source.data;
  const page = pages.find((p) => p.number === number) ?? pages[0];
  if (!page) return null;
  const focused = focus?.page === page.number ? focus : undefined;

  return (
    <div className="flex flex-col gap-3">
      {page.kind === "sheet" ? (
        <SheetTabs pages={pages} current={page.number} onChoose={setNumber} />
      ) : (
        <Pager count={pages.length} current={page.number} onChoose={setNumber} />
      )}
      {editable && <PageControls key={`controls-${page.number}`} projectId={projectId} sourceId={sourceId} page={page} />}
      {page.kind === "sheet" ? (
        <SheetGrid key={page.number} projectId={projectId} sourceId={sourceId} page={page} mark={focused?.row} />
      ) : (
        <PageImage key={page.number} projectId={projectId} sourceId={sourceId} page={page} box={focused?.box} />
      )}
    </div>
  );
}

/** How a page was read, and the engineer's own say over it. */
function PageControls({ projectId, sourceId, page }: { projectId: string; sourceId: string; page: SourcePage }) {
  const { t } = useSettings();
  const layouts = useLayouts(projectId, sourceId);
  const redo = useRedo(projectId);
  const [mode, setMode] = useState<"columns" | "aside" | "again" | null>(null);
  const handled = page.handled;
  const state = !handled
    ? t("layout.notYet")
    : handled.set_aside
      ? t("layout.setAside", { reason: handled.set_aside })
      : t(handled.by === "engineer" ? "layout.byYou" : "layout.byAi", { count: handled.items });
  const failed = layouts.columns.error ?? layouts.setAside.error ?? redo.error;
  // Closing a form hands the keyboard back to the button that opened it.
  const openers = useRef<Record<string, HTMLButtonElement | null>>({});
  const close = () => {
    const opened = mode;
    setMode(null);
    requestAnimationFrame(() => opened && openers.current[opened]?.focus());
  };
  const opener = (name: "columns" | "aside" | "again", label: string) => (
    <button
      ref={(element) => {
        openers.current[name] = element;
      }}
      type="button"
      onClick={() => setMode(name)}
      className={button("secondary", "sm")}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:items-center">
        <span className="flex min-w-0 flex-1 items-center gap-2 text-ink-2 [unicode-bidi:plaintext]">
          <span
            className={`size-1.5 shrink-0 rounded-full ${!handled ? "bg-idle" : handled.by === "engineer" ? "bg-ink" : "bg-ink-2"}`}
            aria-hidden="true"
          />
          {state}
        </span>
        {mode === null && (
          <span className="flex flex-wrap gap-2">
            {page.kind === "sheet" && opener("columns", t("layout.columns"))}
            {opener("aside", t("layout.aside"))}
            {handled && opener("again", t("layout.readAgain"))}
          </span>
        )}
      </div>
      {mode === "columns" && (
        <ColumnsForm
          page={page}
          initial={handled?.sheet ?? undefined}
          busy={layouts.columns.isPending}
          onCancel={close}
          onSave={(layout) => layouts.columns.mutate({ number: page.number, layout }, { onSuccess: close })}
        />
      )}
      {mode === "aside" && (
        <AsideForm
          busy={layouts.setAside.isPending}
          onCancel={close}
          onSave={(reason) => layouts.setAside.mutate({ number: page.number, reason }, { onSuccess: close })}
        />
      )}
      {mode === "again" && (
        <NoteForm
          busy={redo.isPending}
          onCancel={close}
          onRun={(note) => redo.mutate({ step: "read", source_id: sourceId, page: page.number, note }, { onSuccess: close })}
        />
      )}
      {failed && <Alert>{explain(failed, t)}</Alert>}
    </div>
  );
}

const ROLES = ["code", "description", "unit", "quantity", "rate", "amount", "comment"] as const;
const REQUIRED = new Set(["description", "quantity"]);

/** A sheet's layout, as the engineer sets it: the rows that hold items and the column for each field. */
function ColumnsForm({
  page,
  initial,
  busy,
  onSave,
  onCancel,
}: {
  page: SourcePage;
  initial?: SheetLayout;
  busy: boolean;
  onSave: (layout: SheetLayout) => void;
  onCancel: () => void;
}) {
  const { t } = useSettings();
  const [rows, setRows] = useState({ first: String(initial?.first_row ?? 1), last: String(initial?.last_row ?? "") });
  const [columns, setColumns] = useState<Record<string, string>>(() => ({
    code: initial?.code ?? "",
    description: initial?.description[0] ?? "",
    unit: initial?.unit ?? "",
    quantity: initial?.quantity ?? "",
    rate: initial?.rate ?? "",
    amount: initial?.amount ?? "",
    comment: initial?.comment ?? "",
  }));
  const letters = Array.from({ length: Math.max(page.cols ?? 0, 1) }, (_, index) => columnName(index));
  const ready = Number(rows.first) >= 1 && columns.description && columns.quantity;
  const save = () => {
    // A description the AI read from several columns keeps the others while its first column stays.
    const more = initial && initial.description[0] === columns.description ? initial.description.slice(1) : [];
    onSave({
      first_row: Number(rows.first),
      last_row: rows.last ? Number(rows.last) : null,
      code: columns.code || null,
      description: [columns.description!, ...more],
      unit: columns.unit || null,
      quantity: columns.quantity!,
      rate: columns.rate || null,
      amount: columns.amount || null,
      comment: columns.comment || null,
    });
  };
  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-line bg-soft p-4 animate-enter"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) save();
      }}
    >
      <div className="flex flex-wrap gap-x-5 gap-y-3 text-sm">
        {(["first", "last"] as const).map((which) => (
          <label key={which} className="flex items-center gap-2">
            <span className="text-ink-2">{t(which === "first" ? "layout.firstRow" : "layout.lastRow")}</span>
            <input
              type="number"
              min={1}
              value={rows[which]}
              autoFocus={which === "first"}
              onChange={(event) => setRows({ ...rows, [which]: event.target.value })}
              className={`${fieldSmall} w-20`}
            />
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm sm:flex sm:flex-wrap">
        {ROLES.map((role) => (
          <label key={role} className="flex items-center justify-between gap-2 sm:justify-start">
            <span className="text-ink-2">{t(`layout.${role}` as Key)}</span>
            <select
              value={columns[role]}
              onChange={(event) => setColumns({ ...columns, [role]: event.target.value })}
              className={fieldSmall}
            >
              {!REQUIRED.has(role) && <option value="">{t("layout.none")}</option>}
              {REQUIRED.has(role) && !columns[role] && <option value="" />}
              {letters.map((letter) => (
                <option key={letter} value={letter}>
                  {letter}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !ready} className={button("primary", "sm")}>
          {t("layout.save")}
        </button>
        <button type="button" onClick={onCancel} className={button("quiet", "sm")}>
          {t("redo.cancel")}
        </button>
      </div>
    </form>
  );
}

function AsideForm({ busy, onSave, onCancel }: { busy: boolean; onSave: (reason: string) => void; onCancel: () => void }) {
  const { t } = useSettings();
  const [reason, setReason] = useState("");
  return (
    <form
      className="flex flex-wrap items-center gap-2 animate-enter"
      onSubmit={(event) => {
        event.preventDefault();
        if (reason.trim()) onSave(reason.trim());
      }}
    >
      <input
        aria-label={t("layout.asideReason")}
        placeholder={t("layout.asideReason")}
        value={reason}
        dir="auto"
        maxLength={300}
        autoFocus
        onChange={(event) => setReason(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
        className={`${field} min-w-0 flex-1 basis-56`}
      />
      <button type="submit" disabled={busy || !reason.trim()} className={button("primary", "sm")}>
        {t("layout.aside")}
      </button>
      <button type="button" onClick={onCancel} className={button("quiet", "sm")}>
        {t("redo.cancel")}
      </button>
    </form>
  );
}

function SheetTabs({
  pages,
  current,
  onChoose,
}: {
  pages: SourcePage[];
  current: number;
  onChoose: (number: number) => void;
}) {
  const { t } = useSettings();
  if (pages.length < 2) return null;
  return (
    <div role="group" aria-label={t("preview.sheets")} className="flex flex-wrap gap-1.5">
      {pages.map((page) => (
        <button
          key={page.number}
          type="button"
          aria-pressed={page.number === current}
          onClick={() => onChoose(page.number)}
          className="min-h-8 max-w-full rounded-md border border-line-strong px-2.5 py-1 text-start text-sm text-ink-2 transition-colors duration-150 [overflow-wrap:anywhere] [unicode-bidi:plaintext] hover:border-ink/35 hover:text-ink aria-pressed:border-ink aria-pressed:bg-subtle aria-pressed:text-ink pointer-coarse:min-h-10"
        >
          {page.hidden ? t("preview.hiddenSheet", { name: page.name }) : page.name}
        </button>
      ))}
    </div>
  );
}

function Pager({ count, current, onChoose }: { count: number; current: number; onChoose: (number: number) => void }) {
  const { t } = useSettings();
  if (count < 2) return null;
  return (
    <div className="flex items-center gap-2 text-sm text-ink-2">
      <button type="button" aria-label={t("preview.previous")} disabled={current <= 1} onClick={() => onChoose(current - 1)} className={iconButton("sm")}>
        <Icon name="back" />
      </button>
      <span>{t("preview.pageOf", { page: current, count })}</span>
      <button type="button" aria-label={t("preview.next")} disabled={current >= count} onClick={() => onChoose(current + 1)} className={iconButton("sm")}>
        <Icon name="next" />
      </button>
    </div>
  );
}

/** Excel's column name for a zero-based column index: 0 → A, 26 → AA. */
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function cellText(value: SheetView["rows"][number][number]): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value); // exactly as read: no rounding or grouping (float noise aside, see below)
}

function SheetGrid({
  projectId,
  sourceId,
  page,
  mark,
}: {
  projectId: string;
  sourceId: string;
  page: SourcePage;
  mark?: number;
}) {
  const { t } = useSettings();
  const sheet = useSheet(projectId, sourceId, page.number, mark ? Math.max(1, mark - 5) : 1);

  if (sheet.isError) return <Alert onRetry={() => void sheet.refetch()}>{explain(sheet.error, t)}</Alert>;
  if (!sheet.data) return <Skeleton className="h-64 w-full rounded-lg" />;
  const windows = sheet.data.pages;
  const rows = windows.flatMap((w) => w.rows);
  const first = windows[0]?.first_row ?? 1;
  const total = windows[0]?.total_rows ?? 0;
  const columns = rows.reduce((most, row) => Math.max(most, row.length), 0);
  if (!total) return <p className="text-sm text-ink-2">{t("preview.emptySheet")}</p>;

  return (
    <div className="flex flex-col gap-2">
      <div className="max-h-[60vh] overflow-auto rounded-lg border border-line" dir="ltr">
        <table aria-label={page.name} className="border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-20 bg-subtle" />
              {Array.from({ length: columns }, (_, c) => (
                <th key={c} scope="col" className="sticky top-0 z-10 border-b border-s border-line bg-subtle px-2 py-0.5 font-normal text-ink-2">
                  {columnName(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={first + r} aria-current={first + r === mark ? "true" : undefined} className="aria-[current]:bg-subtle aria-[current]:shadow-[inset_3px_0_0_var(--ink)]">
                <th scope="row" className="sticky left-0 z-10 border-e border-t border-line bg-subtle px-2 py-0.5 text-end font-normal text-ink-2 tabular-nums">
                  {first + r}
                </th>
                {Array.from({ length: columns }, (_, c) => {
                  // Excel's float noise shows to the cent, as Excel itself shows it; the exact value on hover.
                  const { shown, exact } = figure(cellText(row[c] ?? null));
                  return (
                    <td key={c} className="border-t border-s border-line-soft px-2 py-0.5 align-top">
                      <div dir="auto" title={exact} className="max-w-[22rem] whitespace-pre-wrap break-words">
                        {shown}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 text-sm text-ink-2">
        <span>{t("preview.rows", { first, last: first + rows.length - 1, count: total })}</span>
        {sheet.hasNextPage && (
          <button
            type="button"
            disabled={sheet.isFetchingNextPage}
            onClick={() => void sheet.fetchNextPage()}
            className={button("secondary", "sm")}
          >
            {t("preview.more")}
          </button>
        )}
      </div>
    </div>
  );
}

function PageImage({
  projectId,
  sourceId,
  page,
  box,
}: {
  projectId: string;
  sourceId: string;
  page: SourcePage;
  box?: number[];
}) {
  const { t } = useSettings();
  const image = usePageImage(projectId, sourceId, page.number);
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    if (!image.data) return;
    const made = URL.createObjectURL(image.data);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [image.data]);

  return (
    <div className="flex flex-col gap-2">
      {!page.has_text && <p className="text-sm text-ink-2">{t("preview.fromImage")}</p>}
      {image.isError ? (
        <Alert onRetry={() => void image.refetch()}>{explain(image.error, t)}</Alert>
      ) : url ? (
        <div className="relative">
          <img
            src={url}
            alt={t("preview.pageImage", { page: page.number })}
            className="w-full rounded-lg border border-line bg-white"
          />
          {box && page.width && page.height && (
            <div
              data-testid="item-box"
              aria-hidden="true"
              className="absolute rounded-sm outline-2 outline-offset-2 outline-ink"
              style={{
                left: `${(box[0]! / page.width) * 100}%`,
                top: `${(box[1]! / page.height) * 100}%`,
                width: `${((box[2]! - box[0]!) / page.width) * 100}%`,
                height: `${((box[3]! - box[1]!) / page.height) * 100}%`,
              }}
            />
          )}
        </div>
      ) : (
        <div
          className="w-full rounded-lg border border-line bg-soft"
          style={{ aspectRatio: page.width && page.height ? `${page.width} / ${page.height}` : "1 / 1.414" }}
        />
      )}
    </div>
  );
}
