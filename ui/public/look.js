// The engineer's language and theme, remembered from last time, applied before the first paint: Arabic starts right
// to left and a dark theme starts dark, instead of flashing the defaults while the service answers.
try {
  const look = JSON.parse(localStorage.getItem("tawreed.look") || "{}");
  const root = document.documentElement;
  if (look.language === "ar") {
    root.lang = "ar";
    root.dir = "rtl";
  }
  if (look.theme === "light" || look.theme === "dark") root.dataset.theme = look.theme;
} catch {
  // Nothing remembered, or storage is blocked: the defaults stand until the service answers.
}
