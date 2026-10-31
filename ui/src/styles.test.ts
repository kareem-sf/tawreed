import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const css = readFileSync(resolve(__dirname, "styles.css"), "utf8");

test("the Arabic font stack can override the theme: the font variables are not inlined into utilities", () => {
  const inline = /@theme inline \{([^}]*)\}/.exec(css)?.[1] ?? "";
  expect(inline).not.toContain("--font-");
  expect(css).toMatch(/:root:lang\(ar\)\s*\{[^}]*--font-sans:\s*"Thmanyah Sans", "IBM Plex Sans Arabic"/);
});

test("Arabic is never letter-spaced, and swash letters are for large headings only", () => {
  expect(css).not.toContain("--text-title--letter-spacing");
  expect(css).toMatch(/:lang\(ar\)\s*\{[^}]*font-synthesis:\s*none/);
  expect(css).toMatch(/:lang\(ar\) \.text-title,\s*:lang\(ar\) \.text-xl\s*\{[^}]*"swsh" 1/);
  expect(css).not.toMatch(/\.font-heading\s*\{[^}]*swsh/);
});

test("Arabic text inside the English interface leads with the Arabic faces, so its words stay on one line", () => {
  expect(css).toMatch(/:root:lang\(en\) :dir\(rtl\)\s*\{[^}]*font-family:\s*"Thmanyah Sans", "IBM Plex Sans Arabic"/);
});
