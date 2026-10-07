import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/catalog.js";
import { approve, init, mark, set } from "../src/commands.js";
import { atomicWriteAll } from "../src/fsx.js";
import { apply, importFile } from "../src/proposal.js";
import { SaveError, saveBatch } from "../src/save.js";
import { getRows } from "../src/status.js";
import {
  copyFixture,
  readJson,
  readText,
  syntheticConfig,
  tempDir,
} from "./helpers.js";
import { snapshot, tmpFiles } from "./snapshot.js";

const FAQ = {
  id: "navigation.link.faq",
  lang: "ko",
  expectedOld: "자주 묻는 질문",
  new: "자주 묻는 질문 (FAQ)",
};
const HOME = {
  id: "navigation.link.home",
  lang: "es",
  expectedOld: "Inicio",
  new: "Casa",
};
const baselined = (overrides = {}) => {
  const cfg = copyFixture(["en", "ko", "es"], overrides);
  init(cfg, { force: false });
  return cfg;
};
const stateOf = (cfg: ReturnType<typeof baselined>, id: string) =>
  getRows(cfg, loadCatalog(cfg)).find((r) => r.address === id);

const failure = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as SaveError;
  }
  throw new Error("expected a failure");
};

describe("saveBatch: all or nothing", () => {
  it("rejects invalid payloads with 400 and writes nothing", () => {
    const cfg = baselined();
    const before = snapshot(cfg);
    const state = { id: FAQ.id, state: "approved", expectedState: "approved" };
    const bad: [string, unknown][] = [
      ["not an object", []],
      ["not an object", "x"],
      ["unknown top-level key", { edits: [FAQ], extra: 1 }],
      ["nothing to save", { edits: [], statuses: [] }],
      ["nothing to save", {}],
      ["edits not an array", { edits: "x" }],
      ["edit with extra key", { edits: [{ ...FAQ, path: "/etc/passwd" }] }],
      ["edit with number", { edits: [{ ...FAQ, new: 5 }] }],
      ["edit missing field", { edits: [{ id: FAQ.id, lang: "ko", new: "x" }] }],
      ["unknown id", { edits: [{ ...FAQ, id: "navigation.nope" }] }],
      [
        "unknown id (traversal)",
        { edits: [{ ...FAQ, id: "../../etc.passwd" }] },
      ],
      ["unknown lang", { edits: [{ ...FAQ, lang: "fr" }] }],
      ["unknown lang (path)", { edits: [{ ...FAQ, lang: "../ko" }] }],
      ["duplicate edit", { edits: [FAQ, { ...FAQ, new: "other" }] }],
      ["too long", { edits: [{ ...FAQ, new: "x".repeat(100_001) }] }],
      ["status unknown id", { statuses: [{ ...state, id: "x.y" }] }],
      ["status unknown state", { statuses: [{ ...state, state: "nope" }] }],
      ["status duplicate", { statuses: [state, state] }],
      ["status extra key", { statuses: [{ ...state, extra: "1" }] }],
      ...["missing", "stale", "edited", "new"].map((s): [string, unknown] => [
        `derived state ${s}`,
        { statuses: [{ ...state, state: s }] },
      ]),
    ];
    for (const [name, payload] of bad) {
      const error = failure(() => saveBatch(cfg, payload));
      expect(error, name).toBeInstanceOf(SaveError);
      expect(error.status, name).toBe(400);
      expect(snapshot(cfg), name).toBe(before);
    }
    expect(tmpFiles(cfg)).toEqual([]);
  });

  it("does not echo input back in error messages", () => {
    const cfg = baselined();
    const error = failure(() =>
      saveBatch(cfg, {
        edits: [{ ...FAQ, id: "SECRET-MARKER", lang: "SECRET-LANG" }],
      })
    );
    expect(error.message).not.toContain("SECRET");
  });

  it("is atomic across a batch: one invalid item blocks the valid ones", () => {
    const cfg = baselined();
    const before = snapshot(cfg);
    const error = failure(() =>
      saveBatch(cfg, { edits: [FAQ, { ...HOME, lang: "xx" }] })
    );
    expect(error.status).toBe(400);
    expect(snapshot(cfg)).toBe(before);
  });

  it("answers 409 with conflicts on a stale value and writes nothing", () => {
    const cfg = baselined();
    const before = snapshot(cfg);
    const error = failure(() =>
      saveBatch(cfg, { edits: [FAQ, { ...HOME, expectedOld: "stale" }] })
    );
    expect(error.status).toBe(409);
    expect(error.conflicts).toEqual([
      { id: HOME.id, lang: "es", kind: "value", current: "Inicio" },
    ]);
    expect(snapshot(cfg)).toBe(before);
    expect(tmpFiles(cfg)).toEqual([]);
  });

  it("answers 409 on a stale state, and for value and state together", () => {
    const cfg = baselined();
    const before = snapshot(cfg);
    const error = failure(() =>
      saveBatch(cfg, {
        edits: [{ ...FAQ, expectedOld: "old" }],
        statuses: [
          { id: HOME.id, state: "in-review", expectedState: "edited" },
        ],
      })
    );
    expect(error.status).toBe(409);
    expect(error.conflicts).toEqual([
      { id: FAQ.id, lang: "ko", kind: "value", current: "자주 묻는 질문" },
      { id: HOME.id, kind: "state", current: "approved" },
    ]);
    expect(snapshot(cfg)).toBe(before);
  });

  it("detects edits made on disk after the client loaded the page", () => {
    const cfg = baselined();
    set(cfg, "ko", FAQ.id, "someone else");
    expect(failure(() => saveBatch(cfg, { edits: [FAQ] })).status).toBe(409);
  });
});

