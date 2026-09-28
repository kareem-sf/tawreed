import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { fakeService, project, renderApp, work, type Call } from "../testing";

const recent = () => [{ id: "p1", name: "Al Noor Tower", updated_at: new Date().toISOString(), files: 2 }];
const settings = () => ({ language: "en", theme: "system", ai: { connection_id: "c1", model: "m" } });

async function openProject(routes: Record<string, (call: Call) => unknown>) {
  const calls = fakeService({ "GET /settings": settings, "GET /projects": recent, "GET /projects/p1": () => project, ...routes });
  renderApp();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Al Noor Tower/ }));
  await screen.findByDisplayValue("Al Noor Tower");
  return { calls, user };
}

const decision = (kind: string, fields: Record<string, unknown>) => ({
  id: `d-${kind}`,
  kind,
  raised_by: "agent",
  created_at: "2026-09-27T09:00:00Z",
  ...fields,
});
const packages = [
  { id: "k1", code: "01", name: "Concrete works", scope: "", reason: "", items: 2, amount: "1465585.13", without_amount: 0 },
  { id: "k2", code: "02", name: "Formwork and joints", scope: "", reason: "", items: 1, amount: "0", without_amount: 1 },
];
const answered = (calls: Call[], id: string) => calls.filter((c) => c.path === `/projects/p1/decisions/${id}`).map((c) => c.body);
const ok = () => new Response(null, { status: 204 });

test("nothing goes to the AI service until the engineer allows it", async () => {
  const consent = decision("consent", { raised_by: "tawreed", provider: "openai_compatible", host: "api.runware.ai" });
  const { calls, user } = await openProject({
    "GET /projects/p1/work": () => work({ decisions: [consent] }),
    "POST /projects/p1/decisions/d-consent": ok,
  });

  const card = await screen.findByRole("region", { name: "Waiting for you" });
  expect(card).toHaveTextContent("Send this project to OpenAI-compatible service (api.runware.ai)?");
  expect(card).toHaveTextContent("Nothing is sent until you allow it.");
  await user.click(within(card).getByRole("button", { name: "Allow" }));
  await waitFor(() => expect(answered(calls, "d-consent")).toEqual([{ approve: true }]));
});

const proposal = () =>
  decision("plan", {
    note: "Three trades, as the market prices them.",
    packages: [
      { name: "Concrete works", scope: "Plain and reinforced concrete.", reason: "Ready-mix suppliers.", keeps: [] },
      { name: "Formwork and joints", scope: "", reason: "", keeps: [{ id: "k2", code: "02", name: "Formwork" }, { id: "k3", code: "03", name: "Joints" }] },
      { name: "Earthworks", scope: "Excavation.", reason: "", keeps: [] },
    ],
    removed: [{ id: "k4", code: "04", name: "Sundries" }],
  });

test("the plan is approved as proposed, proposed again with a note, or the current packages kept", async () => {
  const { calls, user } = await openProject({
    "GET /projects/p1/work": () => work({ stage: "plan", decisions: [proposal(), decision("uncertain", {})] }),
    "POST /projects/p1/decisions/d-plan": ok,
  });

  const card = await screen.findByRole("region", { name: "Waiting for you" });
  expect(within(card).getByRole("heading")).toHaveTextContent("A plan of 3 packages");
  expect(card).toHaveTextContent("and 1 more");
  expect(card).toHaveTextContent("Concrete worksNew"); // it changes current packages, so each says what it keeps
  expect(card).toHaveTextContent("Merges 02 Formwork and 03 Joints");
  expect(card).toHaveTextContent("Removes 04 Sundries. Their items will be placed again.");

  await user.click(within(card).getByRole("button", { name: "Propose again…" }));
  await user.type(within(card).getByRole("textbox", { name: "A note for the AI (optional)" }), "Keep joints separate");
  await user.click(within(card).getByRole("button", { name: "Run again" }));
  await user.click(within(card).getByRole("button", { name: "Keep the current packages" }));
  await user.click(within(card).getByRole("button", { name: "Approve plan" }));
  await waitFor(() =>
    expect(answered(calls, "d-plan")).toEqual([
      { approve: false, note: "Keep joints separate" },
      { approve: false },
      { approve: true },
    ]),
  );
});

