import type { ModelRow } from "../model";
import { cellKey, emptyStaged, rowId, type Staged } from "./staged";

/** Unsaved work kept in the browser so a refresh or crash does not lose it. */
export const DRAFT_VERSION = 1;
export const MAX_DRAFT_BYTES = 1_000_000;

export type Draft = {
  version: number;
  projectId: string;
  savedAt: number;
  edits: { id: string; lang: string; original: string; current: string }[];
  statuses: { id: string; state: string; expectedState: string }[];
};

export const draftKey = (projectId: string) => `i18n-studio:draft:${projectId}`;

export type Serialized =
  | { ok: true; text: string }
  | { ok: false; reason: "empty" | "too-large" };

/** Only what is needed to rebuild the staged set; never a token or a path. */
export const serializeDraft = (
  staged: Staged,
  projectId: string,
  now: number,
  maxBytes = MAX_DRAFT_BYTES
): Serialized => {
  const edits = Object.values(staged.cells).map(
    ({ id, lang, original, current }) => ({ id, lang, original, current })
  );
  const statuses = Object.values(staged.statuses).map(
    ({ id, state, expectedState }) => ({ id, state, expectedState })
  );
  if (edits.length + statuses.length === 0) {
    return { ok: false, reason: "empty" };
  }
  const draft: Draft = {
    version: DRAFT_VERSION,
    projectId,
    savedAt: now,
    edits,
    statuses,
  };
  const text = JSON.stringify(draft);
  // Characters, not bytes: a conservative stand-in (UTF-16 storage is 2 bytes each).
  return text.length > maxBytes
    ? { ok: false, reason: "too-large" }
    : { ok: true, text };
};

const isString = (v: unknown): v is string => typeof v === "string";

/** A draft for this project, or null for anything else (corrupt, old version, other project). */
export const parseDraft = (
  text: string | null,
  projectId: string
): Draft | null => {
  if (!text) {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const d = data as Partial<Draft> | null;
  if (
    !d ||
    typeof d !== "object" ||
    d.version !== DRAFT_VERSION ||
    d.projectId !== projectId ||
    typeof d.savedAt !== "number" ||
    !Array.isArray(d.edits) ||
    !Array.isArray(d.statuses)
  ) {
    return null;
  }
  const edits = d.edits.filter(
    (e) => e && [e.id, e.lang, e.original, e.current].every((v) => isString(v))
  );
  const statuses = d.statuses.filter(
    (s) => s && [s.id, s.state, s.expectedState].every((v) => isString(v))
  );
  return { ...(d as Draft), edits, statuses };
};

export type Restored = {
  staged: Staged;
  savedAt: number;
  /** Changes put back (conflicting ones included). */
  restored: number;
  /** Of those, how many no longer match what is on disk. */
  conflicts: number;
  /** Changes for rows or languages that no longer exist. */
  dropped: number;
};

export const nothingRestored: Restored = {
  staged: emptyStaged,
  savedAt: 0,
  restored: 0,
  conflicts: 0,
  dropped: 0,
};

type Counts = { conflicts: number; dropped: number };

type Ctx = {
  rows: Map<string, ModelRow>;
  columns: string[];
  out: Staged;
  counts: Counts;
};

const restoreEdits = (draft: Draft, { rows, columns, out, counts }: Ctx) => {
  for (const e of draft.edits) {
    const row = rows.get(e.id);
    const col = columns.indexOf(e.lang);
    if (!row || col === -1) {
      counts.dropped += 1;
      continue;
    }
    const cell = row.cells[col];
    const baseline = cell?.old ?? cell?.text ?? "";
    if (e.current === baseline) {
      continue; // already what is on disk: nothing left to save
    }
    const stale = baseline !== e.original;
    counts.conflicts += stale ? 1 : 0;
    out.cells[cellKey(e.id, e.lang)] = {
      id: e.id,
      lang: e.lang,
      original: e.original,
      current: e.current,
      ...(stale && { conflict: baseline }),
    };
  }
};

const restoreStatuses = (draft: Draft, { rows, out, counts }: Ctx) => {
  for (const s of draft.statuses) {
    const row = rows.get(s.id);
    if (!row) {
      counts.dropped += 1;
      continue;
    }
    if (s.state === row.status) {
      continue;
    }
    const stale = row.status !== s.expectedState;
    counts.conflicts += stale ? 1 : 0;
    out.statuses[s.id] = {
      id: s.id,
      state: s.state,
      expectedState: s.expectedState,
      ...(stale && { conflict: row.status }),
    };
  }
};

/**
 * Put a draft back on top of the fresh model. An edit whose recorded original no longer
 * matches the baseline becomes a conflict (never silently dropped, never overwriting);
 * edits for rows or languages that are gone are dropped and counted.
 */
export const reconcile = (
  draft: Draft,
  rows: ModelRow[],
  columns: string[]
): Restored => {
  const byId = new Map(rows.map((r) => [rowId(r), r]));
  const staged: Staged = { cells: {}, statuses: {} };
  const counts: Counts = { conflicts: 0, dropped: 0 };
  const ctx: Ctx = { rows: byId, columns, out: staged, counts };
  restoreEdits(draft, ctx);
  restoreStatuses(draft, ctx);
  return {
    staged,
    savedAt: draft.savedAt,
    restored:
      Object.keys(staged.cells).length + Object.keys(staged.statuses).length,
    ...counts,
  };
};

/** Where drafts live; every call is guarded because storage may be blocked or full. */
export type DraftStorage = {
  read: (key: string) => string | null;
  /** false when the write failed (blocked, quota). */
  write: (key: string, text: string) => boolean;
  remove: (key: string) => void;
};

export const browserStorage = (): DraftStorage => ({
  read: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write: (key, text) => {
    try {
      localStorage.setItem(key, text);
      return true;
    } catch {
      return false;
    }
  },
  remove: (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // nothing to remove from
    }
  },
});

/** Load and reconcile the stored draft (null-safe). */
export const loadDraft = (
  storage: DraftStorage,
  projectId: string,
  rows: ModelRow[],
  columns: string[]
): Restored => {
  const draft = parseDraft(storage.read(draftKey(projectId)), projectId);
  return draft ? reconcile(draft, rows, columns) : nothingRestored;
};

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** "5 minutes ago" in the page language. */
export const relativeTime = (
  savedAt: number,
  now: number,
  locale: string
): string => {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const seconds = Math.round((savedAt - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return rtf.format(Math.round(seconds / size), unit);
    }
  }
  return rtf.format(0, "second");
};
