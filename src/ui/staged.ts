import type { ModelRow, SaveConflict, SavePayload } from "../model";

/** Prisma-Studio style staging: nothing is written until the whole batch is saved. */
export type StagedCell = {
  id: string;
  lang: string;
  /** The value the client saw (becomes `expectedOld`). */
  original: string;
  current: string;
  /** Set after a 409: what is on disk now. */
  conflict?: string;
};

export type StagedStatus = {
  id: string;
  /** The stored state to set. */
  state: string;
  /** The derived state the client saw (becomes `expectedState`). */
  expectedState: string;
  conflict?: string;
};

export type Staged = {
  cells: Record<string, StagedCell>;
  statuses: Record<string, StagedStatus>;
};

export type StagedAction =
  | { type: "edit"; id: string; lang: string; original: string; value: string }
  | { type: "status"; id: string; state: string; expectedState: string }
  | { type: "discard" }
  | { type: "conflicts"; conflicts: SaveConflict[] }
  | { type: "keepMine"; key: string }
  | { type: "useTheirs"; key: string };

export const emptyStaged: Staged = { cells: {}, statuses: {} };

export const cellKey = (id: string, lang: string) => `${id}\t${lang}`;
export const rowId = (row: Pick<ModelRow, "group" | "key">) =>
  `${row.group}.${row.key}`;

export const countStaged = (s: Staged) =>
  Object.keys(s.cells).length + Object.keys(s.statuses).length;

export const hasConflicts = (s: Staged) =>
  Object.values(s.cells).some((c) => c.conflict !== undefined) ||
  Object.values(s.statuses).some((c) => c.conflict !== undefined);

const without = <T>(record: Record<string, T>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

const editCell = (
  s: Staged,
  a: Extract<StagedAction, { type: "edit" }>
): Staged => {
  const key = cellKey(a.id, a.lang);
  const existing = s.cells[key];
  const original = existing?.original ?? a.original;
  // Typing the original value back removes the entry, so the count stays truthful.
  if (a.value === original) {
    return { ...s, cells: without(s.cells, key) };
  }
  const cell: StagedCell = {
    id: a.id,
    lang: a.lang,
    original,
    current: a.value,
    ...(existing?.conflict !== undefined && { conflict: existing.conflict }),
  };
  return { ...s, cells: { ...s.cells, [key]: cell } };
};

const stageStatus = (
  s: Staged,
  a: Extract<StagedAction, { type: "status" }>
): Staged => {
  const existing = s.statuses[a.id];
  const expectedState = existing?.expectedState ?? a.expectedState;
  if (a.state === expectedState) {
    return { ...s, statuses: without(s.statuses, a.id) };
  }
  const entry: StagedStatus = {
    id: a.id,
    state: a.state,
    expectedState,
    ...(existing?.conflict !== undefined && { conflict: existing.conflict }),
  };
  return { ...s, statuses: { ...s.statuses, [a.id]: entry } };
};

const markConflicts = (s: Staged, conflicts: SaveConflict[]): Staged => {
  const next: Staged = { cells: { ...s.cells }, statuses: { ...s.statuses } };
  for (const c of conflicts) {
    if (c.kind === "value" && c.lang !== undefined) {
      const key = cellKey(c.id, c.lang);
      if (next.cells[key]) {
        next.cells[key] = { ...next.cells[key], conflict: c.current };
      }
    } else if (c.kind === "state" && next.statuses[c.id]) {
      next.statuses[c.id] = { ...next.statuses[c.id], conflict: c.current };
    }
  }
  return next;
};

/** Keep my change, but compare it with what is on disk now (re-bases the expectation). */
const keepMine = (s: Staged, key: string): Staged => {
  const cell = s.cells[key];
  if (cell?.conflict !== undefined) {
    return editCell(
      {
        ...s,
        cells: {
          ...s.cells,
          [key]: { ...cell, original: cell.conflict, conflict: undefined },
        },
      },
      {
        type: "edit",
        id: cell.id,
        lang: cell.lang,
        original: cell.conflict,
        value: cell.current,
      }
    );
  }
  const status = s.statuses[key];
  if (status?.conflict !== undefined) {
    return stageStatus(
      {
        ...s,
        statuses: {
          ...s.statuses,
          [key]: {
            ...status,
            expectedState: status.conflict,
            conflict: undefined,
          },
        },
      },
      {
        type: "status",
        id: status.id,
        state: status.state,
        expectedState: status.conflict,
      }
    );
  }
  return s;
};

export const stagedReducer = (s: Staged, a: StagedAction): Staged => {
  switch (a.type) {
    case "edit":
      return editCell(s, a);
    case "status":
      return stageStatus(s, a);
    case "discard":
      return emptyStaged;
    case "conflicts":
      return markConflicts(s, a.conflicts);
    case "keepMine":
      return keepMine(s, a.key);
    case "useTheirs":
      return {
        cells: without(s.cells, a.key),
        statuses: without(s.statuses, a.key),
      };
    default:
      return s;
  }
};

/** The one batch sent to `POST /api/save`. */
export const toPayload = (s: Staged): SavePayload => ({
  edits: Object.values(s.cells).map((c) => ({
    id: c.id,
    lang: c.lang,
    expectedOld: c.original,
    new: c.current,
  })),
  statuses: Object.values(s.statuses).map((c) => ({
    id: c.id,
    state: c.state,
    expectedState: c.expectedState,
  })),
});

/**
 * Rows of other languages that will become stale when the source locale is edited:
 * rows with a staged source edit that already have a non-empty value in another language.
 */
export const staleRowCount = (
  rows: ModelRow[],
  s: Staged,
  sourceLocale: string,
  columns: string[]
): number => {
  const sourceEdited = new Set(
    Object.values(s.cells)
      .filter((c) => c.lang === sourceLocale)
      .map((c) => c.id)
  );
  return rows.filter(
    (r) =>
      sourceEdited.has(rowId(r)) &&
      columns.some(
        (lang, i) =>
          lang !== sourceLocale &&
          (s.cells[cellKey(rowId(r), lang)]?.current ??
            r.cells[i]?.text ??
            "") !== ""
      )
  ).length;
};

export const hasSourceEdits = (s: Staged, sourceLocale: string) =>
  Object.values(s.cells).some((c) => c.lang === sourceLocale);

/** One line of the "what will be written" list. */
export type StagedEntry = {
  kind: "cell" | "status";
  /** Key in `Staged.cells` / `Staged.statuses`. */
  key: string;
  id: string;
  lang?: string;
  from: string;
  to: string;
};

export const listStaged = (s: Staged): StagedEntry[] =>
  [
    ...Object.entries(s.cells).map(
      ([key, c]): StagedEntry => ({
        kind: "cell",
        key,
        id: c.id,
        lang: c.lang,
        from: c.original,
        to: c.current,
      })
    ),
    ...Object.entries(s.statuses).map(
      ([key, c]): StagedEntry => ({
        kind: "status",
        key,
        id: c.id,
        from: c.expectedState,
        to: c.state,
      })
    ),
  ].sort(
    (a, b) =>
      a.id.localeCompare(b.id) ||
      a.kind.localeCompare(b.kind) ||
      (a.lang ?? "").localeCompare(b.lang ?? "")
  );

const WHITESPACE = /\s+/g;

/** One-line preview of a long or multi-line value. */
export const truncate = (text: string, max = 48): string => {
  const flat = text.replace(WHITESPACE, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(1, max - 1))}…`;
};
