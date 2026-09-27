import { ar } from "./ar";
import { en, type Entry, type Key } from "./en";

export type Language = "en" | "ar";
export type { Key };
export type Params = Record<string, string | number>;
export type Translate = (key: Key, params?: Params) => string;

const dictionaries: Record<Language, Record<Key, Entry>> = { en, ar };

/** Intl locale for a language. Arabic keeps Latin digits, like the BOQs themselves. */
export function locale(language: Language): string {
  return language === "ar" ? "ar-u-nu-latn" : "en";
}

export function direction(language: Language): "rtl" | "ltr" {
  return language === "ar" ? "rtl" : "ltr";
}

// In Arabic, a name set into a sentence (a file, a sheet, a package) is isolated, so a Latin name keeps its own
// order and doesn't pull the Arabic words around it out of place.
const isolate = (text: string) => `⁨${text}⁩`;

export function translator(language: Language): Translate {
  const plurals = new Intl.PluralRules(locale(language));
  const numbers = new Intl.NumberFormat(locale(language));
  return (key, params = {}) => {
    const entry = dictionaries[language][key] as Entry | undefined;
    if (entry === undefined) return key; // an error code the interface doesn't know yet
    const text = typeof entry === "string" ? entry : (entry[plurals.select(Number(params.count ?? 0))] ?? entry.other);
    return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
      const value = params[name];
      if (value === undefined) return whole;
      if (typeof value === "number") return numbers.format(value);
      return language === "ar" ? isolate(value) : value;
    });
  };
}
