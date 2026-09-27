import { useEffect, useState } from "react";
import { explain, type SheetView, type SourcePage } from "../api/client";
import { useSettings } from "../app/settings";
import { usePageImage, useSheet, useSource } from "./queries";

/** Where an item is: its page, and its row on a sheet or its box (points from the top left) on a PDF page. */
export type Focus = { page: number; row?: number; box?: number[] };

/** A read file as Tawreed has it: each sheet as a grid of cells, each page or image as a picture. With a focus,
 *  it opens at that item and marks it. */
export function SourcePreview({ projectId, sourceId, focus }: { projectId: string; sourceId: string; focus?: Focus }) {
  const { t } = useSettings();
  const source = useSource(projectId, sourceId);
  const [number, setNumber] = useState(focus?.page ?? 1);

  if (source.isError) {
    return (
      <p role="alert" className="text-danger">
        {explain(source.error, t)}
      </p>
    );
  }
  if (!source.data) return null;
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
      {page.kind === "sheet" ? (
        <SheetGrid key={page.number} projectId={projectId} sourceId={sourceId} page={page} mark={focused?.row} />
      ) : (
        <PageImage key={page.number} projectId={projectId} sourceId={sourceId} page={page} box={focused?.box} />
      )}
    </div>
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
          className="rounded-md border border-line px-2.5 py-0.5 text-sm text-ink-2 [unicode-bidi:plaintext] aria-pressed:border-ink aria-pressed:text-ink"
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
  const arrow = (d: string) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="rtl:-scale-x-100">
      <path d={d} />
    </svg>
  );
  const button = "rounded-md border border-line p-1 text-ink-2 hover:text-ink disabled:opacity-40";
  return (
    <div className="flex items-center gap-2 text-sm text-ink-2">
      <button type="button" aria-label={t("preview.previous")} disabled={current <= 1} onClick={() => onChoose(current - 1)} className={button}>
        {arrow("M15 6l-6 6 6 6")}
      </button>
      <span>{t("preview.pageOf", { page: current, count })}</span>
      <button type="button" aria-label={t("preview.next")} disabled={current >= count} onClick={() => onChoose(current + 1)} className={button}>
        {arrow("M9 6l6 6-6 6")}
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
  return String(value); // exactly as read: no rounding or grouping
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

  if (sheet.isError) {
    return (
      <p role="alert" className="text-danger">
        {explain(sheet.error, t)}
      </p>
    );
  }
  if (!sheet.data) return null;
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
              <tr key={first + r} aria-current={first + r === mark ? "true" : undefined} className="aria-[current]:bg-amber-soft">
                <th scope="row" className="sticky left-0 z-10 border-e border-t border-line bg-subtle px-2 py-0.5 text-end font-normal text-ink-2 tabular-nums">
                  {first + r}
                </th>
                {Array.from({ length: columns }, (_, c) => {
                  const text = cellText(row[c] ?? null);
                  return (
                    <td key={c} className="border-t border-s border-line-soft px-2 py-0.5 align-top">
                      <div dir="auto" title={text || undefined} className="max-w-[22rem] truncate">
                        {text}
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
            className="rounded-md border border-line px-2.5 py-0.5 text-ink hover:border-ink disabled:opacity-50"
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
        <p role="alert" className="text-danger">
          {explain(image.error, t)}
        </p>
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
              className="absolute rounded-sm outline-2 outline-offset-2 outline-amber"
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