test("the engineer edits the plan before approving it", async () => {
  const { calls, user } = await openProject({
    "GET /projects/p1/work": () => work({ stage: "plan", decisions: [proposal()] }),
    "POST /projects/p1/decisions/d-plan": ok,
  });

  const card = await screen.findByRole("region", { name: "Waiting for you" });
  await user.click(within(card).getByRole("button", { name: "Edit plan" }));
  const first = within(card).getByRole("textbox", { name: "Name of package 1" });
  await user.clear(first);
  await user.type(first, "Concrete");
  await user.selectOptions(within(card).getByRole("combobox", { name: "Merge package 3 into…" }), "0");
  await user.click(within(card).getByRole("button", { name: "Add a package" }));
  expect(within(card).getByRole("button", { name: "Approve plan" })).toBeDisabled(); // the new one needs a name
  await user.type(within(card).getByRole("textbox", { name: "Name of package 3" }), "Waterproofing");
  await user.click(within(card).getByRole("button", { name: "Remove package 2" }));
  await user.click(within(card).getByRole("button", { name: "Approve plan" }));

  await waitFor(() =>
    expect(answered(calls, "d-plan")).toEqual([
      {
        approve: true,
        packages: [
          { name: "Concrete", scope: "Plain and reinforced concrete. Excavation.", reason: "Ready-mix suppliers.", keeps: [] },
          { name: "Waterproofing", scope: "", reason: "", keeps: [] },
        ],
      },
    ]),
  );
});

test("an uncertain item shows where it is in its file, and the choice can become a rule", async () => {
  const item = {
    id: "i4",
    ref: 4,
    code: "3.1.4",
    description: "Waterstops to construction joints",
    unit: "L.M.",
    quantity_text: "",
    rate_text: "",
    amount_text: "",
    comment: "",
    headings: [],
    source_id: "s1",
    file: "Architectural.xlsx",
    page: 1,
    provenance: { sheet: "Div.03", row: 12, cells: {} },
    origin: "cell",
    verify: false,
    package_id: null,
    decided_by: null,
  };
  const uncertain = decision("uncertain", {
    item,
    candidates: [
      { id: "k1", code: "01", name: "Concrete works" },
      { id: "k2", code: "02", name: "Formwork and joints" },
    ],
    recommended: "k2",
    reason: "Cast in, but bought with joints.",
  });
  const { calls, user } = await openProject({
    "GET /projects/p1/work": () => work({ stage: "place", decisions: [uncertain], packages }),
    "POST /projects/p1/decisions/d-uncertain": ok,
    "GET /projects/p1/sources/s1": () => ({
      ...project.sources[0],
      pages: [{ number: 1, kind: "sheet", name: "Div.03", has_text: true, hidden: false, rows: 20, cols: 6, width: null, height: null }],
    }),
    "GET /projects/p1/sources/s1/pages/1": ({ query }) => ({
      kind: "sheet",
      name: "Div.03",
      first_row: Number(query?.start),
      rows: Array.from({ length: 21 - Number(query?.start) }, (_, i) =>
        Number(query?.start) + i === 12 ? ["3.1.4", "Waterstops to construction joints", "L.M."] : [`r${Number(query?.start) + i}`],
      ),
      total_rows: 20,
      merged: [],
    }),
  });

  const card = await screen.findByRole("region", { name: "Waiting for you" });
  expect(card).toHaveTextContent("Which package does this item belong in?");
  expect(within(card).getByRole("radio", { name: "This project" })).toBeChecked();
  expect(within(card).getByRole("button", { name: /Formwork and joints/ })).toHaveTextContent("Suggested");

  await user.click(within(card).getByRole("button", { name: "Architectural.xlsx, Div.03 row 12" }));
  const marked = await within(card).findByRole("row", { current: true });
  expect(marked).toHaveTextContent("12"); // the item's own row, opened near it and marked
  expect(calls.find((c) => c.path === "/projects/p1/sources/s1/pages/1")?.query).toEqual({ start: "7", count: "200" });

  await user.click(within(card).getByRole("radio", { name: "All projects" }));
  await user.click(within(card).getByRole("button", { name: /Formwork and joints/ }));
  await waitFor(() => expect(answered(calls, "d-uncertain")).toEqual([{ package_id: "k2", scope: "all" }]));
});

