import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/catalog.js";
import { run } from "../src/cli.js";
import {
  buildModel,
  check,
  draft,
  exportRows,
  init,
  mark,
  prune,
  status,
} from "../src/commands.js";
import { CONFIG_FILE, configFromArgs } from "../src/config.js";
import { getRows, readStatus } from "../src/status.js";
import { readTable } from "../src/table.js";
import { copyFixture, readJson, readText, tempDir } from "./helpers.js";
import { snapshot, tmpFiles } from "./snapshot.js";

const HEX12 = /^[0-9a-f]{12}$/;
const ZERO = "common._0";
const TITLE = "navigation.footer.title";
const archivedFixture = (overrides = {}) => {
  const cfg = copyFixture(["en", "ko", "es"], overrides);
  init(cfg, { force: false });
  mark(cfg, "archived", { keys: [ZERO, TITLE] });
  return cfg;
};
const rowOf = (cfg: ReturnType<typeof copyFixture>, id: string) =>
  getRows(cfg, loadCatalog(cfg)).find((r) => r.address === id);

describe("archived is a soft delete", () => {
  it("is never missing, edited or stale, whatever the values", () => {
    const cfg = archivedFixture();
    const file = join(cfg.i18nDir, "ko", "common.json");
    const data = JSON.parse(readFileSync(file, "utf8"));
    data._0 = "";
    writeFileSync(file, JSON.stringify(data, null, 2));
    expect(rowOf(cfg, ZERO)?.state).toBe("archived");
  });

  it("is not reported by check for empty or missing values", () => {
    const cfg = archivedFixture();
    const file = join(cfg.i18nDir, "ko", "common.json");
    const data = JSON.parse(readFileSync(file, "utf8"));
    data._0 = "";
    writeFileSync(file, JSON.stringify(data, null, 2));
    const kinds = check(cfg).problems.map((p) => `${p.kind}:${p.message}`);
    expect(kinds.some((k) => k.includes('"_0"'))).toBe(false);
  });

  it("is counted separately in status", () => {
    const cfg = archivedFixture();
    expect(status(cfg, {}).counts).toMatchObject({
      archived: 2,
      approved: 11,
      missing: 3,
    });
  });

  it("is left out of the default export, even if exportStates names it, but kept by --all", async () => {
    const cfg = archivedFixture({ exportStates: ["archived", "approved"] });
    const out = join(cfg.reportDir, "a.tsv");
    const keys = async () =>
      (await readTable(out))[0].rows.slice(1).map((r) => `${r[1]}.${r[2]}`);
    await exportRows(cfg, { all: false, format: "tsv", out });
    expect(await keys()).not.toContain(ZERO);
    await exportRows(cfg, { all: true, format: "tsv", out });
    expect(await keys()).toContain(ZERO);
  });

  it("is skipped by init and keeps its record through init --force; draft skips it", () => {
    const cfg = archivedFixture();
    init(cfg, { force: true });
    expect(rowOf(cfg, ZERO)?.state).toBe("archived");
    expect(rowOf(cfg, TITLE)?.state).toBe("archived");
    expect(draft(cfg, { ns: "common" })).toEqual({ marked: 2 });
    expect(rowOf(cfg, ZERO)?.state).toBe("archived");
  });

  it("travels in the model with the stored states and the switcher flag", () => {
    const cfg = archivedFixture({ customStates: ["legal-ok"] });
    const model = buildModel(cfg);
    expect(model.rows.filter((r) => r.status === "archived")).toHaveLength(2);
    expect(model.storedStates).toEqual([
      "ai-draft",
      "in-review",
      "approved",
      "archived",
      "legal-ok",
    ]);
    expect(model.languageSwitcher).toBe(true);
  });
});

