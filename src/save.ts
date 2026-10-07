import { loadCatalog, messagesFile } from "./catalog.js";
import { buildModel, pruneWrites } from "./commands.js";
import type { Config } from "./config.js";
import { atomicWriteAll, type FsHooks } from "./fsx.js";
import type {
  SaveConflict,
  SaveEdit,
  SavePayload,
  SavePrune,
  SaveResult,
  SaveStatusChange,
} from "./model.js";
import {
  getRows,
  localesOf,
  type Row,
  recordFiles,
  storedStates,
} from "./status.js";

const MAX_ITEMS = 1000;
const MAX_ID = 512;
const MAX_LANG = 64;
const MAX_TEXT = 100_000;

/** A request the caller must fix (400) or a stale one (409). Messages never echo input. */
export class SaveError extends Error {
  readonly status: 400 | 409;
  readonly conflicts?: SaveConflict[];
  constructor(status: 400 | 409, message: string, conflicts?: SaveConflict[]) {
    super(message);
    this.status = status;
    this.conflicts = conflicts;
  }
}

const bad = (message: string) => new SaveError(400, message);

const checkObject = (
  value: unknown,
  where: string,
  limits: Record<string, number>
): Record<string, string> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw bad(`${where} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((k) => !Object.hasOwn(limits, k))) {
    throw bad(`${where} has an unknown key`);
  }
  for (const [key, max] of Object.entries(limits)) {
    const v = record[key];
    if (typeof v !== "string") {
      throw bad(`${where}.${key} must be a string`);
    }
    if (v.length > max) {
      throw bad(`${where}.${key} is too long`);
    }
  }
  return record as Record<string, string>;
};

const checkList = <T>(
  value: unknown,
  where: string,
  limits: Record<string, number>
): T[] => {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_ITEMS) {
    throw bad(`${where} must be an array of at most ${MAX_ITEMS} items`);
  }
  return value.map((v, i) => checkObject(v, `${where}[${i}]`, limits) as T);
};

/** Strict schema: only `edits`, `statuses` and `prune`, only the documented string fields. */
export const parsePayload = (raw: unknown): SavePayload => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw bad("body must be a JSON object");
  }
  const body = raw as Record<string, unknown>;
  if (
    Object.keys(body).some(
      (k) => k !== "edits" && k !== "statuses" && k !== "prune"
    )
  ) {
    throw bad("body has an unknown key");
  }
  const edits = checkList<SaveEdit>(body.edits, "edits", {
    id: MAX_ID,
    lang: MAX_LANG,
    expectedOld: MAX_TEXT,
    new: MAX_TEXT,
  });
  const statuses = checkList<SaveStatusChange>(body.statuses, "statuses", {
    id: MAX_ID,
    state: MAX_LANG,
    expectedState: MAX_LANG,
  });
  const prune = checkList<SavePrune>(body.prune, "prune", { id: MAX_ID });
  if (edits.length + statuses.length + prune.length === 0) {
    throw bad("nothing to save");
  }
  if (prune.length > 0 && edits.length + statuses.length > 0) {
    throw bad("prune cannot be combined with edits or statuses");
  }
  return { edits, statuses, prune };
};

type RowMap = Map<string, Row>;

const validatePrune = (prune: SavePrune[], rows: RowMap) => {
  const ids = new Set<string>();
  for (const [i, p] of prune.entries()) {
    if (!rows.has(p.id)) {
      throw bad(`prune[${i}]: unknown id`);
    }
    if (ids.has(p.id)) {
      throw bad(`prune[${i}]: duplicate id in one batch`);
    }
    ids.add(p.id);
  }
};

/** Everything that can be checked without comparing with disk; throws 400 (no input echoed). */
const validate = (
  payload: SavePayload,
  rows: RowMap,
  locales: string[],
  storable: string[]
) => {
  const seen = new Set<string>();
  for (const [i, e] of payload.edits.entries()) {
    if (!rows.has(e.id)) {
      throw bad(`edits[${i}]: unknown id`);
    }
    if (!locales.includes(e.lang)) {
      throw bad(`edits[${i}]: unknown language`);
    }
    const key = `${e.id}\t${e.lang}`;
    if (seen.has(key)) {
      throw bad(`edits[${i}]: duplicate id and language in one batch`);
    }
    seen.add(key);
  }
  const statusIds = new Set<string>();
  for (const [i, s] of payload.statuses.entries()) {
    if (!rows.has(s.id)) {
      throw bad(`statuses[${i}]: unknown id`);
    }
    if (!storable.includes(s.state)) {
      throw bad(`statuses[${i}]: state must be one of the storable states`);
    }
    if (statusIds.has(s.id)) {
      throw bad(`statuses[${i}]: duplicate id in one batch`);
    }
    statusIds.add(s.id);
  }
  validatePrune(payload.prune ?? [], rows);
};

/** Optimistic concurrency: what the client saw must still be what is on disk. */
const findConflicts = (payload: SavePayload, rows: RowMap): SaveConflict[] => [
  ...payload.edits
    .filter((e) => (rows.get(e.id)?.values[e.lang] ?? "") !== e.expectedOld)
    .map(
      (e): SaveConflict => ({
        id: e.id,
        lang: e.lang,
        kind: "value",
        current: rows.get(e.id)?.values[e.lang] ?? "",
      })
    ),
  ...payload.statuses
    .filter((s) => rows.get(s.id)?.state !== s.expectedState)
    .map(
      (s): SaveConflict => ({
        id: s.id,
        kind: "state",
        current: rows.get(s.id)?.state ?? "",
      })
    ),
  // Only rows still archived on disk may be deleted.
  ...(payload.prune ?? [])
    .filter((p) => rows.get(p.id)?.state !== "archived")
    .map(
      (p): SaveConflict => ({
        id: p.id,
        kind: "state",
        current: rows.get(p.id)?.state ?? "",
      })
    ),
];

/** Delete archived rows (already checked against disk) from every language and status file. */
const deleteRows = ({
  config,
  catalog,
  prune,
  rows,
  hooks,
}: {
  config: Config;
  catalog: ReturnType<typeof loadCatalog>;
  prune: SavePrune[];
  rows: RowMap;
  hooks?: FsHooks;
}): SaveResult => {
  const doomed = prune.flatMap((p) => {
    const row = rows.get(p.id);
    return row ? [row] : [];
  });
  let files: ReturnType<typeof pruneWrites>;
  try {
    files = pruneWrites(config, catalog, doomed);
  } catch {
    throw bad("deleting these rows would leave a gap in an array");
  }
  atomicWriteAll(files, hooks);
  return {
    ok: true,
    written: { files: files.length, cells: 0, deleted: doomed.length },
    staleRows: 0,
    warnings: [],
    model: buildModel(config),
  };
};

/**
 * Apply edits and status changes as one batch, all or nothing: everything is validated
 * and compared with what is on disk first, and nothing is written on any failure.
 * Files are written through `atomicWriteAll` (temp + rename; best effort across files).
 */
export const saveBatch = (
  config: Config,
  raw: unknown,
  hooks?: FsHooks
): SaveResult => {
  const payload = parsePayload(raw);
  const catalog = loadCatalog(config);
  const rows = new Map(getRows(config, catalog).map((r) => [r.address, r]));

  validate(payload, rows, localesOf(config, catalog), storedStates(config));
  const conflicts = findConflicts(payload, rows);
  if (conflicts.length > 0) {
    throw new SaveError(409, "conflict", conflicts);
  }

  if (payload.prune?.length) {
    return deleteRows({ config, catalog, prune: payload.prune, rows, hooks });
  }

  // Edits, grouped per locale file. Unchanged cells are not written.
  const byFile = new Map<string, Map<string, string>>();
  const dirty = new Set<string>();
  const updated = new Map<string, Record<string, string>>();
  let cells = 0;
  for (const e of payload.edits) {
    const row = rows.get(e.id);
    if (!row) {
      continue;
    }
    updated.set(e.id, {
      ...(updated.get(e.id) ?? row.values),
      [e.lang]: e.new,
    });
    if (e.new === row.values[e.lang]) {
      continue;
    }
    const file = `${e.lang}\t${row.ns}`;
    const values =
      byFile.get(file) ?? new Map(catalog.messages[e.lang][row.ns] ?? []);
    values.set(row.key, e.new);
    byFile.set(file, values);
    dirty.add(file);
    cells += 1;
  }
  const messageFiles = [...dirty].map((file) => {
    const [lang, ns] = file.split("\t");
    return messagesFile(
      config,
      catalog,
      { lang, ns },
      byFile.get(file) as Map<string, string>
    );
  });
  // Status hashes come from the values AFTER the edits, so approving re-baselines.
  const statusFiles = recordFiles(
    config,
    catalog,
    payload.statuses.map((s) => {
      const row = rows.get(s.id);
      return {
        row: {
          ns: row?.ns ?? "",
          key: row?.key ?? "",
          values: updated.get(s.id) ?? row?.values ?? {},
        },
        state: s.state,
      };
    })
  );
  atomicWriteAll([...messageFiles, ...statusFiles], hooks);

  const after = new Map(
    getRows(config, loadCatalog(config)).map((r) => [r.address, r])
  );
  const sourceEdited = new Set(
    payload.edits.filter((e) => e.lang === config.sourceLocale).map((e) => e.id)
  );
  return {
    ok: true,
    written: { files: messageFiles.length + statusFiles.length, cells },
    staleRows: [...sourceEdited].filter(
      (id) => after.get(id)?.state === "stale"
    ).length,
    warnings: payload.edits
      .filter((e) => e.new === "")
      .map((e) => `${e.id} (${e.lang}): empty value`),
    model: buildModel(config),
  };
};