test("the status line says what runs, with Stop, or why it paused, with Continue; there is no chat", async () => {
  let run: Record<string, unknown> = { state: "running", step: "place", done: 150, total: 320 };
  const { calls, user } = await openProject({
    "GET /projects/p1/work": () => work({ stage: "place", run, packages }),
    "POST /projects/p1/stop": () => {
      run = { state: "paused", problem: { code: "ai_failed", problem: "rate_limited" } };
      return ok();
    },
    "POST /projects/p1/continue": ok,
  });

  expect(await screen.findByRole("status")).toHaveTextContent("Placing items: 150 of 320 placed");
  expect(screen.getByRole("list", { name: "Progress" }).querySelector("[aria-current]")).toHaveTextContent("Place");
  expect(screen.queryByRole("textbox")).not.toHaveAttribute("aria-label", "Write to Tawreed");

  await user.click(screen.getByRole("button", { name: "Stop" }));
  expect(await screen.findByText(/^Paused\. The service is limiting requests/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(calls.map((c) => c.path)).toEqual(expect.arrayContaining(["/projects/p1/stop", "/projects/p1/continue"])));
});

test("a file's page says how it was read, and the engineer sets its columns or has it read again", async () => {
  const { calls, user } = await openProject({
    "GET /projects/p1/work": () => work({ stage: "place", packages }),
    "GET /projects/p1/sources/s1": () => ({
      ...project.sources[0],
      pages: [
        {
          number: 1,
          kind: "sheet",
          name: "Div.03",
          has_text: true,
          hidden: false,
          rows: 20,
          cols: 6,
          width: null,
          height: null,
          handled: {
            by: "agent",
            set_aside: null,
            items: 5,
            sheet: { first_row: 4, last_row: null, code: "A", description: ["B"], unit: "C", quantity: "D", rate: "E", amount: "F", comment: null },
          },
        },
        {
          number: 2,
          kind: "sheet",
          name: "Rates",
          has_text: true,
          hidden: false,
          rows: 5,
          cols: 2,
          width: null,
          height: null,
          handled: { by: "agent", set_aside: "Internal rates", items: 0, sheet: null },
        },
      ],
    }),
    "GET /projects/p1/sources/s1/pages/2": () => ({ kind: "sheet", name: "Rates", first_row: 1, rows: [["y"]], total_rows: 1, merged: [] }),
    "GET /projects/p1/sources/s1/pages/1": () => ({ kind: "sheet", name: "Div.03", first_row: 1, rows: [["x"]], total_rows: 1, merged: [] }),
    "PUT /projects/p1/sources/s1/pages/1/layout": ok,
    "POST /projects/p1/redo": ok,
  });

  await user.click(await screen.findByRole("tab", { name: /Files/ })); // packages show first when there are some
  await user.click(await screen.findByRole("button", { name: "Architectural.xlsx" }));
  expect(await screen.findByText("Read by Tawreed (AI): 5 items")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Rates" })); // each sheet says how it was read, and only it
  expect(await screen.findByText("Set aside: Internal rates")).toBeInTheDocument();
  expect(screen.queryByText("Read by Tawreed (AI): 5 items")).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Columns…" })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Div.03" }));
  await user.click(await screen.findByRole("button", { name: "Columns…" }));
  await user.clear(screen.getByRole("spinbutton", { name: "First row" }));
  await user.type(screen.getByRole("spinbutton", { name: "First row" }), "6");
  await user.selectOptions(screen.getByRole("combobox", { name: "Rate" }), "");
  await user.click(screen.getByRole("button", { name: "Read it this way" }));
  await waitFor(() =>
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
      first_row: 6,
      last_row: null,
      code: "A",
      description: ["B"],
      unit: "C",
      quantity: "D",
      rate: null,
      amount: "F",
      comment: null,
    }),
  );

  await user.click(await screen.findByRole("button", { name: "Read again…" }));
  await user.type(screen.getByRole("textbox", { name: "A note for the AI (optional)" }), "The items start on row 6.");
  await user.click(screen.getByRole("button", { name: "Run again" }));
  await waitFor(() =>
    expect(calls.find((c) => c.path === "/projects/p1/redo")?.body).toEqual({
      step: "read",
      source_id: "s1",
      page: 1,
      note: "The items start on row 6.",
    }),
  );
});

