import { describe, expect, it } from "vitest";
import { UI_LOCALES } from "../src/model.js";
import {
  DICTIONARY_KEYS,
  makeT,
  mapLanguage,
  resolveLocale,
} from "../src/ui/i18n.js";
import { tsvText } from "../src/ui/tsv.js";

describe("t()", () => {
  it("interpolates {name} variables and keeps unknown ones", () => {
    const { t } = makeT("en");
    expect(t("rows", { n: 3 })).toBe("3 rows");
    expect(t("rowsInGroups", { n: 3, g: 2 })).toBe("3 rows in 2 groups");
    expect(t("rows")).toBe("{n} rows");
  });

  it("translates per locale", () => {
    expect(makeT("ko").t("copy")).toBe("TSV로 복사");
    expect(makeT("ja").t("rows", { n: 2 })).toBe("2 行");
    expect(makeT("zh-TW").t("empty")).toContain("篩選");
  });

  it("falls back to English, then to the key", () => {
    const { t, has } = makeT("ko");
    expect(t("no.such.key")).toBe("no.such.key");
    expect(has("no.such.key")).toBe(false);
    expect(has("status.approved")).toBe(true);
    // custom states have no entry: the UI shows the raw state name
    expect(has("status.legal-ok")).toBe(false);
  });
});

describe("locale resolution", () => {
  it("maps browser languages", () => {
    for (const [tag, locale] of [
      ["zh-TW", "zh-TW"],
      ["zh-Hant", "zh-TW"],
      ["zh-Hant-TW", "zh-TW"],
      ["zh-HK", "zh-TW"],
      ["zh-CN", "en"],
      ["zh", "en"],
      ["ko", "ko"],
      ["ko-KR", "ko"],
      ["ja-JP", "ja"],
      ["fr-FR", "en"],
      ["", "en"],
      [undefined, "en"],
    ] as const) {
      expect(mapLanguage(tag)).toBe(locale);
    }
  });

  it("prefers query, then the configured locale, then the browser", () => {
    const languages = ["ja-JP"];
    expect(resolveLocale({ query: "ko", setting: "zh-TW", languages })).toBe(
      "ko"
    );
    expect(resolveLocale({ query: "ZH-tw", languages })).toBe("zh-TW");
    expect(resolveLocale({ query: "xx", setting: "zh-TW", languages })).toBe(
      "zh-TW"
    );
    expect(resolveLocale({ query: null, setting: "auto", languages })).toBe(
      "ja"
    );
    expect(resolveLocale({ languages: ["ko-KR"] })).toBe("ko");
    expect(resolveLocale({})).toBe("en");
  });
});

describe("dictionaries", () => {
  it("have identical key sets in every shipped locale", () => {
    const english = [...DICTIONARY_KEYS("en")].sort();
    expect(english.length).toBeGreaterThan(30);
    for (const locale of UI_LOCALES) {
      expect([...DICTIONARY_KEYS(locale)].sort()).toEqual(english);
    }
  });

  it("keep the same {variables} as English in every locale", () => {
    const vars = (s: string) =>
      [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const locale of UI_LOCALES) {
      for (const key of DICTIONARY_KEYS("en")) {
        const probe = (l: (typeof UI_LOCALES)[number]) =>
          vars(makeT(l).t(key, {}));
        expect(probe(locale), `${locale}:${key}`).toEqual(probe("en"));
      }
    }
  });
});

describe("Copy as TSV text", () => {
  const rows = [
    {
      group: "a",
      key: "k1",
      status: "new",
      cells: [{ text: "x" }, { text: "y\nz" }],
    },
    {
      group: "b",
      key: "k2",
      status: "approved",
      cells: [{ text: "q" }, { text: "" }],
    },
  ];
  const columns = ["en", "ko"];

  it("orders columns status, namespace (only across several), key, languages", () => {
    expect(tsvText(rows, columns, [0, 1], true)).toBe(
      'status\tnamespace\tkey\ten\tko\nnew\ta\tk1\tx\t"y\nz"\napproved\tb\tk2\tq\t'
    );
    expect(tsvText(rows.slice(0, 1), columns, [0, 1], true)).toBe(
      'status\tkey\ten\tko\nnew\tk1\tx\t"y\nz"'
    );
  });

  it("honours copyHeader and the visible language columns", () => {
    expect(tsvText(rows.slice(1), columns, [1], false)).toBe("approved\tk2\t");
  });
});
