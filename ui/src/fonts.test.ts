import { expect, test } from "vitest";
import { isWebKitGtk } from "./fonts";

test("only Linux's WebKit web view gets the Arabic mark workaround", () => {
  // The Tauri window on Linux (WebKitGTK).
  expect(isWebKitGtk("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/60.5 Safari/605.1.15")).toBe(true);
  // Windows (WebView2), macOS (WKWebView), Chrome and Firefox on Linux, Android.
  expect(isWebKitGtk("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0")).toBe(false);
  expect(isWebKitGtk("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)")).toBe(false);
  expect(isWebKitGtk("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")).toBe(false);
  expect(isWebKitGtk("Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0")).toBe(false);
  expect(isWebKitGtk("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36")).toBe(false);
});
