import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/catalog.js";
import { run } from "../src/cli.js";
import { CONFIG_FILE, configFromArgs } from "../src/config.js";
import { FIXTURE_DIR, tempDir } from "./helpers.js";

const writeConfig = (dir: string, data: unknown, name = CONFIG_FILE) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(data));
};

describe("configFromArgs: flags only", () => {
  it("requires --dir with a hint", () => {
    expect(() => configFromArgs({}, tempDir())).toThrow("--dir");
  });

  it("applies defaults relative to the cwd", () => {
    const cwd = tempDir();
    expect(configFromArgs({ dir: "src/messages" }, cwd)).toMatchObject({
      i18nDir: join(cwd, "src/messages"),
      sourceLocale: "en",
      statusDir: `${join(cwd, "src/messages")}-status`,
      reportDir: join(cwd, "node_modules/.cache/i18n-studio"),
    });
  });

  it("resolves flag paths against the cwd and honours the overrides", () => {
    const cwd = tempDir();
    expect(
      configFromArgs(
        { dir: "m", source: "ja", "status-dir": "st", "report-dir": "rp" },
        cwd
      )
    ).toMatchObject({
      i18nDir: join(cwd, "m"),
      sourceLocale: "ja",
      statusDir: join(cwd, "st"),
      reportDir: join(cwd, "rp"),
    });
  });
});

describe("configFromArgs: config file", () => {
  it("is optional, and --dir may come from the file", () => {
    const cwd = tempDir();
    expect(() => configFromArgs({}, cwd)).toThrow("--dir");
    writeConfig(cwd, { dir: "msgs" });
    expect(configFromArgs({}, cwd).i18nDir).toBe(join(cwd, "msgs"));
  });

  it("gives flags > file > defaults", () => {
    const cwd = tempDir();
    writeConfig(cwd, {
      dir: "fromFile",
      source: "fr",
      statusDir: "fileStatus",
    });
    const cfg = configFromArgs({ dir: "fromFlag" }, cwd);
    expect(cfg).toMatchObject({
      i18nDir: join(cwd, "fromFlag"), // flag beats file
      sourceLocale: "fr", // file beats default
      statusDir: join(cwd, "fileStatus"),
    });
    expect(cfg.reportDir).toBe(join(cwd, "node_modules/.cache/i18n-studio")); // default
    expect(configFromArgs({ source: "de" }, cwd).sourceLocale).toBe("de");
  });

  it("resolves file paths against the file's folder, flag paths against the cwd", () => {
    const cwd = tempDir();
    const shared = join(cwd, "shared");
    writeConfig(shared, { dir: "msgs", reportDir: "out" }, "custom.json");
    const cfg = configFromArgs(
      { config: "shared/custom.json", "status-dir": "st" },
      cwd
    );
    expect(cfg.i18nDir).toBe(join(shared, "msgs"));
    expect(cfg.reportDir).toBe(join(shared, "out"));
    expect(cfg.statusDir).toBe(join(cwd, "st"));
  });

  it("is strict about unknown keys and types, naming the key", () => {
    const cwd = tempDir();
    writeConfig(cwd, { dir: "m", statusDirr: "x" });
    expect(() => configFromArgs({}, cwd)).toThrow('unknown key "statusDirr"');
    writeConfig(cwd, { dir: 5 });
    expect(() => configFromArgs({}, cwd)).toThrow('"dir" must be');
    writeConfig(cwd, ["dir"]);
    expect(() => configFromArgs({}, cwd)).toThrow("JSON object");
    writeFileSync(join(cwd, CONFIG_FILE), "module.exports = {}");
    expect(() => configFromArgs({ dir: "m" }, cwd)).toThrow("Cannot read");
  });

  it("errors when an explicit --config file is missing", () => {
    expect(() =>
      configFromArgs({ config: "nope.json", dir: "m" }, tempDir())
    ).toThrow("Config file not found");
  });
});

describe("cli flags", () => {
  const cli = async (cwd: string, ...argv: string[]) => {
    let out = "";
    const code = await run(
      argv,
      (t) => {
        out += t;
      },
      cwd
    );
    return { code, out };
  };

  const project = () => {
    const cwd = tempDir();
    cpSync(FIXTURE_DIR, join(cwd, "src/i18n/messages"), { recursive: true });
    return cwd;
  };

  it("fails with a hint when --dir is missing", async () => {
    await expect(cli(project(), "status")).rejects.toThrow("--dir");
  });

  it("accepts global flags anywhere on the line and writes status next to the dir", async () => {
    const cwd = project();
    const a = await cli(cwd, "--dir", "src/i18n/messages", "status");
    const b = await cli(cwd, "status", "--dir=src/i18n/messages");
    expect(a.out).toContain("No status records yet");
    expect(b.out).toBe(a.out);
    await cli(cwd, "init", "--dir", "src/i18n/messages");
    const { out } = await cli(cwd, "status", "--dir", "src/i18n/messages");
    expect(out).toContain("approved 13");
    expect(out).toContain("missing 3");
  });

  it("never mistakes the status or report folders for locales", async () => {
    const cwd = project();
    const dir = "src/i18n/messages";
    await cli(cwd, "init", "--dir", dir);
    // A status dir inside the messages dir (tsv only) and a report dir with json.
    await cli(
      cwd,
      "init",
      "--force",
      "--dir",
      dir,
      "--status-dir",
      `${dir}/_status`
    );
    await cli(cwd, "report", "--dir", dir, "--report-dir", `${dir}/_report`);
    writeFileSync(join(cwd, dir, "_report", "proposal.json"), "{}");
    const cfg = configFromArgs(
      { dir, "status-dir": `${dir}/_status`, "report-dir": `${dir}/_report` },
      cwd
    );
    expect(loadCatalog(cfg).locales).toEqual(["es", "ko"]);
  });

  it("reads the default config file in the cwd", async () => {
    const cwd = project();
    writeConfig(cwd, { dir: "src/i18n/messages" });
    const { out } = await cli(cwd, "status", "--json");
    expect(JSON.parse(out).rows).toBe(16);
  });
});