test("the engineer moves, renames, merges and removes packages directly", async () => {
  const concrete = [
    {
      id: "i1",
      ref: 1,
      code: "3.1.1",
      description: "Plain concrete grade C15 blinding",
      unit: "m3",
      quantity_text: "86",
      rate_text: "450",
      amount_text: "38700",
      comment: "",
      headings: [],
      source_id: "s1",
      file: "Architectural.xlsx",
      page: 1,
      provenance: { sheet: "Div.03", row: 9 },
      origin: "cell",
      verify: false,
      package_id: "k1",
      decided_by: "agent",
    },
  ];
  const { calls, user } = await openProject({
    "GET /projects/p1/work": () =>
      work({
        stage: "check",
        packages,
        coverage: { items: 3, placed: 3, unplaced: 0, waiting: 0, pages_left: 0, pending_files: 0, amount: "1465585.13", totals_differ: 0 },
      }),
    "GET /projects/p1/items": () => ({ items: concrete, total: 1 }),
    "POST /projects/p1/placements": ok,
    "PATCH /projects/p1/packages/k1": () => ({ id: "k1", code: "01", name: "Concrete" }),
    "POST /projects/p1/packages/k1/merge": ok,
    "DELETE /projects/p1/packages/k2": ok,
    "POST /projects/p1/redo": ok,
  });

  const summary = await screen.findByRole("region", { name: "Packages" });
  expect(summary).toHaveTextContent("3 of 3 items placed");

  // Packages | Files is a tab list: the arrow keys move between the two, and the one shown takes the focus.
  const packagesTab = screen.getByRole("tab", { name: /Packages/ });
  expect(packagesTab).toHaveAttribute("aria-selected", "true");
  packagesTab.focus();
  await user.keyboard("{ArrowRight}");
  const filesTab = screen.getByRole("tab", { name: /Files/ });
  expect(filesTab).toHaveAttribute("aria-selected", "true");
  expect(filesTab).toHaveFocus();
  expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", filesTab.id);
  await user.keyboard("{ArrowLeft}");
  expect(packagesTab).toHaveFocus();
  await user.click(within(await screen.findByRole("region", { name: "Packages" })).getByRole("button", { name: "View and edit" }));

  await user.click(await screen.findByRole("button", { name: /Concrete works/ }));
  const row = await screen.findByRole("row", { name: /3\.1\.1/ });
  expect(within(row).getAllByRole("cell").map((c) => c.textContent).slice(1, 7)).toEqual([
    "3.1.1",
    "Plain concrete grade C15 blinding",
    "m3",
    "86",
    "450",
    "38700",
  ]);
  await user.click(within(row).getByRole("checkbox", { name: "Select 3.1.1" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Move to…" }), "k2");
  await user.click(screen.getByRole("button", { name: "Move" }));
  await waitFor(() =>
    expect(calls).toContainEqual({ method: "POST", path: "/projects/p1/placements", body: { item_ids: ["i1"], package_id: "k2" } }),
  );

  await user.click(screen.getByRole("button", { name: "Rename" }));
  const name = screen.getByRole("textbox", { name: "Rename" });
  await user.clear(name);
  await user.type(name, "Concrete{Enter}");
  await waitFor(() => expect(calls).toContainEqual({ method: "PATCH", path: "/projects/p1/packages/k1", body: { name: "Concrete" } }));

  await user.click(screen.getByRole("button", { name: /Formwork and joints/ }));
  const merges = screen.getAllByRole("combobox", { name: "Merge into…" });
  await user.selectOptions(merges[1]!, "k1");
  await user.click(screen.getAllByRole("button", { name: "Merge" })[1]!);
  await waitFor(() =>
    expect(calls).toContainEqual({ method: "POST", path: "/projects/p1/packages/k1/merge", body: { package_ids: ["k2"] } }),
  );
  await user.click(screen.getAllByRole("button", { name: "Remove" })[1]!);
  await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/projects/p1/packages/k2")).toBe(true));

  await user.click(screen.getAllByRole("button", { name: "Place again…" })[0]!);
  await user.type(screen.getByRole("textbox", { name: "A note for the AI (optional)" }), "Blinding goes with concrete.");
  await user.click(screen.getByRole("button", { name: "Run again" }));
  await waitFor(() =>
    expect(calls).toContainEqual({
      method: "POST",
      path: "/projects/p1/redo",
      body: { step: "place", package_id: "k1", note: "Blinding goes with concrete." },
    }),
  );

  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByRole("region", { name: "Packages" })).toHaveTextContent("View and edit");
});

test("a published revision shows what was written, and opens or exports its folder", async () => {
  Object.assign(URL, { createObjectURL: () => "blob:zip", revokeObjectURL: () => {} }); // jsdom has neither
  const revision = {
    number: 0,
    name: "Rev 00",
    created_at: new Date().toISOString(),
    items: 5,
    packages: 3,
    prices: false,
    files: [
      { path: "Al Noor Tower - Master - Rev 00.xlsx", bytes: 20_480 },
      { path: "Packages/01 Concrete works - Rev 00.xlsx", bytes: 9_216 },
      { path: "manifest.json", bytes: 900 },
    ],
  };
  const publishAsked = decision("publish", { raised_by: "tawreed" });
  const coverage = { items: 3, placed: 3, unplaced: 0, waiting: 0, pages_left: 0, pending_files: 0, amount: "1465585.13", totals_differ: 1 };
  let published = false;
  const { calls, user } = await openProject({
    "GET /projects/p1/work": () =>
      published
        ? work({ stage: "published", published: revision, packages })
        : work({ stage: "publish", decisions: [publishAsked], packages, coverage }),
    "POST /projects/p1/decisions/d-publish": () => {
      published = true;
      return ok();
    },
    "GET /projects/p1/revisions": () => [revision],
    "POST /projects/p1/revisions/0/open": ok,
    "POST /projects/p1/publish": ok,
    "GET /projects/p1/revisions/0/export": () => new Response(new Uint8Array([80, 75]), { headers: { "Content-Type": "application/zip" } }),
  });

  const card = await screen.findByRole("region", { name: "Waiting for you" });
  expect(card).toHaveTextContent("Ready to publish");
  expect(card).toHaveTextContent("Packages: 2 · Items: 3 · Amounts: 1,465,585.13"); // computed by Tawreed
  expect(card).toHaveTextContent("1 sheet or page states totals that differ from its items. Check it before publishing.");
  const prices = within(card).getByRole("checkbox", { name: /Show rates and amounts in the package workbooks/ });
  expect(prices).toBeChecked();
  await user.click(prices);
  await user.click(within(card).getByRole("button", { name: "Publish" }));
  await waitFor(() =>
    expect(calls.find((c) => c.path === "/projects/p1/decisions/d-publish")?.body).toEqual({ approve: true, prices: false }),
  );

  const done = await screen.findByRole("region", { name: "Published revision" });
  expect(done).toHaveTextContent("Rev 00 is published");
  expect(done).toHaveTextContent("Packages: 3 · Items: 5");
  expect(done).toHaveTextContent("for suppliers to price");
  expect(screen.queryByRole("region", { name: "Done so far" })).not.toBeInTheDocument(); // no list of decisions

  // Revisions float in a corner: a button with how many there are, opening a panel with each one's files.
  expect(screen.queryByRole("dialog", { name: "Revisions" })).not.toBeInTheDocument();
  const opener = screen.getByRole("button", { name: "1 revision" });
  await user.click(opener);
  const panel = screen.getByRole("dialog", { name: "Revisions" });
  expect(panel).toHaveFocus(); // the keyboard carries on in the panel
  expect(opener).toHaveAttribute("aria-controls", panel.id);
  await user.click(within(panel).getByRole("button", { name: "Rev 00" }));
  expect(within(panel).getAllByRole("listitem").slice(1).map((li) => li.textContent)).toEqual([
    "Al Noor Tower - Master - Rev 00.xlsx20 kB",
    "01 Concrete works - Rev 00.xlsx9 kB",
  ]);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Revisions" })).not.toBeInTheDocument();
  expect(opener).toHaveFocus(); // and comes back to the button when it closes
  const steps = screen.getByRole("list", { name: "Progress" });
  expect(steps.querySelectorAll("[data-done]")).toHaveLength(5);

  await user.click(within(done).getByRole("button", { name: "Open folder" }));
  await user.click(within(done).getByRole("button", { name: "Export…" }));
  await waitFor(() =>
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(
      expect.arrayContaining(["POST /projects/p1/revisions/0/open", "GET /projects/p1/revisions/0/export"]),
    ),
  );
  await user.click(within(done).getByRole("button", { name: "Publish again…" }));
  await waitFor(() => expect(calls.some((c) => c.path === "/projects/p1/publish")).toBe(true));
});

test("in a narrow window each item is a card, with every field shown", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width"), addEventListener() {}, removeEventListener() {} }));
  const item = {
    id: "i1",
    ref: 1,
    code: "3.1.1",
    description: "Plain concrete grade C15 blinding",
    unit: "m3",
    quantity_text: "86",
    rate_text: "450",
    amount_text: "38700",
    comment: "",
    headings: [],
    source_id: "s1",
    file: "Architectural.xlsx",
    page: 1,
    provenance: { sheet: "Div.03", row: 9 },
    origin: "cell",
    verify: false,
    package_id: "k1",
    decided_by: "agent",
  };
  const { user } = await openProject({
    "GET /projects/p1/work": () => work({ stage: "check", packages }),
    "GET /projects/p1/items": () => ({ items: [item], total: 1 }),
  });

  await user.click(within(await screen.findByRole("region", { name: "Packages" })).getByRole("button", { name: "View and edit" }));
  await user.click(await screen.findByRole("button", { name: /Concrete works/ }));
  expect(await screen.findByText("Plain concrete grade C15 blinding")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  const card = screen.getByRole("checkbox", { name: "Select 3.1.1" }).closest("li")!;
  const fields = [...card.querySelectorAll("dt")].map((dt) => `${dt.textContent} ${dt.nextElementSibling?.textContent}`);
  expect(fields).toEqual(["Unit m3", "Qty 86", "Rate 450", "Amount 38700"]);
  expect(within(card).getByRole("button", { name: "Architectural.xlsx, Div.03 row 9" })).toBeInTheDocument();
});
