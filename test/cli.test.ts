import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { FIXTURE_DIR } from "./helpers.js";

const cli = async (...argv: string[]) => {
  let out = "";
  const code = await run(argv, (t) => {
    out += t;
  });
  return { code, out };
};

describe("help", () => {
  it("prints the overview for --help, -h, help and no command", async () => {
    for (const argv of [["--help"], ["-h"], ["help"], []]) {
      const { code, out } = await cli(...argv);
      expect(code).toBe(0);
      expect(out).toContain(
        "Usage: i18n-studio --dir <messages dir> <command>"
      );
      expect(out).toContain("Flow: translate -> draft -> export");
    }
  });

  it("prints one command's usage for `<command> --help` and `help <command>`", async () => {
    for (const argv of [
      ["export", "--help"],
      ["help", "export"],
    ]) {
      const { code, out } = await cli(...argv);
      expect(code).toBe(0);
      expect(out).toContain("--format tsv|xlsx|csv");
      expect(out).not.toContain("Commands:");
    }
  });

  it("does not run the command when --help is given", async () => {
    const { out } = await cli("init", "--help");
    expect(out).toContain("Usage: i18n-studio --dir <messages dir> init");
    expect(out).not.toContain("approved:");
  });

  it("fails with the overview on an unknown command", async () => {
    const { code, out } = await cli("nope");
    expect(code).toBe(1);
    expect(out).toContain("unknown command: nope");
    expect(out).toContain("Commands:");
  });
});

describe("flag parsing through the real argv path", () => {
  it("accepts --no-copy-header and --copy-header", async () => {
    for (const flag of ["--no-copy-header", "--copy-header"]) {
      const { code } = await cli("--dir", FIXTURE_DIR, flag, "status");
      expect(code).toBe(0);
    }
  });
});
