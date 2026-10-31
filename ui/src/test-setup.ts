import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { File as NodeFile } from "node:buffer";
import { afterEach, beforeEach, vi } from "vitest";

configure({ asyncUtilTimeout: 5000 }); // findBy and waitFor wait longer on a busy machine

// jsdom's FormData and File are its own, and Node's Response can't encode them. A webview's can, so the tests use
// Node's pair, which behave like a webview's when upload() turns a form into one buffer.
const NodeFormData = (await new Response(new URLSearchParams()).formData()).constructor as typeof FormData;
beforeEach(() => {
  vi.stubGlobal("FormData", NodeFormData);
  vi.stubGlobal("File", NodeFile);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (typeof document === "undefined") return; // a test that runs in Node, with no page
  const root = document.documentElement;
  root.lang = "en";
  root.dir = "ltr";
  delete root.dataset.theme;
  localStorage.clear(); // the remembered look must not carry from one test to the next
});
