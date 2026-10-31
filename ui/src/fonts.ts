import "@fontsource-variable/kumbh-sans";
// The Arabic face every build carries (open licence): shipped builds have no Thmanyah, so Arabic is set in this.
// Registered here rather than with the package's CSS, whose range leaves the space to the Latin face: WebKit then
// sets each Arabic word as its own run, and a word with a vowel mark (ً) lands higher than its neighbours.
import plex300 from "@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-300-normal.woff2?url";
import plex400 from "@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2?url";
import plex500 from "@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-500-normal.woff2?url";
import plex700 from "@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-700-normal.woff2?url";

// Thmanyah (Arabic) is licensed for use inside the compiled app only, so its files are never committed: they sit in
// the gitignored ui/src/fonts/thmanyah/ on the engineer's machine. Thmanyah Sans sets text and headings.
// Without them (CI, a fresh clone) the glob is empty and Arabic is set in IBM Plex Sans Arabic.
const FAMILIES: Record<string, string> = { thmanyahsans: "Thmanyah Sans" };
const WEIGHTS: Record<string, string> = { Light: "300", Regular: "400", Medium: "500", Bold: "700" };
const files = import.meta.glob<string>("./fonts/thmanyah/thmanyahsans-*.woff2", { eager: true, query: "?url", import: "default" });

// Arabic and its presentation forms, plus the space, no-break space, joiners, direction marks and isolates that sit
// inside Arabic text: so a line of Arabic is set in one face, not mixed per glyph with the Latin one.
const ARABIC = "U+0020,U+00A0,U+0600-06FF,U+0750-077F,U+08A0-08FF,U+200C-200F,U+2066-2069,U+FB50-FDFF,U+FE70-FEFF";

// Linux's web view (WebKitGTK) lifts a run of Arabic whose first word carries a positioned mark (بنداً, نصاً) above
// its line, and Thmanyah's marks and joins jump whole lines. There, Arabic is set in IBM Plex Sans Arabic with mark
// positioning off: every word stays on the line and the marks still read. Windows and macOS are unaffected.
export function isWebKitGtk(ua: string): boolean {
  return /Linux/.test(ua) && /AppleWebKit/.test(ua) && !/Chrome|Chromium|Android/.test(ua);
}
const webkitGtk = isWebKitGtk(typeof navigator === "undefined" ? "" : navigator.userAgent);

/** Start loading the Arabic faces (IBM Plex Sans Arabic, and Thmanyah where present); they settle within `timeout` ms or are given up on, so a missing or slow font never holds the app back. */
export function loadFaces(timeout = 1500): Promise<unknown> {
  if (typeof FontFace === "undefined") return Promise.resolve();
  const faces: FontFace[] = [];
  for (const [weight, url] of [["300", plex300], ["400", plex400], ["500", plex500], ["700", plex700]] as const) {
    const face = new FontFace("IBM Plex Sans Arabic", `url(${url}) format("woff2")`, {
      weight,
      display: "swap",
      unicodeRange: ARABIC,
      ...(webkitGtk && { featureSettings: '"mark" 0' }),
    });
    document.fonts.add(face);
    faces.push(face);
  }
  for (const [path, url] of webkitGtk ? [] : Object.entries(files)) {
    const [, file = "", style = ""] = /(\w+)-(\w+)\.woff2$/.exec(path) ?? [];
    const family = FAMILIES[file];
    const weight = WEIGHTS[style];
    if (!family || !weight) continue;
    const face = new FontFace(family, `url(${url}) format("woff2")`, { weight, display: "block", unicodeRange: ARABIC });
    document.fonts.add(face);
    faces.push(face);
  }
  const loaded = Promise.all(faces.map((face) => face.load())).catch(() => undefined);
  return Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, timeout))]);
}
