import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { fakeService, renderApp } from "../testing";

test("four tabs, one page each", async () => {
  fakeService({ "GET /about": () => ({ version: "0.1.0", data_folder: "C:\\Users\\me\\.tawreed" }) });
  renderApp();
  const user = userEvent.setup();

  // The ت mark sits beside the name in the text colour; the name alone is what screen readers hear.
  const logo = screen.getByTestId("logo");
  expect(logo).toHaveAttribute("aria-hidden", "true");
  const [bowl, dots] = logo.querySelectorAll("path");
  expect(bowl).toHaveAttribute("d", expect.stringMatching(/^M681 129H665L604 271C/));
  expect(bowl).toHaveAttribute("fill", "currentColor");
  expect(dots).toHaveAttribute("d", expect.stringMatching(/^M505 111C/));
  expect(dots).toHaveAttribute("fill", "currentColor");

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
  expect(screen.getByText("Founded & developed by Kareem Safwat")).toBeInTheDocument();
  const site = screen.getByRole("link", { name: "kareemsafwat.com" });
  expect(site).toHaveAttribute("href", "https://kareemsafwat.com");
  expect(site).toHaveAttribute("target", "_blank");
  expect(site).toHaveAttribute("rel", "noreferrer");
  expect(screen.getByText("Tawreed is part of QS Mind.")).toBeInTheDocument();
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

test("the language and theme from last time are there from the first paint, before the service answers", async () => {
  localStorage.setItem("tawreed.look", JSON.stringify({ language: "ar", theme: "dark" }));
  let answer: ((value: unknown) => void) | undefined;
  fakeService({ "GET /settings": () => new Promise((resolve) => (answer = resolve)) });
  renderApp();

  // Still waiting for the service, and already in Arabic, right to left and dark.
  expect(screen.getByRole("button", { name: "English" })).toBeInTheDocument();
  expect(document.documentElement).toHaveAttribute("dir", "rtl");
  expect(document.documentElement.dataset.theme).toBe("dark");

  await waitFor(() => expect(answer).toBeDefined());
  answer!({ language: "en", theme: "light", ai: null }); // the service's record wins, and is remembered
  expect(await screen.findByRole("button", { name: "العربية" })).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("tawreed.look")!)).toEqual({ language: "en", theme: "light" });
});
