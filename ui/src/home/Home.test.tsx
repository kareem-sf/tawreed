import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { fakeService, json, project, renderApp, type Call } from "../testing";

const boq = () => new File(["PK synthetic workbook"], "Architectural.xlsx");

function sentFiles(call: Call | undefined): string[] {
  return call?.body instanceof FormData ? call.body.getAll("files").map((f) => (f as File).name) : [];
}

test("dropping files starts a project and opens it", async () => {
  const calls = fakeService({ "POST /projects": () => json(project, 201), "GET /projects/p1": () => project });
  renderApp();

  fireEvent.drop(await screen.findByRole("region", { name: "Add BOQ files" }), {
    dataTransfer: { files: [boq()], types: ["Files"] },
  });

  expect(await screen.findByDisplayValue("Al Noor Tower")).toBeInTheDocument();
  expect(screen.getByText("2 files")).toBeInTheDocument();
  expect(screen.getByText("Architectural.xlsx")).toBeInTheDocument();
  expect(screen.getByText("Spreadsheet")).toBeInTheDocument();
  expect(screen.getByText("1.4 MB")).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Progress" })).toHaveTextContent("ReadPlanPlaceCheckPublish");
  expect(screen.getByText("Connect an AI service in Settings so Tawreed can start.")).toBeInTheDocument();
  expect(sentFiles(calls.find((c) => c.method === "POST"))).toEqual(["Architectural.xlsx"]);
});

test("choosing files works the same as dropping them", async () => {
  const calls = fakeService({ "POST /projects": () => json(project, 201), "GET /projects/p1": () => project });
  renderApp();
  const user = userEvent.setup();

  await user.upload(await screen.findByTestId("file-input"), [boq(), new File(["%PDF"], "MEP.pdf")]);

  expect(await screen.findByDisplayValue("Al Noor Tower")).toBeInTheDocument();
  expect(sentFiles(calls.find((c) => c.method === "POST"))).toEqual(["Architectural.xlsx", "MEP.pdf"]);
});

test("a refused file is explained in plain words, and nothing opens", async () => {
  fakeService({ "POST /projects": () => json({ detail: { code: "unsupported_file", file: "notes.docx" } }, 422) });
  renderApp();

  fireEvent.drop(await screen.findByRole("region", { name: "Add BOQ files" }), {
    dataTransfer: { files: [new File(["word"], "notes.docx")], types: ["Files"] },
  });

  expect(await screen.findByRole("alert")).toHaveTextContent("Tawreed can’t read “notes.docx”.");
  expect(screen.getByText("Drop BOQ files here")).toBeInTheDocument();
});

test("when the service is not there, the engineer is told so", async () => {
  fakeService({ "POST /projects": () => Promise.reject(new TypeError("Failed to fetch")) });
  renderApp();

  fireEvent.drop(await screen.findByRole("region", { name: "Add BOQ files" }), {
    dataTransfer: { files: [boq()], types: ["Files"] },
  });

  expect(await screen.findByRole("alert")).toHaveTextContent("The Tawreed service isn’t answering.");
});

test("recent projects open from Home, and closing returns to the drop zone", async () => {
  fakeService({
    "GET /projects": () => [{ id: "p1", name: "Al Noor Tower", updated_at: new Date().toISOString(), files: 2 }],
    "GET /projects/p1": () => project,
  });
  renderApp();
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: /Al Noor Tower/ }));
  expect(await screen.findByDisplayValue("Al Noor Tower")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Close project" }));
  expect(await screen.findByText("Drop BOQ files here")).toBeInTheDocument();
});

test("renaming a project saves on Enter; Escape puts the name back", async () => {
  const calls = fakeService({
    "GET /projects": () => [{ id: "p1", name: "Al Noor Tower", updated_at: new Date().toISOString(), files: 2 }],
    "GET /projects/p1": () => project,
    "PATCH /projects/p1": ({ body }) => ({ ...project, name: (body as { name: string }).name }),
  });
  renderApp();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Al Noor Tower/ }));

  const name = await screen.findByRole("textbox", { name: "Project name" });
  await user.clear(name);
  await user.type(name, "  Riverside Clinic {Enter}");
  await waitFor(() =>
    expect(calls).toContainEqual({ method: "PATCH", path: "/projects/p1", body: { name: "Riverside Clinic" } }),
  );

  await user.type(name, " draft{Escape}");
  expect(name).toHaveValue("Riverside Clinic");
  expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
});

test("files dropped on an open project are added to it", async () => {
  const more = { ...project, sources: [...project.sources, { ...project.sources[1]!, id: "s3", filename: "Civil.pdf" }] };
  const calls = fakeService({
    "GET /projects": () => [{ id: "p1", name: "Al Noor Tower", updated_at: new Date().toISOString(), files: 2 }],
    "GET /projects/p1": () => project,
    "POST /projects/p1/sources": () => more,
  });
  renderApp();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Al Noor Tower/ }));
  await screen.findByDisplayValue("Al Noor Tower");

  fireEvent.drop(screen.getByText("Architectural.xlsx"), {
    dataTransfer: { files: [new File(["%PDF"], "Civil.pdf")], types: ["Files"] },
  });

  expect(await screen.findByText("Civil.pdf")).toBeInTheDocument();
  expect(screen.getByText("3 files")).toBeInTheDocument();
  expect(sentFiles(calls.find((c) => c.path === "/projects/p1/sources"))).toEqual(["Civil.pdf"]);
});
