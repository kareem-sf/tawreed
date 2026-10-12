import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { fakeService, renderApp } from "../testing";

const settings = { language: "en", theme: "system", ai: null };

test("an empty home shows one next action and opens connection settings", async () => {
  const calls = fakeService({});
  renderApp();
  await userEvent.setup().click(await screen.findByRole("button", { name: "Connect AI" }));
  expect(await screen.findByRole("heading", { name: "Add a connection" })).toBeInTheDocument();
  expect(screen.getByLabelText("API key")).toHaveValue("");
  expect(calls.some((call) => call.method === "POST")).toBe(false);
});

test("Arabic first run gives the same action with full RTL", async () => {
  fakeService({ "GET /settings": () => ({ ...settings, language: "ar" }) });
  renderApp();
  await userEvent.setup().click(await screen.findByRole("button", { name: "اربط الذكاء الاصطناعي" }));
  expect(document.documentElement).toHaveAttribute("dir", "rtl");
  expect(await screen.findByRole("heading", { name: "إضافة اتصال" })).toBeInTheDocument();
});

test("a selected AI leaves the normal BOQ start screen", async () => {
  fakeService({ "GET /settings": () => ({ ...settings, ai: { connection_id: "c1", model: "model" } }) });
  renderApp();
  await screen.findByText("Drop BOQ files here");
  await waitFor(() => expect(screen.queryByRole("button", { name: "Connect AI" })).not.toBeInTheDocument());
});

test("a delayed settings answer does not invent an AI setup requirement", async () => {
  let answer: ((value: unknown) => void) | undefined;
  fakeService({ "GET /settings": () => new Promise((resolve) => (answer = resolve)) });
  renderApp();
  await waitFor(() => expect(answer).toBeDefined());
  expect(screen.queryByRole("button", { name: "Connect AI" })).not.toBeInTheDocument();
  answer!({ ...settings, ai: { connection_id: "c1", model: "model" } });
  await screen.findByText("Drop BOQ files here");
  expect(screen.queryByRole("button", { name: "Connect AI" })).not.toBeInTheDocument();
});

test("unavailable settings show an actionable retry and recover", async () => {
  let available = false;
  fakeService({ "GET /settings": () => available ? settings : Promise.reject(new TypeError("Failed to fetch")) });
  renderApp();
  expect(await screen.findByRole("alert")).toHaveTextContent("The Tawreed service isn’t answering.");
  expect(screen.queryByRole("button", { name: "Connect AI" })).not.toBeInTheDocument();
  available = true;
  await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("button", { name: "Connect AI" })).toBeInTheDocument();
});

test("a failed project list is explained instead of pretending the home is empty", async () => {
  let available = false;
  fakeService({ "GET /projects": () => available ? [] : Promise.reject(new TypeError("Failed to fetch")) });
  renderApp();
  expect(await screen.findByRole("alert")).toHaveTextContent("The Tawreed service isn’t answering.");
  available = true;
  await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});