describe("prune", () => {
  it("lists archived keys without writing (dry run)", () => {
    const cfg = archivedFixture();
    const before = snapshot(cfg);
    const result = prune(cfg, {}, { yes: false });
    expect(result).toMatchObject({ dryRun: true, deleted: 0 });
    expect(result.archived.map((r) => r.address)).toEqual([ZERO, TITLE]);
    expect(result.archived[1].values).toEqual({
      en: "Help",
      es: "Ayuda",
      ko: "도움말",
    });
    expect(snapshot(cfg)).toBe(before);
  });

  it("with yes removes the keys from every locale and the status files, byte-stable", () => {
    const cfg = archivedFixture();
    const beforeNav = JSON.parse(readText(cfg, "ko", "navigation"));
    const result = prune(cfg, {}, { yes: true });
    expect(result).toMatchObject({ dryRun: false, deleted: 2 });
    for (const lang of ["en", "es", "ko"]) {
      expect(readJson(cfg, lang, "common")).not.toHaveProperty("_0");
      expect(readJson(cfg, lang, "navigation").footer).toBeUndefined();
    }
    const nav = readText(cfg, "ko", "navigation");
    expect(nav).toBe(JSON.stringify({ link: beforeNav.link }, null, 2));
    expect(rowOf(cfg, ZERO)).toBeUndefined();
    expect(readStatus(cfg, "common").records.has("_0")).toBe(false);
    expect(readStatus(cfg, "navigation").records.has("footer.title")).toBe(
      false
    );
    expect(readStatus(cfg, "common").errors).toEqual([]);
    expect(tmpFiles(cfg)).toEqual([]);
    expect(check(cfg).problems.filter((p) => p.kind === "orphan-key")).toEqual(
      []
    );
  });

  it("only touches the keys and namespace asked for", () => {
    const cfg = archivedFixture();
    prune(cfg, { ns: "common" }, { yes: true });
    expect(readJson(cfg, "ko", "common")).not.toHaveProperty("_0");
    expect(readJson(cfg, "ko", "navigation").footer).toBeDefined();
    prune(cfg, { keys: [TITLE] }, { yes: true });
    expect(readJson(cfg, "ko", "navigation").footer).toBeUndefined();
  });

  it("refuses keys that are not archived", () => {
    const cfg = archivedFixture();
    expect(() =>
      prune(cfg, { keys: ["navigation.link.faq"] }, { yes: true })
    ).toThrow("Not archived");
  });

  it("refuses to leave a gap in an array, and writes nothing", () => {
    const cfg = archivedFixture();
    mark(cfg, "archived", {
      keys: [
        "faq-page.crj_support.faqs.0.answer",
        "faq-page.crj_support.faqs.0.question",
      ],
    });
    const before = snapshot(cfg);
    expect(() => prune(cfg, {}, { yes: true })).toThrow("gap in the array");
    expect(snapshot(cfg)).toBe(before);
  });

  it("can remove trailing array items", () => {
    const cfg = archivedFixture();
    mark(cfg, "archived", {
      keys: [
        "faq-page.crj_support.faqs.1.answer",
        "faq-page.crj_support.faqs.1.question",
      ],
    });
    prune(cfg, { ns: "faq-page" }, { yes: true });
    expect(readJson(cfg, "ko", "faq-page").crj_support.faqs).toHaveLength(1);
  });

  it("keeps a trailing newline convention", () => {
    const cfg = archivedFixture();
    for (const lang of ["en", "ko", "es"]) {
      const file = join(cfg.i18nDir, lang, "common.json");
      writeFileSync(file, `${readFileSync(file, "utf8")}\n`);
    }
    prune(cfg, { ns: "common" }, { yes: true });
    expect(readText(cfg, "ko", "common").endsWith("\n")).toBe(true);
  });

  it("works through the CLI: dry run by default, --json, --yes deletes", async () => {
    const cfg = archivedFixture();
    const argv = (...a: string[]) => [
      ...a,
      "--dir",
      cfg.i18nDir,
      "--status-dir",
      cfg.statusDir,
      "--report-dir",
      cfg.reportDir,
    ];
    const cli = async (...a: string[]) => {
      let out = "";
      const code = await run(argv(...a), (t) => {
        out += t;
      });
      return { code, out };
    };
    const dry = await cli("prune");
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("dry run: 2 archived key(s)");
    expect(dry.out).toContain(ZERO);
    expect(JSON.parse((await cli("prune", "--json")).out)).toMatchObject({
      dryRun: true,
      deleted: 0,
    });
    expect(readJson(cfg, "ko", "common")).toHaveProperty("_0");
    const done = await cli("prune", "--yes");
    expect(done.out).toContain("deleted 2 key(s)");
    expect(readJson(cfg, "ko", "common")).not.toHaveProperty("_0");
    expect((await cli("prune")).out).toContain("no archived keys");
    expect((await cli("prune", "--help")).out).toContain("--yes");
  });
});

