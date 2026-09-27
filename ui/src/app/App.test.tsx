import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { fakeService, renderApp } from "../testing";

test("four tabs, one page each", async () => {
  fakeService({ "GET /about": () => ({ version: "0.1.0", data_folder: "C:\\Users\\me\\.tawreed" }) });
  renderApp();
  const user = userEvent.setup();

  // The mark kept from the previous app sits beside the name; the name alone is what screen readers hear.
  const logo = screen.getByTestId("logo");
  expect(logo).toHaveAttribute("aria-hidden", "true");
  expect(logo.querySelector("path")).toHaveAttribute("d", "M5.1 4.5H28L24.7 10.7H18.5V27.4L14.2 24.9V10.7H7.2L3.7 7.4L5.1 4.5Z");

  const tabs = screen.getByRole("navigation", { name: "Sections" });
  expect(tabs).toHaveTextContent("HomeHistorySettingsAbout");
  expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
  expect(await screen.findByText("Drop BOQ files here")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "History" }));
  expect(await screen.findByText("No projects yet. Drop a BOQ on Home to start.")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "About" }));
  expect(await screen.findByText("Version 0.1.0")).toBeInTheDocument();
  expect(screen.getByText("C:\\Users\\me\\.tawreed")).toBeInTheDocument();
});

test("switching to Arabic turns the whole page right to left and saves the choice", async () => {
  const calls = fakeService({ "PATCH /settings": () => ({ language: "ar", theme: "system", ai: null }) });
  renderApp();
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "العربية" }));

  expect(await screen.findByRole("button", { name: "الرئيسية" })).toBeInTheDocument();
  expect(document.documentElement).toHaveAttribute("dir", "rtl");
  expect(document.documentElement).toHaveAttribute("lang", "ar");
  expect(screen.getByText("أفلت ملفات جداول الكميات هنا")).toBeInTheDocument();
  await waitFor(() => expect(calls).toContainEqual({ method: "PATCH", path: "/settings", body: { language: "ar" } }));
});

test("the saved language is used from the start", async () => {
  fakeService({ "GET /settings": () => ({ language: "ar", theme: "dark", ai: null }) });
  renderApp();

  expect(await screen.findByRole("button", { name: "English" })).toBeInTheDocument();
  expect(document.documentElement).toHaveAttribute("dir", "rtl");
  expect(document.documentElement.dataset.theme).toBe("dark");
});
