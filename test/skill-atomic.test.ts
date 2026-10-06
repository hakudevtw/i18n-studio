import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers.js";

const spy = vi.hoisted(() => ({ calls: [] as string[][] }));
vi.mock("../src/fsx.js", async (original) => {
  const real = await original<typeof import("../src/fsx.js")>();
  return {
    ...real,
    atomicWriteAll: (files: { path: string; content: string }[]) => {
      spy.calls.push(files.map((f) => f.path));
      return real.atomicWriteAll(files);
    },
  };
});
const { installSkill } = await import("../src/skill.js");

describe("skill install uses the one atomic write path", () => {
  it("writes through atomicWriteAll, once, and never on a dry run or a no-op", () => {
    const cwd = tempDir();
    const dest = join(cwd, ".claude/skills/i18n-studio/SKILL.md");
    installSkill({ cwd, target: "claude", force: false, dryRun: true });
    expect(spy.calls).toEqual([]);
    installSkill({ cwd, target: "claude", force: false, dryRun: false });
    expect(spy.calls).toEqual([[dest]]);
    installSkill({ cwd, target: "claude", force: false, dryRun: false });
    expect(spy.calls).toHaveLength(1);
  });
});
