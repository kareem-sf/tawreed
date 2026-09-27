import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { fakeService, project, renderApp, work } from "../testing";
import { columnName } from "./SourcePreview";

const recent = () => [{ id: "p1", name: "Al Noor Tower", updated_at: new Date().toISOString(), files: 2 }];

async function openProject() {
  renderApp();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Al Noor Tower/ }));
  await screen.findByDisplayValue("Al Noor Tower");
  return user;
}

const sheetPage = (number: number, name: string, hidden = false) => ({
  number,
  kind: "sheet",
  name,
  has_text: true,
  hidden,
  rows: 250,
  cols: 6,
  width: null,
  height: null,
});

test("files being read say so, and the project is asked again until they are read", async () => {
  let asked = 0;
  const [workbook, pdf] = project.sources;
  fakeService({
    "GET /projects": recent,
    "GET /projects/p1": () => {
      asked += 1;
      const reading = asked === 1;
      return {
        ...project,
        sources: [
          { ...workbook, status: reading ? "reading" : "read", page_count: reading ? 0 : 3 },
          { ...pdf, filename: "Locked.pdf", status: "failed", problem: "password_protected", page_count: 0 },
        ],
      };
    },
    "GET /projects/p1/work": () => work({ stage: asked > 1 ? "plan" : "read" }),
  });
  await openProject();

  expect(screen.getByText("Reading…")).toBeInTheDocument();
  expect(screen.getByText("Read").closest("li")).toHaveAttribute("aria-current", "step");
  expect(screen.getByText("Couldn’t read")).toBeInTheDocument();
  expect(screen.getByText(/protected by a password/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Locked.pdf" })).not.toBeInTheDocument(); // nothing to preview

  expect(await screen.findByText("3 sheets")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText("Plan").closest("li")).toHaveAttribute("aria-current", "step"));
  expect(screen.getByText("Read").closest("li")).toHaveAttribute("data-done");
  const settled = asked;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect(asked).toBe(settled); // nothing is being read, so the project is not asked again
});

test("a sheet shows its cells exactly as read, with Excel's rows and columns, more rows on request", async () => {
  const rows = (start: number, count: number) =>
    Array.from({ length: count }, (_, i) =>
      start + i === 10
        ? ["3.1.2", "Reinforced concrete to raft foundations", "m3", 1240.5, 1150.25, 1426885.13]
        : [`r${start + i}`],
    );
  const calls = fakeService({
    "GET /projects": recent,
    "GET /projects/p1": () => project,
    "GET /projects/p1/sources/s1": () => ({
      ...project.sources[0],
      pages: [sheetPage(1, "Div.03"), sheetPage(2, "الملخص"), sheetPage(3, "Rates", true)],
    }),
    "GET /projects/p1/sources/s1/pages/1": ({ query }) => {
      const start = Number(query?.start ?? 1);
      const count = Math.min(Number(query?.count ?? 200), 251 - start);
      return { kind: "sheet", name: "Div.03", first_row: start, rows: rows(start, count), total_rows: 250, merged: [] };
    },
    "GET /projects/p1/sources/s1/pages/3": () => ({
      kind: "sheet",
      name: "Rates",
      first_row: 1,
      rows: [["internal rates"]],
      total_rows: 1,
      merged: [],
    }),
  });
  const user = await openProject();

  await user.click(screen.getByRole("button", { name: "Architectural.xlsx" }));
  const grid = await screen.findByRole("table", { name: "Div.03" });
  const row10 = within(grid).getByRole("row", { name: /^10 / });
  expect(within(row10).getAllByRole("cell").map((c) => c.textContent)).toEqual([
    "3.1.2",
    "Reinforced concrete to raft foundations",
    "m3",
    "1240.5",
    "1150.25",
    "1426885.13",
  ]);
  expect(within(grid).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["", "A", "B", "C", "D", "E", "F"]);
  expect(screen.getByText("Rows 1–200 of 250")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Show more rows" }));
  expect(await screen.findByText("Rows 1–250 of 250")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Show more rows" })).not.toBeInTheDocument();
  expect(calls.filter((c) => c.path === "/projects/p1/sources/s1/pages/1").map((c) => c.query)).toEqual([
    { start: "1", count: "200" },
    { start: "201", count: "200" },
  ]);

  await user.click(screen.getByRole("button", { name: "Rates (hidden)" }));
  expect(await screen.findByRole("cell", { name: "internal rates" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Rates (hidden)" })).toHaveAttribute("aria-pressed", "true");

  await user.click(screen.getByRole("button", { name: "Architectural.xlsx" }));
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

test("a PDF shows its pages as pictures, and says when a page has to be read from the image", async () => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:page"), revokeObjectURL: vi.fn() }); // jsdom has neither
  const page = (number: number, has_text: boolean) => ({
    number,
    kind: "page",
    name: `${number}`,
    has_text,
    hidden: false,
    rows: null,
    cols: null,
    width: 595,
    height: 842,
  });
  const png = () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { headers: { "Content-Type": "image/png" } });
  const calls = fakeService({
    "GET /projects": recent,
    "GET /projects/p1": () => project,
    "GET /projects/p1/sources/s2": () => ({ ...project.sources[1], pages: [page(1, true), page(2, false)] }),
    "GET /projects/p1/sources/s2/pages/1/image": png,
    "GET /projects/p1/sources/s2/pages/2/image": png,
  });
  const user = await openProject();

  await user.click(screen.getByRole("button", { name: "MEP.pdf" }));
  expect(await screen.findByRole("img", { name: "Page 1" })).toHaveAttribute("src", "blob:page");
  expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  expect(screen.queryByText(/read from the image/)).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(await screen.findByRole("img", { name: "Page 2" })).toBeInTheDocument();
  expect(screen.getByText(/No text on this page/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalled()); // page 1's picture is let go
  expect(calls.filter((c) => c.path.endsWith("/image")).map((c) => c.path)).toEqual([
    "/projects/p1/sources/s2/pages/1/image",
    "/projects/p1/sources/s2/pages/2/image",
  ]);
});

test("column names follow Excel", () => {
  expect([0, 25, 26, 51, 52, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
});

test("a page picture dragged inside Tawreed is never added to the project as a file", async () => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:page"), revokeObjectURL: vi.fn() });
  const calls = fakeService({
    "GET /projects": recent,
    "GET /projects/p1": () => project,
    "GET /projects/p1/sources/s2": () => ({
      ...project.sources[1],
      pages: [{ number: 1, kind: "page", name: "1", has_text: true, hidden: false, rows: null, cols: null, width: 595, height: 842 }],
    }),
    "GET /projects/p1/sources/s2/pages/1/image": () => new Response(new Uint8Array([0x89, 0x50]), { headers: { "Content-Type": "image/png" } }),
    "POST /projects/p1/sources": () => project,
  });
  const user = await openProject();
  await user.click(screen.getByRole("button", { name: "MEP.pdf" }));
  const picture = await screen.findByRole("img", { name: "Page 1" });
  const dragged = { dataTransfer: { files: [new File(["png"], "0b1d-page.png")], types: ["text/uri-list", "Files"] } };

  fireEvent.dragStart(picture);
  fireEvent.dragEnter(screen.getByText("Architectural.xlsx"), dragged);
  fireEvent.drop(screen.getByText("Architectural.xlsx"), dragged);
  fireEvent.dragEnd(picture);
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);

  fireEvent.drop(screen.getByText("Architectural.xlsx"), {
    dataTransfer: { files: [new File(["%PDF"], "Civil.pdf")], types: ["Files"] },
  });
  await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1)); // a file from outside still is
});
