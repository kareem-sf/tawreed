// @vitest-environment node
// Node's own FormData and Response, as a webview has them: the page's form is encoded the way a browser encodes it.
import { afterEach, expect, test, vi } from "vitest";

vi.stubGlobal("window", { location: { origin: "http://localhost" } }); // client.ts reads where it is served from
const { upload } = await import("./client");

afterEach(() => vi.restoreAllMocks());

  test("sends the form as one buffer with its boundary, so no webview streams it in pieces", async () => {
  const seen: { body?: unknown; headers?: Record<string, string> } = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      seen.body = init.body;
      seen.headers = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ id: "p1" }), { status: 200 });
    }),
  );
  await upload("/projects", [new File(["a,b\n1,2\n"], "boq.csv", { type: "text/csv" })]);
  expect(seen.body).toBeInstanceOf(ArrayBuffer);
  expect(seen.headers?.["Content-Type"]).toMatch(/^multipart\/form-data; boundary=/);
  const text = new TextDecoder().decode(seen.body as ArrayBuffer);
  expect(text).toContain('name="files"; filename="boq.csv"');
  expect(text).toContain("a,b\n1,2\n"); // the file's bytes are in the body, not only its header
});

test("a connection that fails is logged and reads as offline", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
  await expect(upload("/projects", [new File(["x"], "x.csv")])).rejects.toMatchObject({ code: "offline" });
  expect(log).toHaveBeenCalled();
  log.mockRestore();
});
