import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  type Catalog,
  loadCatalog,
  messagesFile,
  saveMessages,
} from "./catalog.js";
import type { Config } from "./config.js";
import { findArrayGap } from "./flatten.js";
import { atomicWriteAll, type WriteFile } from "./fsx.js";
import { renderReport } from "./html.js";
import type { Banner, Model, ModelRow } from "./model.js";
import { overlayProposal } from "./overlay.js";
import type { ProblemKind } from "./states.js";
import {
  getRows,
  globMatcher,
  hasRecords,
  localesOf,
  markRows,
  NO_RECORDS_HINT,
  type Row,
  readStatus,
  type State,
  statusFile,
  statusPath,
  storedStates,
} from "./status.js";
import { type Sheet, writeTable } from "./table.js";

export type Scope = { ns?: string; keys?: string[] };
export type ExportFormat = "tsv" | "csv" | "xlsx";

export const assertLang = (config: Config, catalog: Catalog, lang: string) => {
  if (!localesOf(config, catalog).includes(lang)) {
    throw new Error(
      `Unknown language "${lang}" (known: ${localesOf(config, catalog).join(", ")})`
    );
  }
};

/** Rows matching the scope. Keys are `<ns>.<dotted.path>`. */
export const selectRows = (
  config: Config,
  catalog: Catalog,
  { ns, keys }: Scope
): Row[] => {
  if (ns && !catalog.namespaces.includes(ns)) {
    throw new Error(`Unknown namespace "${ns}"`);
  }
  const rows = getRows(config, catalog, ns ? [ns] : undefined);
  if (!keys?.length) {
    return rows;
  }
  const known = new Set(rows.map((r) => r.address));
  const unknown = keys.filter((k) => !known.has(k));
  if (unknown.length > 0) {
    throw new Error(`Unknown key(s): ${unknown.join(", ")}`);
  }
  const wanted = new Set(keys);
  return rows.filter((r) => wanted.has(r.address));
};

const countStates = (rows: Row[]) => {
  const counts: Partial<Record<State, number>> = {};
  for (const row of rows) {
    counts[row.state] = (counts[row.state] ?? 0) + 1;
  }
  return counts;
};

export const status = (config: Config, { ns }: { ns?: string }) => {
  const catalog = loadCatalog(config);
  const rows = selectRows(config, catalog, { ns });
  const namespaces: Record<string, Partial<Record<State, number>>> = {};
  for (const name of new Set(rows.map((r) => r.ns))) {
    namespaces[name] = countStates(rows.filter((r) => r.ns === name));
  }
  const noRecords = !hasRecords(config, catalog);
  return {
    rows: rows.length,
    counts: countStates(rows),
    namespaces,
    ...(noRecords && { hint: NO_RECORDS_HINT }),
  };
};

export type Problem = {
  kind: ProblemKind;
  /** `error` when the kind is in `failOn` (status-file always is), else `warning`. */
  level: "error" | "warning";
  message: string;
  /** Path relative to the cwd, when the problem belongs to a file. */
  file?: string;
};

type Found = Omit<Problem, "level">;
type CheckContext = {
  config: Config;
  catalog: Catalog;
  /** Addresses of archived rows: soft deleted, so empty/missing values are fine. */
  archived: Set<string>;
};

