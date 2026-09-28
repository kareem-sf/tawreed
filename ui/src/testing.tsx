// Test helpers: a stand-in for the local service, and the app wrapped as main.tsx wraps it.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { App } from "./app/App";
import { SettingsProvider } from "./app/settings";

export type Call = { method: string; path: string; body: unknown; query?: Record<string, string> };
type Handler = (call: Call) => unknown;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Answer the interface's requests from `routes` ("GET /projects": handler). Returns the calls made. */
export function fakeService(routes: Record<string, Handler>): Call[] {
  const calls: Call[] = [];
  const all: Record<string, Handler> = {
    "GET /settings": () => ({ language: "en", theme: "system", ai: null }),
    "GET /projects": () => [],
    "GET /ai/connections": () => [],
    "GET /rules": () => [],
    ...routes,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      let call: Call;
      if (input instanceof Request) {
        const text = await input.clone().text();
        call = { method: input.method, path: new URL(input.url).pathname, body: text ? JSON.parse(text) : undefined };
      } else {
        call = { method: init?.method ?? "GET", path: new URL(String(input)).pathname, body: init?.body };
      }
      const search = new URL(input instanceof Request ? input.url : String(input)).searchParams;
      if (search.size) call.query = Object.fromEntries(search);
      call.path = call.path.replace(/^\/api/, "");
      calls.push(call);
      const handler = all[`${call.method} ${call.path}`] ?? (/^\/projects\/\w+\/work$/.test(call.path) ? () => work() : undefined);
      if (!handler) return json({ detail: { code: "not_in_test" } }, 404);
      const result = await handler(call);
      return result instanceof Response ? result : json(result);
    }),
  );
  return calls;
}

/** An open project's work: nothing running or waiting, no packages yet. Tests override what they need. */
export function work(changes: Record<string, unknown> = {}) {
  return {
    stage: "read",
    run: { state: "idle" },
    decisions: [],
    answered: [],
    coverage: { items: 0, placed: 0, unplaced: 0, waiting: 0, pages_left: 0, pending_files: 0, amount: "0", totals_differ: 0 },
    packages: [],
    ...changes,
  };
}

export function renderApp() {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queries}>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </QueryClientProvider>,
  );
}

export const project = {
  id: "p1",
  name: "Al Noor Tower",
  created_at: "2026-09-27T08:00:00Z",
  updated_at: "2026-09-27T08:00:00Z",
  sources: [
    {
      id: "s1",
      filename: "Architectural.xlsx",
      size: 1_468_006,
      kind: "spreadsheet",
      added_at: "2026-09-27T08:00:00Z",
      status: "read",
      problem: null,
      page_count: 3,
    },
    {
      id: "s2",
      filename: "MEP.pdf",
      size: 52_000,
      kind: "pdf",
      added_at: "2026-09-27T08:00:00Z",
      status: "read",
      problem: null,
      page_count: 2,
    },
  ],
};
