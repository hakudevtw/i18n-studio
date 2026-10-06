import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Catalog } from "./catalog.js";
import type { Config } from "./config.js";
import { atomicWriteAll, type WriteFile } from "./fsx.js";
import { BUILTIN_STORED, DERIVED_STATES } from "./states.js";

/** Built-in stored states plus the configured custom ones (plain labels). */
export type StoredState = string;
/** Stored states plus the ones derived from the data (never written to disk). */
export type State = string;

export const storedStates = (config: Config): string[] => [
  ...BUILTIN_STORED,
  ...config.customStates,
];
/** Every state, derived first; used to order status output. */
export const allStates = (config: Config): string[] => [
  ...DERIVED_STATES,
  ...storedStates(config),
];

/** What was recorded for one key (a row across all locales). */
export type StatusRecord = {
  state: StoredState;
  /** Value hash per locale, source locale included; "-" = unknown. */
  hashes: Record<string, string>;
};

/** One key across all locales, with its derived state. */
export type Row = {
  ns: string;
  key: string;
  /** `<ns>.<key>` */
  address: string;
  /** Value per locale (empty string when absent). */
  values: Record<string, string>;
  state: State;
  /** Matches `ignoreKeys`: may stay empty, is never derived as missing. */
  ignored: boolean;
  /** Locales whose value differs from the recorded hash (empty without a record). */
  changedLocales: string[];
};

export const NO_RECORDS_HINT = "No status records yet — run `i18n-studio init`";

const HASH = /^([0-9a-f]{10}|-)$/;

const escapeRegExp = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

/** Matcher for glob patterns where `*` is any run of characters (dots included). */
export const globMatcher = (patterns: string[]) => {
  const regexes = patterns.map(
    (p) => new RegExp(`^${p.split("*").map(escapeRegExp).join(".*")}$`)
  );
  return (address: string) => regexes.some((re) => re.test(address));
};

export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 10);

/** Source locale first, then the other locales. */
export const localesOf = (config: Config, catalog: Catalog) => [
  config.sourceLocale,
  ...catalog.locales,
];

export const statusPath = (config: Config, ns: string) =>
  join(config.statusDir, `${ns}.tsv`);

/** Parsed by header, so a new locale simply becomes a new column. */
export const readStatus = (config: Config, ns: string) => {
  const records = new Map<string, StatusRecord>();
  const errors: string[] = [];
  const file = statusPath(config, ns);
  if (!existsSync(file)) {
    return { records, errors, exists: false };
  }
  const [head, ...lines] = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l !== "");
  const header = head?.startsWith("# ") ? head.slice(2).split("\t") : [];
  const locales = header.slice(2);
  if (header[0] !== "key" || header[1] !== "state" || locales.length === 0) {
    errors.push(`${ns}.tsv:1: missing or malformed header comment`);
    return { records, errors, exists: true };
  }
  for (const [i, line] of lines.entries()) {
    const [key, state, ...cols] = line.split("\t");
    const ok =
      cols.length === locales.length &&
      storedStates(config).includes(state) &&
      cols.every((c) => HASH.test(c));
    if (!ok || records.has(key)) {
      errors.push(`${ns}.tsv:${i + 2}: malformed or duplicate line`);
      continue;
    }
    records.set(key, {
      state: state as StoredState,
      hashes: Object.fromEntries(locales.map((l, c) => [l, cols[c]])),
    });
  }
  return { records, errors, exists: true };
};

export const hasRecords = (config: Config, catalog: Catalog) =>
  catalog.namespaces.some((ns) => readStatus(config, ns).records.size > 0);

export const deriveState = (
  sourceLocale: string,
  values: Record<string, string>,
  record: StatusRecord | undefined,
  ignored = false
): { state: State; changedLocales: string[] } => {
  const changedLocales = record
    ? Object.keys(values).filter((l) => hash(values[l]) !== record.hashes[l])
    : [];
  const withState = (state: State) => ({ state, changedLocales });
  // Soft delete: an archived row is never missing/stale/edited, whatever its values.
  if (record?.state === "archived") {
    return withState("archived");
  }
  if (!ignored && Object.values(values).some((v) => v === "")) {
    return withState("missing");
  }
  if (!record) {
    return withState("new");
  }
  if (changedLocales.length === 0) {
    return withState(record.state);
  }
  // Only the source changed: the translations are probably outdated.
  const onlySource =
    changedLocales.length === 1 && changedLocales[0] === sourceLocale;
  return withState(onlySource ? "stale" : "edited");
};

export const getRows = (
  config: Config,
  catalog: Catalog,
  namespaces: string[] = catalog.namespaces
): Row[] => {
  const locales = localesOf(config, catalog);
  const ignore = globMatcher(config.ignoreKeys);
  const rows: Row[] = [];
  for (const ns of namespaces) {
    const { records } = readStatus(config, ns);
    const maps = locales.map((l) => new Map(catalog.messages[l][ns] ?? []));
    for (const [key] of catalog.messages[config.sourceLocale][ns] ?? []) {
      const values = Object.fromEntries(
        locales.map((l, i) => [l, maps[i].get(key) ?? ""])
      );
      const address = `${ns}.${key}`;
      const ignored = ignore(address);
      rows.push({
        ns,
        key,
        address,
        values,
        ignored,
        ...deriveState(config.sourceLocale, values, records.get(key), ignored),
      });
    }
  }
  return rows;
};

type Record_ = { row: Pick<Row, "ns" | "key" | "values">; state: StoredState };

/** Status files recording each row (with the values given in it) in its state, current hashes. */
export const recordFiles = (
  config: Config,
  catalog: Catalog,
  entries: Record_[]
): WriteFile[] =>
  [...new Set(entries.map((e) => e.row.ns))].map((ns) => {
    const { records } = readStatus(config, ns);
    for (const { row, state } of entries.filter((e) => e.row.ns === ns)) {
      records.set(row.key, {
        state,
        hashes: Object.fromEntries(
          Object.entries(row.values).map(([l, v]) => [l, hash(v)])
        ),
      });
    }
    return statusFile(config, catalog, ns, records);
  });

/** Record rows as `state` with current hashes. */
export const markRows = (
  config: Config,
  catalog: Catalog,
  rows: Pick<Row, "ns" | "key" | "values">[],
  state: StoredState
) =>
  atomicWriteAll(
    recordFiles(
      config,
      catalog,
      rows.map((row) => ({ row, state }))
    )
  );

/** One line per key in source-locale order; records of removed keys are dropped. */
export const statusFile = (
  config: Config,
  catalog: Catalog,
  ns: string,
  records: Map<string, StatusRecord>
): WriteFile => {
  const locales = localesOf(config, catalog);
  const lines = [`# key\tstate\t${locales.join("\t")}\n`];
  for (const [key] of catalog.messages[config.sourceLocale][ns] ?? []) {
    const r = records.get(key);
    if (r) {
      const cols = locales.map((l) => r.hashes[l] ?? "-");
      lines.push(`${key}\t${r.state}\t${cols.join("\t")}\n`);
    }
  }
  return { path: statusPath(config, ns), content: lines.join("") };
};

export const writeStatus = (
  config: Config,
  catalog: Catalog,
  ns: string,
  records: Map<string, StatusRecord>
) => atomicWriteAll([statusFile(config, catalog, ns, records)]);
