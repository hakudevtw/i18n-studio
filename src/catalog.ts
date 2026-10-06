import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";
import {
  detectIndent,
  type Flat,
  flatten,
  serialize,
  unflatten,
} from "./flatten.js";

export type Catalog = {
  /** Non-source locales, auto-detected: sub-folders of i18nDir that contain *.json. */
  locales: string[];
  /** Auto-discovered from the source locale's *.json files. */
  namespaces: string[];
  /** messages[locale][namespace]; undefined when the file does not exist. */
  messages: Record<string, Record<string, Flat | undefined>>;
};

const hasJson = (dir: string) =>
  readdirSync(dir).some((f) => f.endsWith(".json"));

/** Sub-folders holding *.json, minus the configured status/report folders. */
const listLocales = (dir: string, exclude: string[]) =>
  readdirSync(dir, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() &&
        !exclude.includes(join(dir, e.name)) &&
        hasJson(join(dir, e.name))
    )
    .map((e) => e.name)
    .sort();

/** Names with `first` (those that exist) in the given order, then the rest as they were. */
const ordered = (names: string[], first: string[]) => [
  ...first.filter((n) => names.includes(n)),
  ...names.filter((n) => !first.includes(n)),
];

const messagePath = (config: Config, lang: string, ns: string) =>
  join(config.i18nDir, lang, `${ns}.json`);

export const loadCatalog = (config: Config): Catalog => {
  const sourceDir = join(config.i18nDir, config.sourceLocale);
  if (!existsSync(sourceDir)) {
    throw new Error(
      `Source locale folder not found: ${sourceDir} (check --dir, or pass --source <locale>)`
    );
  }
  if (config.excludeLocales.includes(config.sourceLocale)) {
    throw new Error("excludeLocales cannot contain the source locale");
  }
  const locales = ordered(
    listLocales(config.i18nDir, [config.statusDir, config.reportDir]).filter(
      (l) => l !== config.sourceLocale && !config.excludeLocales.includes(l)
    ),
    config.localeOrder
  );
  const namespaces = ordered(
    readdirSync(sourceDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length))
      .filter((ns) => !config.excludeNamespaces.includes(ns))
      .sort(),
    config.namespaceOrder
  );
  const messages: Catalog["messages"] = {};
  for (const lang of [config.sourceLocale, ...locales]) {
    messages[lang] = {};
    for (const ns of namespaces) {
      const file = messagePath(config, lang, ns);
      messages[lang][ns] = existsSync(file)
        ? flatten(JSON.parse(readFileSync(file, "utf8")))
        : undefined;
    }
  }
  return { locales, namespaces, messages };
};

/** Write a locale file with keys in source-locale order (unknown keys keep their order, last). */
export const saveMessages = (
  config: Config,
  catalog: Catalog,
  { lang, ns }: { lang: string; ns: string },
  values: Map<string, string>
) => {
  const source = catalog.messages[config.sourceLocale][ns] ?? [];
  const known = new Set(source.map(([k]) => k));
  const pairs: Flat = [];
  for (const [key] of source) {
    if (values.has(key)) {
      pairs.push([key, values.get(key) as string]);
    }
  }
  for (const [key, value] of values) {
    if (!known.has(key)) {
      pairs.push([key, value]);
    }
  }
  const file = messagePath(config, lang, ns);
  const existing = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  const indent =
    config.indent === "auto" ? detectIndent(existing ?? "") : config.indent;
  writeFileSync(
    file,
    serialize(unflatten(pairs), existing?.endsWith("\n") ?? false, indent)
  );
};