describe("saveBatch: applying", () => {
  it("writes an edit and leaves the row edited", () => {
    const cfg = baselined();
    const result = saveBatch(cfg, { edits: [FAQ] });
    expect(result).toMatchObject({
      ok: true,
      written: { files: 1, cells: 1 },
      staleRows: 0,
      warnings: [],
    });
    expect(readJson(cfg, "ko", "navigation").link.faq).toBe(FAQ.new);
    expect(stateOf(cfg, FAQ.id)).toMatchObject({
      state: "edited",
      changedLocales: ["ko"],
    });
    expect(result.model.rows.find((r) => r.key === "link.faq")?.status).toBe(
      "edited"
    );
    expect(tmpFiles(cfg)).toEqual([]);
  });

  it("re-baselines when the edit and the approval are in one batch", () => {
    const cfg = baselined();
    const result = saveBatch(cfg, {
      edits: [FAQ, HOME],
      statuses: [{ id: FAQ.id, state: "approved", expectedState: "approved" }],
    });
    expect(result.written).toEqual({ files: 3, cells: 2 }); // ko + es messages, one status file
    expect(stateOf(cfg, FAQ.id)).toMatchObject({
      state: "approved",
      changedLocales: [],
    });
    expect(stateOf(cfg, HOME.id)?.state).toBe("edited");
  });

  it("supports custom states and status-only batches", () => {
    const cfg = baselined({ customStates: ["legal-ok"] });
    const result = saveBatch(cfg, {
      statuses: [{ id: FAQ.id, state: "legal-ok", expectedState: "approved" }],
    });
    expect(result.written).toEqual({ files: 1, cells: 0 });
    expect(stateOf(cfg, FAQ.id)?.state).toBe("legal-ok");
    expect(readText(cfg, "ko", "navigation")).toBe(
      readText(copyFixture(), "ko", "navigation")
    );
  });

  it("editing the source locale reports the rows that became stale", () => {
    const cfg = baselined();
    const result = saveBatch(cfg, {
      edits: [
        { id: FAQ.id, lang: "en", expectedOld: "FAQ", new: "Frequently asked" },
        { id: HOME.id, lang: "en", expectedOld: "Home", new: "Home page" },
      ],
    });
    expect(result.staleRows).toBe(2);
    expect(stateOf(cfg, FAQ.id)?.state).toBe("stale");
  });

  it("warns on empty values but allows them", () => {
    const cfg = baselined();
    const result = saveBatch(cfg, { edits: [{ ...FAQ, new: "" }] });
    expect(result.warnings).toEqual([`${FAQ.id} (ko): empty value`]);
    expect(stateOf(cfg, FAQ.id)?.state).toBe("missing");
  });

  it("does not rewrite files for unchanged cells", () => {
    const cfg = baselined();
    const before = snapshot(cfg);
    const result = saveBatch(cfg, {
      edits: [{ ...FAQ, new: FAQ.expectedOld }],
    });
    expect(result.written).toEqual({ files: 0, cells: 0 });
    expect(snapshot(cfg)).toBe(before);
  });

  it("follows ignoreKeys: ignored empty rows can still be edited", () => {
    const cfg = baselined({ ignoreKeys: ["*.meta.*"] });
    const result = saveBatch(cfg, {
      edits: [
        {
          id: "plan-page.meta.title",
          lang: "ko",
          expectedOld: "",
          new: "플랜",
        },
      ],
    });
    expect(result.written.cells).toBe(1);
    expect(readJson(cfg, "ko", "plan-page").meta.title).toBe("플랜");
  });

  it("preserves key order, indent and trailing newline", () => {
    const cfg = syntheticConfig();
    for (const lang of ["en", "ko", "es"]) {
      for (const ns of ["a", "b"]) {
        const file = join(cfg.i18nDir, lang, `${ns}.json`);
        writeFileSync(
          file,
          `${JSON.stringify(JSON.parse(readFileSync(file, "utf8")), null, 4)}\n`
        );
      }
    }
    const before = JSON.parse(readText(cfg, "ko", "a"));
    saveBatch(cfg, {
      edits: [{ id: "a.same1", lang: "ko", expectedOld: "같은", new: "변경" }],
    });
    const text = readText(cfg, "ko", "a");
    expect(text).toBe(
      `${JSON.stringify({ ...before, same1: "변경" }, null, 4)}\n`
    );
    expect(Object.keys(JSON.parse(text))).toEqual(Object.keys(before));
  });

  it("leaves the originals intact when a write fails mid-batch", () => {
    const cfg = baselined();
    const before = snapshot(cfg);
    let calls = 0;
    const hooks = {
      rename: () => {
        calls += 1;
        throw new Error("disk full");
      },
    };
    expect(() =>
      saveBatch(
        cfg,
        {
          edits: [FAQ, HOME],
          statuses: [
            { id: FAQ.id, state: "approved", expectedState: "approved" },
          ],
        },
        hooks
      )
    ).toThrow("disk full");
    expect(calls).toBe(1);
    expect(snapshot(cfg)).toBe(before);
    expect(tmpFiles(cfg)).toEqual([]);
  });

  it("restores files already renamed when a later rename fails", async () => {
    const { renameSync } = await import("node:fs");
    const cfg = baselined();
    const before = snapshot(cfg);
    let calls = 0;
    const hooks = {
      rename: (from: string, to: string) => {
        calls += 1;
        if (calls === 3) {
          throw new Error("boom");
        }
        renameSync(from, to);
      },
    };
    expect(() =>
      saveBatch(
        cfg,
        {
          edits: [FAQ, HOME],
          statuses: [
            { id: FAQ.id, state: "approved", expectedState: "approved" },
          ],
        },
        hooks
      )
    ).toThrow("boom");
    expect(snapshot(cfg)).toBe(before);
    expect(tmpFiles(cfg)).toEqual([]);
  });
});

