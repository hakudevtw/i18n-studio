import { appendFileSync, cpSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/catalog.js";
import {
  approve,
  check,
  draft,
  init,
  report,
  set,
  status,
} from "../src/commands.js";
import { flatten, serialize, unflatten } from "../src/flatten.js";
import { renderHtml } from "../src/html.js";
import {
  deriveState,
  getRows,
  hash,
  NO_RECORDS_HINT,
  readStatus,
  type StoredState,
} from "../src/status.js";
import { parseDelimited, serializeDelimited } from "../src/table.js";
import {
  copyFixture,
  FIXTURE_DIR,
  FIXTURE_MISSING,
  readJson,
  readText,
  syntheticConfig,
} from "./helpers.js";

describe("flatten / unflatten on the fixture files", () => {
  for (const lang of ["en", "ko"]) {
    it(`round-trips every ${lang} file byte for byte`, () => {
      const dir = join(FIXTURE_DIR, lang);
      const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const text = readFileSync(join(dir, file), "utf8");
        const flat = flatten(JSON.parse(text));
        expect(serialize(unflatten(flat), text.endsWith("\n"))).toBe(text);
      }
    });
  }

  it("uses dotted paths with numeric segments for arrays", () => {
    const flat = flatten({ faqs: [{ q: "a" }, { q: "b" }], _0: "x" });
    expect(flat).toEqual([
      ["faqs.0.q", "a"],
      ["faqs.1.q", "b"],
      ["_0", "x"],
    ]);
    expect(unflatten(flat)).toEqual({
      faqs: [{ q: "a" }, { q: "b" }],
      _0: "x",
    });
  });
});

describe("row state derivation", () => {
  const values = { en: "S", es: "E", ko: "K" };
  const record = (
    v: Record<string, string>,
    state: StoredState = "approved"
  ) => ({
    state,
    hashes: Object.fromEntries(Object.entries(v).map(([l, x]) => [l, hash(x)])),
  });
  const derive = (v: Record<string, string>, r = record(values)) =>
    deriveState("en", v, r);

  it("hashes are stable and short", () => {
    expect(hash("hello")).toBe("2cf24dba5f");
    expect(hash("hello")).not.toBe(hash("hello "));
  });

  it("derives each state and the changed locales", () => {
    expect(derive(values)).toEqual({ state: "approved", changedLocales: [] });
    expect(derive(values, record(values, "ai-draft")).state).toBe("ai-draft");
    expect(deriveState("en", values, undefined)).toEqual({
      state: "new",
      changedLocales: [],
    });
    expect(derive({ ...values, ko: "K2" })).toEqual({
      state: "edited",
      changedLocales: ["ko"],
    });
    expect(derive({ ...values, en: "S2" })).toEqual({
      state: "stale",
      changedLocales: ["en"],
    });
    expect(derive({ en: "S2", es: "E", ko: "K2" })).toEqual({
      state: "edited",
      changedLocales: ["en", "ko"],
    });
  });

  it("applies precedence missing > stale > edited/new > stored", () => {
    expect(derive({ ...values, ko: "" }).state).toBe("missing");
    expect(derive({ en: "S2", es: "E", ko: "" }).state).toBe("missing");
    expect(derive({ ...values, en: "" }).state).toBe("missing");
    expect(deriveState("en", { ...values, ko: "" }, undefined).state).toBe(
      "missing"
    );
    expect(
      derive({ ...values, en: "S2" }, record(values, "in-review")).state
    ).toBe("stale");
  });
});

describe("delimited text", () => {
  it("round-trips newlines, quotes, tabs and commas", () => {
    const rows = [
      ["a\nb", 'say "hi"', "x\ty", "1,2"],
      ["", "plain", "line1\r\nline2", '"'],
    ];
    for (const d of ["\t", ","]) {
      expect(parseDelimited(serializeDelimited(rows, d), d)).toEqual(rows);
    }
  });

  it("keeps stray quotes literal and strips a BOM", () => {
    expect(parseDelimited('﻿a\tHe said "x"\n', "\t")).toEqual([
      ["a", 'He said "x"'],
    ]);
  });
});

describe("html renderer", () => {
  const model = {
    title: "<b>T</b>",
    columns: ["en"],
    rows: [
      {
        group: "g",
        key: "k",
        status: "new",
        cells: [{ text: "</script><img src=x onerror=alert(1)>" }],
      },
    ],
  };

  it("escapes data and the title, and loads nothing from the network", () => {
    const html = renderHtml(model);
    expect(html).not.toContain("</script><img");
    expect(html).toContain("&lt;b&gt;T&lt;/b&gt;");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
    expect(html).toContain("color-scheme:light dark");
  });

  it("shows the banner text in the data", () => {
    expect(renderHtml({ ...model, banner: "Hello banner" })).toContain(
      "Hello banner"
    );
  });
});

