import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { type Catalog, loadCatalog, saveMessages } from "./catalog.js";
import { assertLang, report } from "./commands.js";
import type { Config } from "./config.js";
import { getRows, localesOf, markRows, type Row } from "./status.js";
import { parseText, readTable, type Sheet } from "./table.js";

export type Change = { old: string; new: string };

/** A sheet row matched to exactly one key. Only cells that differ from the repo are listed. */
export type ProposalRow = {
  /** `<ns>.<dotted.path>` */
  id: string;
  /** Where it came from in the file, e.g. "Sheet1:12" or "12". */
  where: string;
  matchedBy: "key" | "source";
  comment: string;
  /** locale -> old/new, only for cells that changed. */
  changes: Record<string, Change>;
  /** Non-source locales with no value in the return (pending rows only). */
  missing: string[];
  reject?: boolean;
};

/** A row that could not be mapped to one key. Set `resolve` to accept it. */
export type PendingEntry = {
  where: string;
  reason: string;
  key?: string;
  source?: string;
  /** locale -> text returned (non-source locales, non-empty). */
  values: Record<string, string>;
  comment: string;
  /** Possible ids (empty for unmatched rows). */
  candidates: string[];
  /** One id or a list of ids to apply `values` to; null = ignore. */
  resolve: string | string[] | null;
};

export type Proposal = {
  version: 2;
  file: string;
  /** Complete rows (every non-source locale returned) with at least one changed cell. */
  rows: ProposalRow[];
  /** Complete rows without any change: approved as they are. */
  confirmed: ProposalRow[];
  /** Rows with only some locales returned: changed cells are written, row stays in-review. */
  pending: ProposalRow[];
  ambiguous: PendingEntry[];
  unmatched: PendingEntry[];
  /** Informational: rows ignored (nothing returned, or incomplete without changes). */
  skipped: string[];
};

type Role = "key" | "ns" | "status" | "comment";
type Layout = {
  roles: Partial<Record<Role, number>>;
  /** locale -> column */
  locales: Record<string, number>;
  first: number;
};
type Index = {
  addresses: Set<string>;
  byKey: Map<string, string[]>;
  /** locale -> squashed value -> ids */
  byValue: Map<string, Map<string, string[]>>;
  rows: Map<string, Row>;
};
type Ctx = {
  config: Config;
  locales: string[];
  index: Index;
  proposal: Proposal;
  lang?: string;
};

const HEADER_SCAN_ROWS = 30;
const MATCH_RATIO = 0.3;
const ROLE_HEADERS: [Role, RegExp][] = [
  ["key", /^(key|string ?id|path|key ?path)$/],
  ["ns", /^(namespace|ns|file|page|section)$/],
  ["status", /^(status|state)$/],
  ["comment", /comment|note|remark|feedback|reviewer/],
];
const SOURCE_HEADER = /^(source|original|source text|english( text)?)$/;
const TARGET_HEADER = /^(translation|translated|target|target text|new)$/;

const clean = (s: string) => s.replace(/\r\n?/g, "\n").trim();
const squash = (s: string) => clean(s).replace(/\s+/g, " ");

const langName = (code: string) => {
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "language" })
        .of(code)
        ?.toLowerCase() ?? ""
    );
  } catch {
    return "";
  }
};

const matchesLang = (h: string, code: string) =>
  h === code || h === langName(code) || new RegExp(`^${code}\\b`).test(h);

