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
      "--persist-drafts / --no-persist-drafts",
      "--open / --no-open",
      "--read-only",
      "--ui-lang",
      "--fail-on",
    ]) {
      expect(out).toContain(flag);
    }
    expect(out).toContain("prune [keys...] [--ns x] [--yes]");
    expect(out).toContain("skill print");
    expect(out).toContain("skill install");
  });

  it("warns on prune about checking usage first", async () => {
    const out = await help("prune", "--help");
    expect(out).toContain("check usage first");
    expect(out).toContain("never run --yes without approval");
  });
});
