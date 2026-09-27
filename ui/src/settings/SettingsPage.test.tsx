import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { fakeService, renderApp } from "../testing";

test("choosing a theme applies it at once and saves it", async () => {
  const calls = fakeService({ "PATCH /settings": () => ({ language: "en", theme: "dark", ai: null }) });
  renderApp();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Settings" }));

  const theme = screen.getByRole("group", { name: "Theme" });
  expect(screen.getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "true");

  await user.click(screen.getByRole("button", { name: "Dark" }));

  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(theme.querySelector('[aria-pressed="true"]')).toHaveTextContent("Dark");
  await waitFor(() => expect(calls).toContainEqual({ method: "PATCH", path: "/settings", body: { theme: "dark" } }));
});

test("a choice the service refuses is undone", async () => {
  fakeService({ "PATCH /settings": () => new Response("{}", { status: 500 }) });
  renderApp();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Settings" }));

  await user.click(screen.getByRole("button", { name: "Light" }));

  await waitFor(() => expect(screen.getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "true"));
  expect(document.documentElement.dataset.theme).toBe("system");
});
