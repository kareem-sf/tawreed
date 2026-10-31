import { describe, expect, test } from "vitest";
import { translator } from "../i18n";
import { ApiError, explain, failure } from "./client";

test("a failure the service answers without a code of its own still says which, never a placeholder", () => {
  const t = translator("en");
  const said = explain(new ApiError("unknown", {}, 500), t);
  expect(said).toContain("500");
  expect(said).not.toContain("{status}");
  expect(explain(new ApiError("offline"), t)).not.toContain("{");
});

describe("what the service answers", () => {
  const answer = (detail: unknown, status: number) => new Response(JSON.stringify({ detail }), { status });

  test("a validation list from the framework becomes invalid_request with the field, never unknown", async () => {
    const error = await failure(answer([{ loc: ["body", "files"], msg: "Field required", type: "missing" }], 422));
    expect(error.code).toBe("invalid_request");
    expect(error.params).toEqual({ field: "files" });
    expect(explain(error, translator("en"))).toContain("files");
  });

  test("a plain sentence becomes bad_request", async () => {
    expect((await failure(answer("Bad things", 400))).code).toBe("bad_request");
  });

  test("a code keeps its details, as text", async () => {
    const error = await failure(answer({ code: "too_many_files", limit: 500 }, 413));
    expect(error.code).toBe("too_many_files");
    expect(error.params).toEqual({ limit: "500" });
    expect(explain(error, translator("en"))).toContain("500");
  });

  test("every code the service can answer with has words in both languages", () => {
    const codes = [
      "no_files", "invalid_request", "bad_request", "upload_incomplete", "publish_failed", "too_many_files",
      "drop_too_large", "decision_closed", "project_busy", "key_missing", "address_missing", "insecure_address",
    ];
    for (const code of codes) {
      for (const language of ["en", "ar"] as const) {
        const said = explain(new ApiError(code, { field: "x", limit: "5", limit_mb: "5" }), translator(language));
        expect(said, `${code} ${language}`).not.toMatch(/\{|Something went wrong/);
      }
    }
  });
});
