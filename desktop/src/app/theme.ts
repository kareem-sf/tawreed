import { createTheme } from "@mantine/core";

export const tawreedTheme = createTheme({
  primaryColor: "blue",
  defaultRadius: "md",
  fontFamily:
    '"Geist Variable", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  fontFamilyMonospace:
    '"Geist Mono Variable", "Cascadia Mono", "SFMono-Regular", Consolas, monospace',
  headings: {
    fontFamily:
      '"Geist Variable", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif',
    fontWeight: "500",
  },
  cursorType: "pointer",
  focusRing: "auto",
});
