import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAsset } from "../src/assets.js";
import { loadCatalog } from "../src/catalog.js";
import { run } from "../src/cli.js";
import {
  buildModel,
  check,
  exportRows,
  init,
  mark,
  report,
  set,
  status,
} from "../src/commands.js";
import { CONFIG_FILE, configFromArgs, DEFAULTS } from "../src/config.js";
import { detectIndent } from "../src/flatten.js";
import { renderReport } from "../src/html.js";
import { startStudio } from "../src/server.js";
import { getRows, readStatus } from "../src/status.js";
import { readTable } from "../src/table.js";
import {
  copyFixture,
  FIXTURE_MISSING,
  readText,
  syntheticConfig,
  tempDir,
} from "./helpers.js";

const stateOf = (cfg: Parameters<typeof getRows>[0], address: string) =>
  getRows(cfg, loadCatalog(cfg)).find((r) => r.address === address)?.state;

describe("config: the new options", () => {
  const cwd = tempDir();
  const write = (data: unknown) =>
    writeFileSync(join(cwd, CONFIG_FILE), JSON.stringify(data));

  it("have documented defaults", () => {
    write({ dir: "m" });
    expect(configFromArgs({}, cwd)).toMatchObject({
      copyHeader: true,
      port: undefined,
      failOn: ["status-file"],
      ignoreKeys: [],
      exportStates: DEFAULTS.exportStates,
      customStates: [],
      indent: "auto",
    });
  });

  it("read flags that override the file", () => {
    write({ dir: "m", copyHeader: true, port: 5000, indent: 2 });
    const cfg = configFromArgs(
      {
        "copy-header": false,
        port: "6000",
        "fail-on": "empty, order",
        indent: "tab",
      },
      cwd
    );
    expect(cfg).toMatchObject({
      copyHeader: false,
      port: 6000,
      failOn: ["status-file", "empty", "order"],
      indent: "tab",
    });
  });

  it("validates types and values with errors naming the key", () => {
    write({ dir: "m", port: "80" });
    expect(() => configFromArgs({}, cwd)).toThrow('"port" must be');
    write({ dir: "m", indent: 0 });
    expect(() => configFromArgs({}, cwd)).toThrow('"indent" must be');
    write({ dir: "m", ignoreKeys: "*.meta.*" });
    expect(() => configFromArgs({}, cwd)).toThrow('"ignoreKeys" must be');
    write({ dir: "m", failOn: ["nope"] });
    expect(() => configFromArgs({}, cwd)).toThrow("failOn");
    write({ dir: "m", exportStates: ["nope"] });
    expect(() => configFromArgs({}, cwd)).toThrow("exportStates");
    write({ dir: "m", customStates: ["Approved"] });
    expect(() => configFromArgs({}, cwd)).toThrow("customStates");
    write({ dir: "m", customStates: ["stale"] });
    expect(() => configFromArgs({}, cwd)).toThrow("built-in");
    write({ dir: "m", customStates: ["legal-ok"], exportStates: ["legal-ok"] });
    expect(configFromArgs({}, cwd).customStates).toEqual(["legal-ok"]);
    expect(() => configFromArgs({ port: "abc", dir: "m" }, cwd)).toThrow(
      "--port"
    );
  });
});

