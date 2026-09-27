import { expect, test } from "vitest";
import { ago, size } from "../app/format";
import { ar } from "./ar";
import { en, type Key } from "./en";
import { direction, translator } from "./index";

test("every string exists in both languages and none is empty", () => {
  expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  for (const dictionary of [en, ar]) {
    for (const entry of Object.values(dictionary)) {
      const forms: string[] = typeof entry === "string" ? [entry] : Object.values(entry as Record<string, string>);
      for (const form of forms) expect(form.trim()).not.toBe("");
    }
  }
});

test("placeholders are the same in both languages", () => {
  const holes = (entry: unknown) => [...new Set(JSON.stringify(entry).match(/\{\w+\}/g) ?? [])].sort();
  for (const key of Object.keys(en) as Key[]) {
    expect(holes(ar[key]), key).toEqual(holes(en[key]));
  }
});

test("Arabic plurals use every form, with Latin digits", () => {
  const t = translator("ar");
  expect([0, 1, 2, 3, 11, 100, 1284].map((count) => t("project.files", { count }))).toEqual([
    "لا ملفات",
    "ملف واحد",
    "ملفان",
    "3 ملفات",
    "11 ملفاً",
    "100 ملف",
    "1,284 ملفاً",
  ]);
});

test("English plurals and placeholders", () => {
  const t = translator("en");
  expect(t("project.files", { count: 1 })).toBe("1 file");
  expect(t("project.files", { count: 1284 })).toBe("1,284 files");
  expect(t("error.empty_file", { file: "A.xlsx" })).toBe("“A.xlsx” is empty.");
});

test("a key the interface doesn't know comes back as itself", () => {
  expect(translator("en")("error.brand_new" as Key)).toBe("error.brand_new");
});

test("direction follows the language", () => {
  expect(direction("ar")).toBe("rtl");
  expect(direction("en")).toBe("ltr");
});

test("relative times and sizes read naturally in both languages", () => {
  const now = Date.parse("2026-09-27T10:00:00Z");
  expect(ago("2026-09-25T10:00:00Z", "en", now)).toBe("2 days ago");
  expect(ago("2026-09-27T09:59:40Z", "en", now)).toBe("this minute");
  expect(ago("2026-09-25T10:00:00Z", "ar-u-nu-latn", now)).toBe("أول أمس");
  expect(ago("2026-09-17T10:00:00Z", "ar-u-nu-latn", now)).toBe("الأسبوع الماضي");
  expect(ago("2026-06-27T10:00:00Z", "ar-u-nu-latn", now)).toMatch(/3/); // Latin digits, not ٣
  expect(size(1_468_006, "en")).toBe("1.4 MB");
  expect(size(52_000, "en")).toBe("50.8 kB");
  expect(size(103, "en")).toBe("0.1 kB");
});

test("names in an Arabic sentence keep their own direction", () => {
  const t = translator("ar");
  expect(t("source.atRow", { file: "Tower BOQ.xlsx", sheet: "Div.03", row: 9 })).toBe(
    "⁨Tower BOQ.xlsx⁩، ⁨Div.03⁩ الصف 9",
  );
  expect(translator("en")("source.atRow", { file: "Tower BOQ.xlsx", sheet: "Div.03", row: 9 })).toBe(
    "Tower BOQ.xlsx, Div.03 row 9",
  );
});