/** Locale a header cell names, if any. */
const localeOf = (cell: string, ctx: Ctx, all: string[]) => {
  const h = cell.trim().toLowerCase();
  if (SOURCE_HEADER.test(h)) {
    return ctx.config.sourceLocale;
  }
  if (ctx.lang && TARGET_HEADER.test(h)) {
    return ctx.lang;
  }
  return h ? all.find((l) => matchesLang(h, l)) : undefined;
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: scans candidate header rows
const findHeader = (rows: string[][], ctx: Ctx): Layout | null => {
  const all = [ctx.config.sourceLocale, ...ctx.locales];
  let best: (Layout & { score: number }) | null = null;
  for (const [index, row] of rows.slice(0, HEADER_SCAN_ROWS).entries()) {
    const layout: Layout = { roles: {}, locales: {}, first: index + 1 };
    for (const [c, cell] of row.entries()) {
      const h = cell.trim().toLowerCase();
      const role = ROLE_HEADERS.find(([, re]) => re.test(h))?.[0];
      const locale = role ? undefined : localeOf(cell, ctx, all);
      if (locale && layout.locales[locale] === undefined) {
        layout.locales[locale] = c;
      } else if (role && layout.roles[role] === undefined) {
        layout.roles[role] = c;
      }
    }
    const score =
      Object.keys(layout.roles).length + Object.keys(layout.locales).length;
    if (
      Object.keys(layout.locales).length > 0 &&
      score >= 2 &&
      score > (best?.score ?? 0)
    ) {
      best = { ...layout, score };
    }
  }
  return best;
};

const buildIndex = (config: Config, catalog: Catalog): Index => {
  const index: Index = {
    addresses: new Set(),
    byKey: new Map(),
    byValue: new Map(),
    rows: new Map(),
  };
  const push = (m: Map<string, string[]>, k: string, v: string) =>
    m.set(k, [...(m.get(k) ?? []), v]);
  const locales = localesOf(config, catalog);
  for (const l of locales) {
    index.byValue.set(l, new Map());
  }
  for (const row of getRows(config, catalog)) {
    index.addresses.add(row.address);
    index.rows.set(row.address, row);
    push(index.byKey, row.key, row.address);
    for (const l of locales) {
      if (row.values[l]) {
        push(
          index.byValue.get(l) as Map<string, string[]>,
          squash(row.values[l]),
          row.address
        );
      }
    }
  }
  return index;
};

const columnStats = (
  rows: string[][],
  c: number,
  hit: (v: string) => boolean
) => {
  const filled = rows.filter((r) => (r[c] ?? "").trim() !== "").length;
  const hits = rows.filter((r) => hit(r[c] ?? "")).length;
  return { filled, hits, ok: hits > 0 && hits >= filled * MATCH_RATIO };
};

/** Without a header: pick key/locale columns by how many cells match real keys / values. */
const guessLayout = (rows: string[][], ctx: Ctx): Layout => {
  const { index } = ctx;
  const width = Math.max(0, ...rows.map((r) => r.length));
  const cols = Array.from({ length: width }, (_, c) => c);
  const keyHit = (v: string) =>
    index.addresses.has(clean(v)) || index.byKey.has(clean(v));
  const key = cols
    .filter((c) => columnStats(rows, c, keyHit).ok)
    .sort(
      (a, b) =>
        columnStats(rows, b, keyHit).hits - columnStats(rows, a, keyHit).hits
    )[0];
  const layout: Layout = { roles: {}, locales: {}, first: 0 };
  if (key !== undefined) {
    layout.roles.key = key;
  }
  const taken = new Set<number>(key === undefined ? [] : [key]);
  const candidates = [...index.byValue.entries()].flatMap(([l, values]) =>
    cols.map((c) => ({
      l,
      c,
      ...columnStats(rows, c, (v) => values.has(squash(v))),
    }))
  );
  for (const { l, c, ok } of candidates.sort((a, b) => b.hits - a.hits)) {
    if (ok && !taken.has(c) && layout.locales[l] === undefined) {
      layout.locales[l] = c;
      taken.add(c);
    }
  }
  if (ctx.lang && layout.locales[ctx.lang] === undefined) {
    const filled = (c: number) => columnStats(rows, c, () => false).filled;
    const free = cols
      .filter((c) => !taken.has(c))
      .sort((x, y) => filled(y) - filled(x));
    if (free.length > 0) {
      layout.locales[ctx.lang] = free[0];
    }
  }
  const matchable =
    key !== undefined || ctx.config.sourceLocale in layout.locales;
  if (!matchable || Object.keys(layout.locales).length === 0) {
    throw new Error(
      "Cannot detect key/locale columns; add a header row (e.g. key, en, ko)"
    );
  }
  return layout;
};

const pending = (
  where: string,
  reason: string,
  row: {
    key?: string;
    source?: string;
    values: Record<string, string>;
    comment: string;
  },
  candidates: string[]
): PendingEntry => ({
  where,
  reason,
  key: row.key || undefined,
  source: row.source || undefined,
  values: row.values,
  comment: row.comment,
  candidates,
  resolve: null,
});

const lookup = (
  data: { key: string; texts: Record<string, string> },
  ns: string | undefined,
  ctx: Ctx
): ["key" | "source", string[]] => {
  const { index } = ctx;
  const inNs = (ids: string[]) =>
    ns ? ids.filter((id) => id.startsWith(`${ns}.`)) : ids;
  if (data.key) {
    const direct = [ns ? `${ns}.${data.key}` : "", data.key].filter((id) =>
      index.addresses.has(id)
    );
    if (direct.length > 0) {
      return ["key", [direct[0]]];
    }
    const bare = inNs(index.byKey.get(data.key) ?? []);
    if (bare.length > 0) {
      return ["key", bare];
    }
  }
  for (const l of [ctx.config.sourceLocale, ...ctx.locales]) {
    const text = data.texts[l];
    const found = text
      ? inNs(index.byValue.get(l)?.get(squash(text)) ?? [])
      : [];
    if (found.length > 0) {
      return ["source", found];
    }
  }
  return ["source", []];
};

/** Turn one matched sheet row into the proposal section it belongs to. */
const place = (
  ctx: Ctx,
  entry: {
    id: string;
    where: string;
    matchedBy: "key" | "source";
    comment: string;
  },
  texts: Record<string, string>
) => {
  const row = ctx.index.rows.get(entry.id) as Row;
  const changes: Record<string, Change> = {};
  for (const l of ctx.locales) {
    if (texts[l] && texts[l] !== clean(row.values[l])) {
      changes[l] = { old: row.values[l], new: texts[l] };
    }
  }
  const missing = ctx.locales.filter((l) => !texts[l]);
  const item: ProposalRow = { ...entry, changes, missing };
  const changed = Object.keys(changes).length > 0;
  if (missing.length === 0) {
    (changed ? ctx.proposal.rows : ctx.proposal.confirmed).push(item);
  } else if (changed) {
    ctx.proposal.pending.push(item);
  } else {
    ctx.proposal.skipped.push(`${entry.where}: incomplete, no changes`);
  }
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one pass over the sheet rows
const parseSheet = (sheet: Sheet, ctx: Ctx, defaultNs: string | undefined) => {
  const layout =
    findHeader(sheet.rows, ctx) ??
    guessLayout(
      sheet.rows.filter((r) => r.some((c) => c.trim())),
      ctx
    );
  const seen = new Map<string, string>();
  for (const [i, row] of sheet.rows.entries()) {
    if (i < layout.first || row.every((c) => c.trim() === "")) {
      continue;
    }
    const cell = (c: number | undefined) =>
      c === undefined ? "" : clean(row[c] ?? "");
    const where = `${sheet.name ? `${sheet.name}:` : ""}${i + 1}`;
    const texts = Object.fromEntries(
      Object.entries(layout.locales).map(([l, c]) => [l, cell(c)])
    );
    const values = Object.fromEntries(
      ctx.locales.filter((l) => texts[l]).map((l) => [l, texts[l]])
    );
    const data = { key: cell(layout.roles.key), texts };
    const comment = cell(layout.roles.comment);
    if (Object.keys(values).length === 0) {
      ctx.proposal.skipped.push(`${where}: no translation`);
      continue;
    }
    const [matchedBy, found] = lookup(
      data,
      cell(layout.roles.ns) || defaultNs,
      ctx
    );
    const info = {
      key: data.key,
      source: texts[ctx.config.sourceLocale],
      values,
      comment,
    };
    if (found.length > 1) {
      ctx.proposal.ambiguous.push(
        pending(where, "ambiguous match", info, found)
      );
    } else if (found.length === 0) {
      ctx.proposal.unmatched.push(pending(where, "no match", info, []));
    } else if (
      seen.has(found[0]) &&
      seen.get(found[0]) !== JSON.stringify(values)
    ) {
      ctx.proposal.unmatched.push(
        pending(where, `duplicate of ${found[0]}`, info, [found[0]])
      );
    } else if (!seen.has(found[0])) {
      seen.set(found[0], JSON.stringify(values));
      place(ctx, { id: found[0], where, matchedBy, comment }, texts);
    }
  }
};

/** Parse the sheet the reviewer returned into proposal.json and refresh the report with it laid over. Never touches the messages. */
export const importFile = async (
  config: Config,
  file: string,
  opts: { lang?: string; out?: string; text?: string }
) => {
  const catalog = loadCatalog(config);
  if (opts.lang) {
    assertLang(config, catalog, opts.lang);
  }
  const sheets = (
    opts.text === undefined
      ? await readTable(file)
      : parseText(opts.text, extname(file))
  ).filter((s) => s.rows.length > 0);
  const proposal: Proposal = {
    version: 2,
    file,
    rows: [],
    confirmed: [],
    pending: [],
    ambiguous: [],
    unmatched: [],
    skipped: [],
  };
  const ctx: Ctx = {
    config,
    locales: catalog.locales,
    index: buildIndex(config, catalog),
    proposal,
    lang: opts.lang,
  };
  const errors: string[] = [];
  for (const sheet of sheets) {
    const defaultNs = catalog.namespaces.includes(sheet.name)
      ? sheet.name
      : undefined;
    try {
      parseSheet(sheet, ctx, defaultNs);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (errors.length > 0 && sheets.length === errors.length) {
    throw new Error(errors[0]);
  }
  const out = opts.out ?? join(config.reportDir, "proposal.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(proposal, null, 2)}\n`);
  const { file: reportFile } = report(config, { proposal: out });
  const changedCells = [...proposal.rows, ...proposal.pending].reduce(
    (n, r) => n + Object.keys(r.changes).length,
    0
  );
  return {
    proposal: out,
    report: reportFile,
    rows: proposal.rows.length,
    confirmed: proposal.confirmed.length,
    pending: proposal.pending.length,
    changedCells,
    ambiguous: proposal.ambiguous.length,
    unmatched: proposal.unmatched.length,
    skipped: proposal.skipped.length,
    warnings: errors,
  };
};

type Plan = {
  id: string;
  values: Record<string, string>;
  state: "approved" | "in-review";
};

const planOf = (
  proposal: Proposal,
  locales: string[]
): { plans: Plan[]; rejected: number; unresolved: number } => {
  const plans: Plan[] = [];
  const fromRow = (r: ProposalRow, state: Plan["state"]) =>
    plans.push({
      id: r.id,
      values: Object.fromEntries(
        Object.entries(r.changes).map(([l, c]) => [l, c.new])
      ),
      state,
    });
  for (const r of proposal.rows.filter((x) => !x.reject)) {
    fromRow(r, "approved");
  }
  for (const r of proposal.confirmed.filter((x) => !x.reject)) {
    fromRow(r, "approved");
  }
  for (const r of proposal.pending.filter((x) => !x.reject)) {
    fromRow(r, "in-review");
  }
  const entries = [...proposal.ambiguous, ...proposal.unmatched];
  for (const e of entries) {
    for (const id of e.resolve ? [e.resolve].flat() : []) {
      const complete = locales.every((l) => e.values[l]);
      plans.push({
        id,
        values: e.values,
        state: complete ? "approved" : "in-review",
      });
    }
  }
  return {
    plans,
    rejected: [
      ...proposal.rows,
      ...proposal.confirmed,
      ...proposal.pending,
    ].filter((x) => x.reject).length,
    unresolved: entries.filter((e) => !e.resolve).length,
  };
};

/** Write accepted rows to the messages; complete rows become approved, partial ones stay in-review. */
export const apply = (config: Config, file: string) => {
  const proposal: Proposal = JSON.parse(readFileSync(file, "utf8"));
  const catalog = loadCatalog(config);
  const { plans, rejected, unresolved } = planOf(proposal, catalog.locales);
  const byId = new Map(getRows(config, catalog).map((r) => [r.address, r]));
  const unknown = plans.filter((p) => !byId.has(p.id)).map((p) => p.id);
  const badLocales = plans
    .flatMap((p) => Object.keys(p.values))
    .filter((l) => !catalog.locales.includes(l));
  if (unknown.length > 0 || badLocales.length > 0) {
    throw new Error(
      `Invalid proposal: unknown key(s) [${unknown}] / locale(s) [${badLocales}]`
    );
  }
  const writes = new Map<string, Map<string, string>>();
  const updated = new Map<string, Row>();
  for (const plan of plans) {
    const row = updated.get(plan.id) ?? (byId.get(plan.id) as Row);
    for (const [lang, text] of Object.entries(plan.values)) {
      const id = `${lang}\t${row.ns}`;
      const values =
        writes.get(id) ?? new Map(catalog.messages[lang][row.ns] ?? []);
      values.set(row.key, text);
      writes.set(id, values);
    }
    updated.set(plan.id, { ...row, values: { ...row.values, ...plan.values } });
  }
  let cells = 0;
  for (const [id, values] of writes) {
    const [lang, ns] = id.split("\t");
    saveMessages(config, catalog, { lang, ns }, values);
    cells += 1;
  }
  for (const state of ["approved", "in-review"] as const) {
    const ids = plans.filter((p) => p.state === state).map((p) => p.id);
    markRows(
      config,
      catalog,
      ids.map((i) => updated.get(i) as Row),
      state
    );
  }
  return {
    approved: new Set(
      plans.filter((p) => p.state === "approved").map((p) => p.id)
    ).size,
    inReview: new Set(
      plans.filter((p) => p.state === "in-review").map((p) => p.id)
    ).size,
    filesWritten: cells,
    rejected,
    unresolved,
  };
};