/** Problems in one locale file, compared with the source locale's keys. */
const checkFile = (
  { config, catalog, archived }: CheckContext,
  lang: string,
  ns: string
): Found[] => {
  const src = config.sourceLocale;
  const file = relative(
    process.cwd(),
    join(config.i18nDir, lang, `${ns}.json`)
  );
  const where = `${lang}/${ns}.json`;
  const matchIgnored = globMatcher(config.ignoreKeys);
  const ignored = (address: string) =>
    matchIgnored(address) || archived.has(address);
  const found = (kind: ProblemKind, message: string): Found => ({
    kind,
    message: `${where}: ${message}`,
    file,
  });
  const flat = catalog.messages[lang][ns];
  if (!flat) {
    return [found("missing-key", "file missing")];
  }
  const problems = flat
    .filter(([key, value]) => value === "" && !ignored(`${ns}.${key}`))
    .map(([key]) => found("empty", `empty value for "${key}"`));
  if (lang === src) {
    return problems;
  }
  const sourceKeys = (catalog.messages[src][ns] ?? []).map(([k]) => k);
  const known = new Set(sourceKeys);
  const have = new Set(flat.map(([k]) => k));
  for (const key of sourceKeys.filter(
    (k) => !(have.has(k) || ignored(`${ns}.${k}`))
  )) {
    problems.push(found("missing-key", `missing key "${key}"`));
  }
  for (const [key] of flat.filter(([k]) => !known.has(k))) {
    problems.push(found("orphan-key", `orphan key "${key}" (not in ${src})`));
  }
  const order = flat.map(([k]) => k).filter((k) => known.has(k));
  const expected = sourceKeys.filter((k) => have.has(k));
  const at = order.findIndex((k, i) => k !== expected[i]);
  if (at !== -1) {
    problems.push(
      found(
        "order",
        `key order differs from ${src} at "${order[at]}" (expected "${expected[at]}")`
      )
    );
  }
  return problems;
};

const STATE_KINDS = ["stale", "edited", "new", "ai-draft", "in-review"];

const collectProblems = (config: Config): Found[] => {
  let catalog: Catalog;
  try {
    catalog = loadCatalog(config);
  } catch (e) {
    return [{ kind: "status-file", message: (e as Error).message }];
  }
  const rows = getRows(config, catalog);
  const archived = new Set(
    rows.filter((r) => r.state === "archived").map((r) => r.address)
  );
  const problems = catalog.namespaces.flatMap((ns) => [
    ...localesOf(config, catalog).flatMap((lang) =>
      checkFile({ config, catalog, archived }, lang, ns)
    ),
    ...readStatus(config, ns).errors.map(
      (message): Found => ({ kind: "status-file", message })
    ),
  ]);
  for (const row of rows) {
    if (STATE_KINDS.includes(row.state)) {
      problems.push({
        kind: row.state as ProblemKind,
        message: `${row.address} is ${row.state}`,
        file: relative(
          process.cwd(),
          join(config.i18nDir, config.sourceLocale, `${row.ns}.json`)
        ),
      });
    }
  }
  return problems;
};

/** Everything is a warning unless its kind is in `failOn` (status-file always fails). */
export const check = (config: Config) => {
  const problems: Problem[] = collectProblems(config).map((p) => ({
    ...p,
    level: config.failOn.includes(p.kind) ? "error" : "warning",
  }));
  const count = (level: Problem["level"]) =>
    problems.filter((p) => p.level === level).length;
  return {
    ok: count("error") === 0,
    errors: count("error"),
    warnings: count("warning"),
    problems,
  };
};

export const init = (config: Config, { force }: { force: boolean }) => {
  const catalog = loadCatalog(config);
  const existing = catalog.namespaces.filter(
    (ns) => readStatus(config, ns).exists
  );
  if (existing.length > 0 && !force) {
    throw new Error(
      `Status files already exist (${existing.length}, e.g. ${existing[0]}.tsv); use --force to overwrite`
    );
  }
  // Archived rows keep their archived record; init never touches them.
  const all = getRows(config, catalog);
  const archived = all.filter((r) => r.state === "archived");
  for (const ns of existing) {
    rmSync(statusPath(config, ns), { force: true });
  }
  markRows(config, catalog, archived, "archived");
  // Rows with an empty value in any locale get no record and show as missing.
  const rows = all.filter(
    (r) => r.state !== "missing" && r.state !== "archived"
  );
  markRows(config, catalog, rows, "approved");
  return { approved: rows.length };
};

export type PruneListing = { address: string; values: Record<string, string> };

