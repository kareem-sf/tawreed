import "@fontsource-variable/figtree";

// Thmanyah (Arabic) is licensed for use inside the compiled app only, so its files are never committed: they sit in
// the gitignored ui/src/fonts/thmanyah/ on the engineer's machine. Sans sets the text, Serif Display the headings.
// Without them (CI, a fresh clone) the glob is empty and Arabic falls back to the system font.
const FAMILIES: Record<string, string> = { thmanyahsans: "Thmanyah Sans", thmanyahserifdisplay: "Thmanyah Serif Display" };
const WEIGHTS: Record<string, string> = { Light: "300", Regular: "400", Medium: "500", Bold: "700" };
const files = import.meta.glob<string>("./fonts/thmanyah/*.woff2", { eager: true, query: "?url", import: "default" });

if (typeof FontFace !== "undefined") {
  for (const [path, url] of Object.entries(files)) {
    const [, file = "", style = ""] = /(\w+)-(\w+)\.woff2$/.exec(path) ?? [];
    const family = FAMILIES[file];
    const weight = WEIGHTS[style];
    if (family && weight) document.fonts.add(new FontFace(family, `url(${url}) format("woff2")`, { weight }));
  }
}
