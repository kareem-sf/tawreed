import "@fontsource-variable/figtree";

// Thmanyah Sans (Arabic) is licensed for use inside the compiled app only, so its files are never committed:
// they sit in the gitignored ui/src/fonts/thmanyah/ on the engineer's machine. Without them (CI, a fresh clone)
// the glob is empty and Arabic falls back to the system font.
const WEIGHTS: Record<string, string> = { Light: "300", Regular: "400", Medium: "500", Bold: "700" };
const files = import.meta.glob<string>("./fonts/thmanyah/*.woff2", { eager: true, query: "?url", import: "default" });

if (typeof FontFace !== "undefined") {
  for (const [path, url] of Object.entries(files)) {
    const weight = WEIGHTS[/thmanyahsans-(\w+)\.woff2$/.exec(path)?.[1] ?? ""];
    if (weight) document.fonts.add(new FontFace("Thmanyah Sans", `url(${url}) format("woff2")`, { weight }));
  }
}