describe("check: warnings by default, failOn opts in", () => {
  it("only fails for status-file problems by default", () => {
    const cfg = copyFixture();
    const result = check(cfg);
    expect(result.ok).toBe(true);
    expect(result.errors).toBe(0);
    expect(result.problems.filter((p) => p.kind === "empty")).toHaveLength(
      3 * 3 // 3 empty rows in en, es and ko
    );
    expect(result.problems.every((p) => p.level === "warning")).toBe(true);
  });

  it("fails for the listed kinds", () => {
    const cfg = copyFixture(["en", "ko", "es"], {
      failOn: ["status-file", "empty"],
    });
    const result = check(cfg);
    expect(result.ok).toBe(false);
    expect(result.problems.find((p) => p.kind === "empty")?.level).toBe(
      "error"
    );
    expect(result.problems.find((p) => p.kind === "new")?.level).toBe(
      "warning"
    );
  });

  it("reports order, orphan and missing-key kinds", () => {
    const cfg = copyFixture();
    const file = join(cfg.i18nDir, "ko", "common.json");
    writeFileSync(
      file,
      JSON.stringify(
        { extra: "x", buttons: { search: "검색" }, _0: "영" },
        null,
        2
      )
    );
    const kinds = check(cfg).problems.map((p) => p.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(["orphan-key", "missing-key", "order"])
    );
  });

  it("prints text, json and GitHub annotations, with exit codes", async () => {
    const cfg = copyFixture(["en", "ko", "es"], {
      failOn: ["status-file", "empty"],
    });
    const argv = (...a: string[]) => [
      ...a,
      "--dir",
      cfg.i18nDir,
      "--status-dir",
      cfg.statusDir,
    ];
    const cli = async (...a: string[]) => {
      let out = "";
      const code = await run(argv(...a), (t) => {
        out += t;
      });
      return { code, out };
    };
    const noFail = await cli("check");
    expect(noFail.code).toBe(0);
    expect(noFail.out).toContain("check passed");
    expect(noFail.out).toContain("row(s) new");

    const failing = await cli(
      "check",
      "--fail-on",
      "empty",
      "--format",
      "github"
    );
    expect(failing.code).toBe(1);
    const lines = failing.out.trim().split("\n");
    expect(
      lines.some(
        (l) =>
          l.startsWith("::error file=") && l.includes("title=i18n-studio::")
      )
    ).toBe(true);
    expect(lines.some((l) => l.startsWith("::warning "))).toBe(true);

    const json = await cli("check", "--json");
    expect(JSON.parse(json.out)).toMatchObject({ ok: true, errors: 0 });
    await expect(cli("check", "--format", "xml")).rejects.toThrow("--format");
  });

  it("treats an unreadable catalog as a status-file error", () => {
    const cfg = copyFixture();
    writeFileSync(join(cfg.i18nDir, "ko", "common.json"), "{ nope");
    const result = check(cfg);
    expect(result.ok).toBe(false);
    expect(result.problems[0].kind).toBe("status-file");
  });
});

describe("ignoreKeys", () => {
  const options = { ignoreKeys: ["*.meta.*"] };

  it("are never missing, not checked, baselined by init", () => {
    const cfg = copyFixture(["en", "ko", "es"], options);
    expect(
      getRows(cfg, loadCatalog(cfg)).filter((r) => r.state === "missing")
    ).toHaveLength(0);
    expect(check(cfg).problems.some((p) => p.kind === "empty")).toBe(false);
    const total = getRows(cfg, loadCatalog(cfg)).length;
    expect(init(cfg, { force: false }).approved).toBe(total);
    expect(status(cfg, {}).counts).toEqual({ approved: total });
  });

  it("stay out of the default export but are in --all", async () => {
    const cfg = copyFixture(["en", "ko", "es"], options);
    const out = join(cfg.reportDir, "a.tsv");
    await exportRows(cfg, { all: false, format: "tsv", out });
    const keysOf = async () =>
      (await readTable(out))[0].rows.slice(1).map((r) => r[2]);
    expect((await keysOf()).some((k) => k.startsWith("meta."))).toBe(false);
    await exportRows(cfg, { all: true, format: "tsv", out });
    expect((await keysOf()).filter((k) => k.startsWith("meta."))).toHaveLength(
      FIXTURE_MISSING
    );
  });

  it("match `*` against dots too, literally otherwise", () => {
    const cfg = copyFixture(["en", "ko", "es"], {
      ignoreKeys: ["plan-page.meta.title", "common.buttons.d*"],
    });
    expect(stateOf(cfg, "plan-page.meta.title")).toBe("new");
    expect(stateOf(cfg, "plan-page.meta.description")).toBe("missing");
    expect(
      getRows(cfg, loadCatalog(cfg))
        .filter((r) => r.ignored)
        .map((r) => r.address)
    ).toEqual(["common.buttons.done", "plan-page.meta.title"]);
  });
});

describe("exportStates", () => {
  it("chooses which states export includes by default", async () => {
    const cfg = copyFixture(["en", "ko", "es"], { exportStates: ["new"] });
    const out = join(cfg.reportDir, "e.tsv");
    const first = await exportRows(cfg, { all: false, format: "tsv", out });
    expect(first.rows).toBe(16 - FIXTURE_MISSING); // new rows only; missing excluded
    init(cfg, { force: true });
    expect(
      (await exportRows(cfg, { all: false, format: "tsv", out })).rows
    ).toBe(0);
  });
});

