import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";
import { type Flat, flatten, serialize, unflatten } from "./flatten.js";

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

const messagePath = (config: Config, lang: string, ns: string) =>
  join(config.i18nDir, lang, `${ns}.json`);

export const loadCatalog = (config: Config): Catalog => {
  const sourceDir = join(config.i18nDir, config.sourceLocale);
  if (!existsSync(sourceDir)) {
    throw new Error(
      `Source locale folder not found: ${sourceDir} (check --dir, or pass --source <locale>)`
    );
  }
  const all = listLocales(config.i18nDir, [config.statusDir, config.reportDir]);
  const namespaces = readdirSync(sourceDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
  const messages: Catalog["messages"] = {};
  for (const lang of all) {
    messages[lang] = {};
    for (const ns of namespaces) {
      const file = messagePath(config, lang, ns);
      messages[lang][ns] = existsSync(file)
        ? flatten(JSON.parse(readFileSync(file, "utf8")))
        : undefined;
    }
  }
  return {
    locales: all.filter((l) => l !== config.sourceLocale),
    namespaces,
    messages,
  };
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
  const trailingNewline = existsSync(file)
    ? readFileSync(file, "utf8").endsWith("\n")
    : false;
  writeFileSync(file, serialize(unflatten(pairs), trailingNewline));
};