/**
 * Permanently delete archived keys from every locale's JSON and from the status files.
 * Without `yes` it only lists them. The tool cannot know whether application code still
 * references a key: check usage first.
 */
export const prune = (
  config: Config,
  scope: Scope,
  { yes }: { yes: boolean }
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: validate, list, then delete
) => {
  const catalog = loadCatalog(config);
  const rows = selectRows(config, catalog, scope);
  const notArchived = rows.filter((r) => r.state !== "archived");
  if (scope.keys?.length && notArchived.length > 0) {
    throw new Error(
      `Not archived (run \`mark archived\` first): ${notArchived.map((r) => r.address).join(", ")}`
    );
  }
  const archived = rows.filter((r) => r.state === "archived");
  const listing: PruneListing[] = archived.map((r) => ({
    address: r.address,
    values: r.values,
  }));
  if (!yes || archived.length === 0) {
    return { dryRun: !yes, deleted: 0, archived: listing };
  }
  const files: WriteFile[] = [];
  for (const ns of new Set(archived.map((r) => r.ns))) {
    const doomed = new Set(
      archived.filter((r) => r.ns === ns).map((r) => r.key)
    );
    for (const lang of localesOf(config, catalog)) {
      const kept = (catalog.messages[lang][ns] ?? []).filter(
        ([key]) => !doomed.has(key)
      );
      const gap = findArrayGap(kept);
      if (gap !== undefined) {
        throw new Error(
          `Pruning would leave a gap in the array "${gap}" in ${lang}/${ns}.json; prune the whole array or only its last items`
        );
      }
      if (catalog.messages[lang][ns]) {
        files.push(messagesFile(config, catalog, { lang, ns }, new Map(kept)));
      }
    }
    const { records } = readStatus(config, ns);
    for (const key of doomed) {
      records.delete(key);
    }
    files.push(statusFile(config, catalog, ns, records));
  }
  atomicWriteAll(files);
  return { dryRun: false, deleted: archived.length, archived: listing };
};

/** Set any stored state (built in or custom) on the selected rows. */
export const mark = (config: Config, state: string, scope: Scope) => {
  const allowed = storedStates(config);
  if (!allowed.includes(state)) {
    throw new Error(
      `Unknown state "${state}" (allowed: ${allowed.join(", ")})`
    );
  }
  if (!(scope.ns || scope.keys?.length)) {
    throw new Error("Give keys or --ns");
  }
  const catalog = loadCatalog(config);
  const rows = selectRows(config, catalog, scope);
  markRows(config, catalog, rows, state);
  return { marked: rows.length, state };
};

export const draft = (config: Config, scope: Scope) => {
  const catalog = loadCatalog(config);
  const rows = selectRows(config, catalog, scope).filter(
    (r) => r.state !== "missing" && r.state !== "archived"
  );
  markRows(config, catalog, rows, "ai-draft");
  return { marked: rows.length };
};

export const approve = (
  config: Config,
  scope: Scope,
  { allEdited }: { allEdited: boolean }
) => {
  if (!(allEdited || scope.keys?.length)) {
    throw new Error("Give keys, or --all-edited (optionally with --ns)");
  }
  const catalog = loadCatalog(config);
  const rows = selectRows(config, catalog, scope).filter(
    (r) => r.state !== "missing" && (!allEdited || r.state === "edited")
  );
  markRows(config, catalog, rows, "approved");
  return { approved: rows.length };
};

/** Manual single-cell edit; the row then shows as edited (not auto-approved). */
export const set = (
  config: Config,
  lang: string,
  address: string,
  text: string
) => {
  const catalog = loadCatalog(config);
  assertLang(config, catalog, lang);
  const [row] = selectRows(config, catalog, { keys: [address] });
  const values = new Map(catalog.messages[lang][row.ns] ?? []);
  values.set(row.key, text);
  saveMessages(config, catalog, { lang, ns: row.ns }, values);
  const after = loadCatalog(config);
  const [updated] = selectRows(config, after, { keys: [address] });
  return {
    address,
    lang,
    old: row.values[lang],
    new: text,
    state: updated.state,
  };
};