describe("status layer (temp data)", () => {
  it("init writes one file per namespace, per row, and refuses to overwrite", () => {
    const cfg = copyFixture();
    const catalog = loadCatalog(cfg);
    const rows = getRows(cfg, catalog);
    const missing = rows.filter((r) => r.state === "missing").length;
    expect(missing).toBe(FIXTURE_MISSING);
    const { approved } = init(cfg, { force: false });
    expect(approved).toBe(rows.length - missing);
    expect(() => init(cfg, { force: false })).toThrow("--force");
    expect(init(cfg, { force: true }).approved).toBe(approved);
    const first = readFileSync(join(cfg.statusDir, "common.tsv"), "utf8");
    expect(first.split("\n")[0]).toBe("# key\tstate\ten\tes\tko");
    expect(readStatus(cfg, "common").errors).toEqual([]);
    expect(status(cfg, {})).toMatchObject({
      rows: rows.length,
      counts: { approved, missing },
    });
    expect(status(cfg, {})).not.toHaveProperty("hint");
  });

  it("parses status files by header: a new locale column shows as changed", () => {
    const cfg = copyFixture(["en", "ko"]);
    init(cfg, { force: false });
    cpSync(join(FIXTURE_DIR, "es"), join(cfg.i18nDir, "es"), {
      recursive: true,
    });
    const row = getRows(cfg, loadCatalog(cfg)).find(
      (r) => r.state !== "missing"
    );
    expect(row).toMatchObject({ state: "edited", changedLocales: ["es"] });
  });

  it("hints when there are no records, in status and report", () => {
    const cfg = syntheticConfig();
    expect(status(cfg, {}).hint).toBe(NO_RECORDS_HINT);
    const { file } = report(cfg);
    expect(readFileSync(file, "utf8")).toContain("No status records yet");
    init(cfg, { force: false });
    report(cfg);
    expect(readFileSync(file, "utf8")).not.toContain("No status records yet");
  });

  it("check passes on keys/order and flags only empty values (fixture copy)", () => {
    const { problems, ok } = check(copyFixture());
    expect(ok).toBe(true); // warnings only by default
    expect(
      problems.filter((p) => p.kind !== "empty" && p.kind !== "new")
    ).toEqual([]);
  });

  it("check flags malformed status files", () => {
    const cfg = syntheticConfig();
    init(cfg, { force: false });
    const file = join(cfg.statusDir, "a.tsv");
    appendFileSync(file, "broken\tapproved\n");
    const checked = check(cfg);
    expect(checked.ok).toBe(false);
    expect(
      checked.problems.find((p) => p.kind === "status-file")
    ).toMatchObject({ level: "error" });
    expect(checked.problems.map((p) => p.message).join("\n")).toContain(
      "a.tsv"
    );
  });

  it("draft, set and approve move a row through the states", () => {
    const cfg = syntheticConfig();
    init(cfg, { force: false });
    expect(draft(cfg, { keys: ["a.title"] })).toEqual({ marked: 1 });
    expect(getRows(cfg, loadCatalog(cfg))[0].state).toBe("ai-draft");

    const before = readText(cfg, "ko", "b");
    const res = set(cfg, "ko", "a.title", "새 제목");
    expect(res).toMatchObject({ old: "안녕", new: "새 제목", state: "edited" });
    expect(readJson(cfg, "ko", "a").title).toBe("새 제목");
    expect(readText(cfg, "ko", "b")).toBe(before);
    expect(() => set(cfg, "ko", "a.nope", "x")).toThrow("Unknown key");

    expect(() => approve(cfg, {}, { allEdited: false })).toThrow();
    expect(approve(cfg, {}, { allEdited: true })).toEqual({ approved: 1 });
    expect(status(cfg, {}).counts).toEqual({ approved: 6 });
  });

  it("editing only the source makes the row stale", () => {
    const cfg = syntheticConfig();
    init(cfg, { force: false });
    set(cfg, "en", "b.title", "Farewell");
    const row = getRows(cfg, loadCatalog(cfg)).find(
      (r) => r.address === "b.title"
    );
    expect(row).toMatchObject({ state: "stale", changedLocales: ["en"] });
  });
});
