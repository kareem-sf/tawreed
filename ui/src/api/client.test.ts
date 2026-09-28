import { expect, test } from "vitest";
import { translator } from "../i18n";
import { ApiError, explain } from "./client";

test("a failure the service answers without a code of its own still says which, never a placeholder", () => {
  const t = translator("en");
  const said = explain(new ApiError("unknown", {}, 500), t);
  expect(said).toContain("500");
  expect(said).not.toContain("{status}");
  expect(explain(new ApiError("offline"), t)).not.toContain("{");
});
