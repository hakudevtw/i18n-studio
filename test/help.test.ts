import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";

const help = async (...argv: string[]) => {
  let out = "";
  await run(argv, (t) => {
    out += t;
  });
  return out;
};

describe("--help mentions the newer options and commands", () => {
  it("lists the global flags", async () => {
    const out = await help("--help");
    for (const flag of [
      "--no-language-switcher",
      "--show-archived / --no-show-archived",
      "--open / --no-open",
      "--read-only",
      "--ui-lang",
      "--fail-on",
    ]) {
      expect(out).toContain(flag);
    }
    expect(out).toContain("prune [keys...] [--ns x] [--yes]");
  });

  it("warns on prune about checking usage first", async () => {
    const out = await help("prune", "--help");
    expect(out).toContain("check usage first");
    expect(out).toContain("never run --yes without approval");
  });
});
