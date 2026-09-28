import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

configure({ asyncUtilTimeout: 5000 }); // findBy and waitFor wait longer on a busy machine

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  const root = document.documentElement;
  root.lang = "en";
  root.dir = "ltr";
  delete root.dataset.theme;
  localStorage.clear(); // the remembered look must not carry from one test to the next
});