describe("custom states", () => {
  it("mark sets built-in and custom states that round-trip", () => {
    const cfg = syntheticConfig({ customStates: ["legal-ok"] });
    init(cfg, { force: false });
    expect(mark(cfg, "legal-ok", { keys: ["a.title"] })).toEqual({
      marked: 1,
      state: "legal-ok",
    });
    expect(stateOf(cfg, "a.title")).toBe("legal-ok");
    expect(readStatus(cfg, "a").errors).toEqual([]);
    expect(readFileSync(join(cfg.statusDir, "a.tsv"), "utf8")).toContain(
      "title\tlegal-ok\t"
    );
    mark(cfg, "archived", { ns: "b" });
    expect(status(cfg, {}).counts).toEqual({
      approved: 3,
      "legal-ok": 1,
      archived: 2,
    });
    // Plain label: editing a cell still derives edited, and the report shows the label.
    set(cfg, "ko", "a.title", "새");
    expect(stateOf(cfg, "a.title")).toBe("edited");
  });

  it("rejects unknown states listing the allowed ones, and needs keys or --ns", () => {
    const cfg = syntheticConfig({ customStates: ["legal-ok"] });
    expect(() => mark(cfg, "nope", { keys: ["a.title"] })).toThrow(
      "allowed: ai-draft, in-review, approved, archived, legal-ok"
    );
    expect(() => mark(cfg, "approved", {})).toThrow("keys or --ns");
  });

  it("a status file with an unconfigured custom state is a status-file problem", () => {
    const cfg = syntheticConfig({ customStates: ["legal-ok"] });
    init(cfg, { force: false });
    mark(cfg, "legal-ok", { keys: ["a.title"] });
    const plain = { ...cfg, customStates: [] };
    expect(check(plain).problems.some((p) => p.kind === "status-file")).toBe(
      true
    );
  });

  it("labels render without a special badge colour", () => {
    const cfg = syntheticConfig({ customStates: ["legal-ok"] });
    init(cfg, { force: false });
    mark(cfg, "legal-ok", { keys: ["a.title"] });
    const html = renderReport(buildModel(cfg));
    expect(html).toContain("legal-ok");
    expect(html).not.toContain(".b-legal-ok");
  });
});

describe("locale and namespace order / exclusion", () => {
  it("localeOrder puts listed locales first, the rest follow", async () => {
    const cfg = copyFixture(["en", "ko", "es"], { localeOrder: ["ko"] });
    expect(loadCatalog(cfg).locales).toEqual(["ko", "es"]);
    expect(buildModel(cfg).columns).toEqual(["en", "ko", "es"]);
    const out = join(cfg.reportDir, "o.tsv");
    await exportRows(cfg, { all: true, format: "tsv", out });
    expect((await readTable(out))[0].rows[0]).toEqual([
      "status",
      "namespace",
      "key",
      "en",
      "ko",
      "es",
      "comment",
    ]);
  });

  it("excludeLocales are ignored everywhere; the source cannot be excluded", () => {
    const cfg = copyFixture(["en", "ko", "es"], { excludeLocales: ["es"] });
    expect(loadCatalog(cfg).locales).toEqual(["ko"]);
    expect(buildModel(cfg).columns).toEqual(["en", "ko"]);
    expect(Object.keys(getRows(cfg, loadCatalog(cfg))[0].values)).toEqual([
      "en",
      "ko",
    ]);
    expect(() => loadCatalog({ ...cfg, excludeLocales: ["en"] })).toThrow(
      "source locale"
    );
  });

  it("namespaceOrder / excludeNamespaces shape the sidebar, rows, export and status", async () => {
    const cfg = copyFixture(["en", "ko", "es"], {
      namespaceOrder: ["plan-page", "common"],
      excludeNamespaces: ["booking-page"],
    });
    expect(loadCatalog(cfg).namespaces).toEqual([
      "plan-page",
      "common",
      "faq-page",
      "navigation",
    ]);
    expect(Object.keys(status(cfg, {}).namespaces)).toEqual([
      "plan-page",
      "common",
      "faq-page",
      "navigation",
    ]);
    const out = join(cfg.reportDir, "n.xlsx");
    await exportRows(cfg, { all: true, format: "xlsx", out });
    expect((await readTable(out)).map((s) => s.name)).toEqual([
      "plan-page",
      "common",
      "faq-page",
      "navigation",
    ]);
    expect(
      [...new Set(report(cfg) && buildModel(cfg).rows.map((r) => r.group))][0]
    ).toBe("plan-page");
  });
});