describe("one atomic write path", () => {
  it("atomicWriteAll creates directories and leaves no temp files", () => {
    const dir = join(tempDir(), "a", "b");
    atomicWriteAll([
      { path: join(dir, "one.txt"), content: "1" },
      { path: join(dir, "two.txt"), content: "2" },
    ]);
    expect(readFileSync(join(dir, "one.txt"), "utf8")).toBe("1");
    atomicWriteAll([{ path: join(dir, "one.txt"), content: "changed" }]);
    expect(readFileSync(join(dir, "one.txt"), "utf8")).toBe("changed");
    expect(
      tmpFiles({ i18nDir: dir, statusDir: dir, reportDir: dir } as never)
    ).toEqual([]);
  });

  it("set, mark, approve, init, export and apply leave no temp files", async () => {
    const cfg = baselined();
    set(cfg, "ko", FAQ.id, "x");
    approve(cfg, { keys: [FAQ.id] }, { allEdited: false });
    mark(cfg, "in-review", { keys: [HOME.id] });
    init(cfg, { force: true });
    const file = join(cfg.reportDir, "p.tsv");
    const { exportRows } = await import("../src/commands.js");
    await exportRows(cfg, { all: true, format: "tsv", out: file });
    const imp = await importFile(cfg, file, {});
    apply(cfg, imp.proposal);
    expect(tmpFiles(cfg)).toEqual([]);
  });
});

describe("saveBatch: prune", () => {
  it("deletes an archived row from every language and its status record", () => {
    const cfg = baselined();
    mark(cfg, "archived", { keys: [FAQ.id] });
    const result = saveBatch(cfg, { prune: [{ id: FAQ.id }] });
    expect(result.written.deleted).toBe(1);
    expect(stateOf(cfg, FAQ.id)).toBeUndefined();
    for (const lang of ["en", "ko", "es"]) {
      expect(readText(cfg, lang, "navigation")).not.toContain('"faq"');
    }
    expect(
      result.model.rows.some((r) => `${r.group}.${r.key}` === FAQ.id)
    ).toBe(false);
  });

  it("answers 409 for a row that is not archived on disk and deletes nothing", () => {
    const cfg = baselined();
    const before = snapshot(cfg);
    const e = failure(() => saveBatch(cfg, { prune: [{ id: FAQ.id }] }));
    expect(e.status).toBe(409);
    expect(e.conflicts).toEqual([
      { id: FAQ.id, kind: "state", current: "approved" },
    ]);
    expect(snapshot(cfg)).toEqual(before);
  });

  it("refuses prune mixed with edits, unknown ids and duplicates with 400", () => {
    const cfg = baselined();
    mark(cfg, "archived", { keys: [FAQ.id] });
    const before = snapshot(cfg);
    for (const body of [
      { edits: [HOME], prune: [{ id: FAQ.id }] },
      { prune: [{ id: "navigation.nope" }] },
      { prune: [{ id: FAQ.id }, { id: FAQ.id }] },
      { prune: [{ id: FAQ.id, extra: "x" }] },
    ]) {
      expect(failure(() => saveBatch(cfg, body)).status).toBe(400);
    }
    expect(snapshot(cfg)).toEqual(before);
  });
});
