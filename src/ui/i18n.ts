import { UI_LOCALES, type UiLocale, type UiLocaleSetting } from "../model";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import zhTW from "./locales/zh-TW.json";

type Dictionary = Record<string, string>;

const DICTIONARIES: Record<UiLocale, Dictionary> = {
  en,
  ko,
  "zh-TW": zhTW,
  ja,
};
const TRADITIONAL = /tw|hant|hk|mo/;
const VARIABLE = /\{(\w+)\}/g;

/** Browser language tag -> a shipped UI locale (zh-TW/Hant/HK -> zh-TW, ko*, ja*, else en). */
export const mapLanguage = (tag: string | undefined): UiLocale => {
  const lower = (tag ?? "").toLowerCase();
  if (lower.startsWith("zh")) {
    return TRADITIONAL.test(lower) ? "zh-TW" : "en";
  }
  if (lower.startsWith("ko")) {
    return "ko";
  }
  return lower.startsWith("ja") ? "ja" : "en";
};

const shipped = (value: string | null | undefined) =>
  UI_LOCALES.find((l) => l.toLowerCase() === value?.toLowerCase());

/**
 * Query (`?lang=ko`) > the user's remembered choice (only while the switcher is on) >
 * configured uiLocale > browser language.
 */
export const resolveLocale = (opts: {
  query?: string | null;
  stored?: string | null;
  switcher?: boolean;
  setting?: UiLocaleSetting;
  languages?: readonly string[];
}): UiLocale => {
  const chosen =
    shipped(opts.query) ??
    (opts.switcher === false ? undefined : shipped(opts.stored));
  if (chosen) {
    return chosen;
  }
  if (opts.setting && opts.setting !== "auto") {
    return opts.setting;
  }
  return mapLanguage(opts.languages?.[0]);
};

/** Translator for one locale: falls back to English, then to the key. `{name}` is interpolated. */
export const makeT = (locale: UiLocale) => {
  const dict = DICTIONARIES[locale];
  const has = (key: string) => key in dict || key in en;
  const t = (key: string, vars: Record<string, string | number> = {}) =>
    (dict[key] ?? (en as Dictionary)[key] ?? key).replace(
      VARIABLE,
      (whole, name: string) => String(vars[name] ?? whole)
    );
  const plurals = new Intl.PluralRules(locale);
  /** `key.one` / `key.other` chosen with the locale's plural rules. */
  const tn = (
    key: string,
    n: number,
    vars: Record<string, string | number> = {}
  ) => {
    const form = plurals.select(n) === "one" ? "one" : "other";
    return t(has(`${key}.${form}`) ? `${key}.${form}` : `${key}.other`, {
      n,
      ...vars,
    });
  };
  return { t, tn, has };
};

export type Translator = ReturnType<typeof makeT>;
export const DICTIONARY_KEYS = (locale: UiLocale) =>
  Object.keys(DICTIONARIES[locale]);
