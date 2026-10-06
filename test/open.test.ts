import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { CONFIG_FILE, configFromArgs } from "../src/config.js";
import { shouldOpen, tryOpen } from "../src/open.js";
import { copyFixture, tempDir } from "./helpers.js";

const BASE_URL = /^http:\/\/127\.0\.0\.1:\d+\/$/;
const URL_LINE = /url: http:\/\/127\.0\.0\.1:\d+\//;

describe("shouldOpen (pure)", () => {
  it("is off by default and follows the config", () => {
    expect(shouldOpen({}, { open: false })).toBe(false);
    expect(shouldOpen({}, { open: true })).toBe(true);
  });

  it("lets flags beat the config, and --no-open beat --open", () => {
    expect(shouldOpen({ open: true }, { open: false })).toBe(true);
    expect(shouldOpen({ "no-open": true }, { open: true })).toBe(false);
    expect(shouldOpen({ open: false }, { open: true })).toBe(false);
    expect(shouldOpen({ open: true, "no-open": true }, { open: true })).toBe(
      false
    );
  });
});

describe("tryOpen", () => {
  it("reports success, and swallows a failing opener", () => {
    const seen: string[] = [];
    expect(tryOpen((u) => seen.push(u), "http://x/")).toBe(true);
    expect(seen).toEqual(["http://x/"]);
    expect(
      tryOpen(() => {
        throw new Error("no gui");
      }, "http://x/")
    ).toBe(false);
  });
});

describe("config key open", () => {
  const cwd = tempDir();
  const write = (data: unknown) =>
    writeFileSync(join(cwd, CONFIG_FILE), JSON.stringify(data));

  it("defaults to false, is read from the file and is strictly typed", () => {
    write({ dir: "m" });
    expect(configFromArgs({}, cwd).open).toBe(false);
    write({ dir: "m", open: true });
    expect(configFromArgs({}, cwd).open).toBe(true);
    write({ dir: "m", open: "yes" });
    expect(() => configFromArgs({}, cwd)).toThrow('"open" must be');
  });
});

describe("studio command opens only the base URL, with an injectable opener", () => {
  const studio = async (
    extra: string[],
    opener: (u: string) => void,
    config = {}
  ) => {
    const cfg = copyFixture();
    const file = join(tempDir(), "studio.json");
    writeFileSync(file, JSON.stringify({ dir: cfg.i18nDir, ...config }));
    const servers: { close: () => void }[] = [];
    let out = "";
    await run(
      [
        "studio",
        "--port",
        "0",
        "--config",
        file,
        "--status-dir",
        cfg.statusDir,
        "--report-dir",
        cfg.reportDir,
        ...extra,
      ],
      (t) => {
        out += t;
      },
      process.cwd(),
      { open: opener, started: (s) => servers.push(s) }
    );
    for (const s of servers) {
      s.close();
    }
    return out;
  };

  it("does not open by default", async () => {
    const urls: string[] = [];
    await studio([], (u) => urls.push(u));
    expect(urls).toEqual([]);
  });

  it("--open opens the base URL, which never contains the token", async () => {
    const urls: string[] = [];
    const out = await studio(["--open"], (u) => urls.push(u));
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(BASE_URL);
    expect(out).toContain("opened: true");
  });

  it("--no-open overrides a config open: true", async () => {
    const urls: string[] = [];
    await studio(["--no-open"], (u) => urls.push(u), { open: true });
    expect(urls).toEqual([]);
    await studio([], (u) => urls.push(u), { open: true });
    expect(urls).toHaveLength(1);
  });

  it("prints the URL and carries on when the opener fails", async () => {
    const out = await studio(["--open"], () => {
      throw new Error("headless");
    });
    expect(out).toMatch(URL_LINE);
    expect(out).not.toContain("opened");
  });
});
