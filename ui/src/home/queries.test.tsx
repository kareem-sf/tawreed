import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, test } from "vitest";
import { fakeService } from "../testing";
import { useSheet } from "./queries";

test("a sheet opened part-way down can bring the rows above it back, up to row 1", async () => {
  const calls = fakeService({
    "GET /projects/p1/sources/s1/pages/1": ({ query }) => {
      const start = Number(query?.start);
      const count = Number(query?.count);
      return { kind: "sheet", name: "Div.03", first_row: start, rows: Array.from({ length: count }, (_, i) => [`r${start + i}`]), total_rows: 500, merged: [] };
    },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useSheet("p1", "s1", 1, 300), { wrapper });

  await waitFor(() => expect(result.current.data?.pages[0]?.first_row).toBe(300));
  expect(result.current.hasPreviousPage).toBe(true);
  await act(() => result.current.fetchPreviousPage());
  await waitFor(() => expect(result.current.data?.pages.map((page) => page.first_row)).toEqual([100, 300]));
  await act(() => result.current.fetchPreviousPage());
  await waitFor(() => expect(result.current.data?.pages.map((page) => page.first_row)).toEqual([1, 100, 300]));
  expect(result.current.hasPreviousPage).toBe(false);
  expect(calls.map((c) => c.query)).toEqual([
    { start: "300", count: "200" },
    { start: "100", count: "200" },
    { start: "1", count: "99" },
  ]);
});