describe("indent", () => {
  const withIndent = (
    spaces: string | number,
    indent: "auto" | number | "tab"
  ) => {
    const cfg = syntheticConfig({ indent });
    for (const lang of ["en", "ko", "es"]) {
      for (const ns of ["a", "b"]) {
        const file = join(cfg.i18nDir, lang, `${ns}.json`);
        writeFileSync(
          file,
          `${JSON.stringify(JSON.parse(readFileSync(file, "utf8")), null, spaces)}\n`
        );
      }
    }
    return cfg;
  };

  it("detects the indent of a text", () => {
    expect(detectIndent('{\n    "a": 1\n}')).toBe(4);
    expect(detectIndent('{\n\t"a": 1\n}')).toBe("tab");
    expect(detectIndent("{}")).toBe(2);
  });

  it("auto keeps each file's indent and trailing newline", () => {
    const four = withIndent(4, "auto");
    set(four, "ko", "a.title", "새");
    expect(readText(four, "ko", "a")).toBe(
      `${JSON.stringify(JSON.parse(readText(four, "ko", "a")), null, 4)}\n`
    );
    const tab = withIndent("\t", "auto");
    set(tab, "ko", "a.title", "새");
    expect(readText(tab, "ko", "a")).toContain('\n\t"title": "새"');
  });

  it("a fixed indent overrides what the file had", () => {
    const cfg = withIndent(4, 2);
    set(cfg, "ko", "a.title", "새");
    expect(readText(cfg, "ko", "a")).toContain('\n  "title": "새"');
    expect(readText(cfg, "ko", "a").endsWith("\n")).toBe(true);
    const tabbed = withIndent(2, "tab");
    set(tabbed, "ko", "a.title", "새");
    expect(readText(tabbed, "ko", "a")).toContain('\n\t"title": "새"');
  });
});

describe("copyHeader and port", () => {
  it("copyHeader goes into the page data; no checkbox or localStorage remains", () => {
    const cfg = syntheticConfig({ copyHeader: false });
    const html = readFileSync(report(cfg).file, "utf8");
    expect(buildModel(cfg).copyHeader).toBe(false);
    expect(html).toContain('"copyHeader":false');
    expect(html).not.toContain("localStorage");
    expect(html).not.toContain('id="header"');
    expect(buildModel(syntheticConfig()).copyHeader).toBe(true);
  });

  it("export always writes a header row", async () => {
    const cfg = syntheticConfig({ copyHeader: false });
    const out = join(cfg.reportDir, "h.tsv");
    await exportRows(cfg, { all: true, format: "tsv", out });
    expect((await readTable(out))[0].rows[0][0]).toBe("status");
  });

  it("an explicit port from config is used as given and fails when taken", async () => {
    const first = await startStudio(syntheticConfig(), { port: 0 });
    try {
      await expect(
        startStudio(syntheticConfig({ port: first.port }))
      ).rejects.toThrow();
    } finally {
      first.server.close();
    }
  });
});

describe("page: sticky namespace rows", () => {
  it("renders the group row as a sticky label over status+key plus a filler", () => {
    expect(readAsset("app.css")).toContain(
      "tr.group td.label{position:sticky;left:0"
    );
    const js = readAsset("app.js");
    expect(js).toContain('class:"label"');
    expect(js).toContain("colSpan:2");
  });
});

describe("uiLocale", () => {
  const cwd = tempDir();
  const write = (data: unknown) =>
    writeFileSync(join(cwd, CONFIG_FILE), JSON.stringify(data));

  it("defaults to auto, reads the file, and --ui-lang wins", () => {
    write({ dir: "m" });
    expect(configFromArgs({}, cwd).uiLocale).toBe("auto");
    write({ dir: "m", uiLocale: "zh-TW" });
    expect(configFromArgs({}, cwd).uiLocale).toBe("zh-TW");
    expect(configFromArgs({ "ui-lang": "ko" }, cwd).uiLocale).toBe("ko");
  });

  it("is strict about values, naming the key or flag", () => {
    write({ dir: "m", uiLocale: "fr" });
    expect(() => configFromArgs({}, cwd)).toThrow('"uiLocale" must be');
    write({ dir: "m" });
    expect(() => configFromArgs({ "ui-lang": "zh-CN" }, cwd)).toThrow(
      "--ui-lang"
    );
  });

  it("the static report embeds it and stays self-contained", () => {
    const cfg = syntheticConfig({ uiLocale: "ja" });
    const html = readFileSync(report(cfg).file, "utf8");
    expect(html).toContain('"uiLocale":"ja"');
    expect(html).toContain('id="data"');
    expect(html).not.toContain('src="');
    expect(html).not.toContain('href="');
  });
});

describe("readOnly", () => {
  const cwd = tempDir();
  const write = (data: unknown) =>
    writeFileSync(join(cwd, CONFIG_FILE), JSON.stringify(data));

  it("defaults to false, reads the file, and --read-only turns it on", () => {
    write({ dir: "m" });
    expect(configFromArgs({}, cwd).readOnly).toBe(false);
    write({ dir: "m", readOnly: true });
    expect(configFromArgs({}, cwd).readOnly).toBe(true);
    write({ dir: "m" });
    expect(configFromArgs({ "read-only": true }, cwd).readOnly).toBe(true);
  });

  it("is strict about the type", () => {
    write({ dir: "m", readOnly: "yes" });
    expect(() => configFromArgs({}, cwd)).toThrow('"readOnly" must be');
  });
});