/** status, [namespace,] key, languages, comment; the namespace only when rows span several. */
const sheetRows = (rows: Row[], locales: string[], withNs: boolean) =>
  rows.map((r) => [
    r.state,
    ...(withNs ? [r.ns] : []),
    r.key,
    ...locales.map((l) => r.values[l]),
    "",
  ]);

export const exportRows = async (
  config: Config,
  opts: { ns?: string; all: boolean; format: ExportFormat; out?: string }
) => {
  const catalog = loadCatalog(config);
  const locales = localesOf(config, catalog);
  const all = selectRows(config, catalog, { ns: opts.ns });
  // Ignored keys are left out of the default set (they stay in --all).
  const toReview = all.filter(
    (r) =>
      !r.ignored &&
      r.state !== "archived" &&
      config.exportStates.includes(r.state)
  );
  const rows = opts.all ? all : toReview;
  const out = opts.out ?? join(config.reportDir, `review.${opts.format}`);
  mkdirSync(dirname(out), { recursive: true });
  const head = ["status", "key", ...locales, "comment"];
  const multiNs = new Set(rows.map((r) => r.ns)).size > 1;
  const sheets: Sheet[] =
    opts.format === "xlsx"
      ? [...new Set(rows.map((r) => r.ns))].map((ns) => ({
          name: ns.slice(0, 31),
          rows: [
            head,
            ...sheetRows(
              rows.filter((r) => r.ns === ns),
              locales,
              false
            ),
          ],
        }))
      : [
          {
            name: "review",
            rows: [
              multiNs
                ? ["status", "namespace", "key", ...locales, "comment"]
                : head,
              ...sheetRows(rows, locales, multiNs),
            ],
          },
        ];
  if (sheets.length === 0) {
    sheets.push({ name: "review", rows: [head] });
  }
  await writeTable(out, opts.format, sheets);
  markRows(config, catalog, toReview, "in-review");
  return { file: out, rows: rows.length, markedInReview: toReview.length };
};

/** The model behind the report page; a pending import proposal (if any) is laid over it. */
export const buildModel = (
  config: Config,
  opts: { proposal?: string } = {}
): Model => {
  const catalog = loadCatalog(config);
  const locales = localesOf(config, catalog);
  let rows: ModelRow[] = getRows(config, catalog).map((r) => ({
    group: r.ns,
    key: r.key,
    status: r.state,
    cells: locales.map((l) => ({
      text: r.values[l],
      changed: r.changedLocales.includes(l),
      mark: r.changedLocales.includes(l) ? ("changed" as const) : undefined,
    })),
  }));
  const banners: Banner[] = hasRecords(config, catalog)
    ? []
    : [{ kind: "noRecords" }];
  const proposalFile = opts.proposal ?? join(config.reportDir, "proposal.json");
  if (existsSync(proposalFile)) {
    const overlay = overlayProposal(
      rows,
      JSON.parse(readFileSync(proposalFile, "utf8")),
      locales
    );
    rows = overlay.rows;
    if (overlay.banner) {
      banners.push(overlay.banner);
    }
  }
  return {
    title: "Translation status",
    copyHeader: config.copyHeader,
    readOnly: config.readOnly,
    languageSwitcher: config.languageSwitcher,
    showArchived: config.showArchived,
    storedStates: storedStates(config),
    banners,
    uiLocale: config.uiLocale,
    columns: locales,
    rows,
  };
};

/** Write the static report page (`studio` serves the same page live). */
export const report = (config: Config, opts: { proposal?: string } = {}) => {
  const file = join(config.reportDir, "report.html");
  atomicWriteAll([
    { path: file, content: renderReport(buildModel(config, opts)) },
  ]);
  return { file };
};