describe("languageSwitcher option", () => {
  const cwd = tempDir();
  const write = (data: unknown) =>
    writeFileSync(join(cwd, CONFIG_FILE), JSON.stringify(data));

  it("defaults to true, reads the file, and --no-language-switcher turns it off", () => {
    write({ dir: "m" });
    expect(configFromArgs({}, cwd).languageSwitcher).toBe(true);
    write({ dir: "m", languageSwitcher: false });
    expect(configFromArgs({}, cwd).languageSwitcher).toBe(false);
    write({ dir: "m" });
    expect(
      configFromArgs({ "no-language-switcher": true }, cwd).languageSwitcher
    ).toBe(false);
  });

  it("is strict about the type", () => {
    write({ dir: "m", languageSwitcher: "no" });
    expect(() => configFromArgs({}, cwd)).toThrow('"languageSwitcher" must be');
  });

  it("reaches the model", () => {
    expect(
      buildModel(copyFixture(["en", "ko", "es"], { languageSwitcher: false }))
        .languageSwitcher
    ).toBe(false);
  });
});

describe("showArchived option", () => {
  const cwd = tempDir();
  const write = (data: unknown) =>
    writeFileSync(join(cwd, CONFIG_FILE), JSON.stringify(data));

  it("defaults to false, reads the file and is strictly typed", () => {
    write({ dir: "m" });
    expect(configFromArgs({}, cwd).showArchived).toBe(false);
    write({ dir: "m", showArchived: true });
    expect(configFromArgs({}, cwd).showArchived).toBe(true);
    write({ dir: "m", showArchived: 1 });
    expect(() => configFromArgs({}, cwd)).toThrow('"showArchived" must be');
  });

  it("lets flags beat the file, and --no-show-archived beat --show-archived", () => {
    write({ dir: "m", showArchived: true });
    expect(configFromArgs({ "no-show-archived": true }, cwd).showArchived).toBe(
      false
    );
    write({ dir: "m", showArchived: false });
    expect(configFromArgs({ "show-archived": true }, cwd).showArchived).toBe(
      true
    );
    expect(
      configFromArgs({ "show-archived": true, "no-show-archived": true }, cwd)
        .showArchived
    ).toBe(false);
  });

  it("only changes the model: check, status, export and prune ignore it", () => {
    const hidden = archivedFixture({ showArchived: false });
    const shown = archivedFixture({ showArchived: true });
    expect(buildModel(hidden).showArchived).toBe(false);
    expect(buildModel(shown).showArchived).toBe(true);
    expect(status(shown, {}).counts).toEqual(status(hidden, {}).counts);
    expect(check(shown).problems).toHaveLength(check(hidden).problems.length);
    expect(prune(shown, {}, { yes: false }).archived).toEqual(
      prune(hidden, {}, { yes: false }).archived
    );
  });
});

describe("persistDrafts option", () => {
  const cwd = tempDir();
  const write = (data: unknown) =>
    writeFileSync(join(cwd, CONFIG_FILE), JSON.stringify(data));

  it("defaults to true, reads the file and is strictly typed", () => {
    write({ dir: "m" });
    expect(configFromArgs({}, cwd).persistDrafts).toBe(true);
    write({ dir: "m", persistDrafts: false });
    expect(configFromArgs({}, cwd).persistDrafts).toBe(false);
    write({ dir: "m", persistDrafts: "no" });
    expect(() => configFromArgs({}, cwd)).toThrow('"persistDrafts" must be');
  });

  it("lets flags beat the file, and --no-persist-drafts beat --persist-drafts", () => {
    write({ dir: "m", persistDrafts: true });
    expect(
      configFromArgs({ "no-persist-drafts": true }, cwd).persistDrafts
    ).toBe(false);
    write({ dir: "m", persistDrafts: false });
    expect(configFromArgs({ "persist-drafts": true }, cwd).persistDrafts).toBe(
      true
    );
    expect(
      configFromArgs({ "persist-drafts": true, "no-persist-drafts": true }, cwd)
        .persistDrafts
    ).toBe(false);
  });

  it("is in the model together with a project id that is not the path", () => {
    const cfg = archivedFixture({ persistDrafts: false });
    const model = buildModel(cfg);
    expect(model.persistDrafts).toBe(false);
    expect(model.projectId).toMatch(HEX12);
    expect(JSON.stringify(model)).not.toContain(cfg.i18nDir);
    expect(buildModel(archivedFixture()).projectId).not.toBe(model.projectId);
    expect(buildModel(cfg).projectId).toBe(model.projectId);
  });
});
