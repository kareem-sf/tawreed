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
      return typeof value === "number" ? numbers.format(value) : value;
    });
  };
}
