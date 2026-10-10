import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { fakeService, json, renderApp } from "../testing";

test("no newer version, or no desktop app to ask: nothing about updates is shown", async () => {
  const calls = fakeService({});
  renderApp();

  await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ method: "GET", path: "/desktop/update" })));
  expect(await screen.findByText("Drop BOQ files here")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Update and restart" })).not.toBeInTheDocument();
});

test("a newer version is offered, and installed only when the engineer says so", async () => {
  let finish = (_: Response) => {};
  const calls = fakeService({
    "GET /desktop/update": () => ({ version: "0.2.0" }),
    "POST /desktop/update": () => new Promise<Response>((resolve) => (finish = resolve)),
  });
  renderApp();
  const user = userEvent.setup();

  expect(await screen.findByText("Tawreed 0.2.0 is ready to install.")).toBeInTheDocument();
  expect(calls).not.toContainEqual(expect.objectContaining({ method: "POST" }));

  await user.click(screen.getByRole("button", { name: "Update and restart" }));
  expect(await screen.findByText("Updating… Tawreed will close and open again.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Update and restart" })).not.toBeInTheDocument();

  // The app closes when the installer starts; an answer means the update didn't happen.
  finish(json({ detail: { code: "offline" } }, 502));
  expect(await screen.findByRole("alert")).toHaveTextContent("The update couldn't be downloaded.");
  expect(screen.getByRole("button", { name: "Update and restart" })).toBeInTheDocument();
});
