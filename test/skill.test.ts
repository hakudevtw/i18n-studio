import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS, OPTIONS, run } from "../src/cli.js";
import {
  agentsBlock,
  installSkill,
  planSkillInstall,
  readPackagedSkill,
  SKILL_END,
  SKILL_START,
  SKILL_SUBCOMMANDS,
  skillVersion,
} from "../src/skill.js";
import { tempDir } from "./helpers.js";

const packaged = readPackagedSkill();
const packageVersion = JSON.parse(
  readFileSync(join(import.meta.dirname, "../package.json"), "utf8")
).version;
const agents = { target: "agents", force: false } as const;
const claude = { target: "claude", force: false } as const;
const FLAG = /--[a-z][a-z-]*/g;
const CODE_SPAN = /`([^`\n]+)`/g;
const DIR_FLAG = /--dir <[^>]*>/g;
const WHITESPACE = /\s+/;
const SHA_PREFIX = /^[0-9a-f]{12}$/;
const NO_NETWORK_OR_DESTRUCTIVE = /curl|wget|https?:\/\/|rm -rf|sudo/i;
const README_SECTION =
  /^## Claude skill[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m;
const BARE_FRONTMATTER = /^---$/m;

describe("planSkillInstall: SKILL.md", () => {
  it("creates a missing file", () => {
    expect(planSkillInstall(undefined, packaged, claude)).toMatchObject({
      action: "create",
      content: packaged,
    });
  });

  it("is a no-op for an identical file", () => {
    const plan = planSkillInstall(packaged, packaged, claude);
    expect(plan.action).toBe("unchanged");
    expect(plan.content).toBeUndefined();
  });

  it("refuses a different file without force, with a line summary", () => {
    const edited = `${packaged}\nmy own rule\n`;
    const plan = planSkillInstall(edited, packaged, claude);
    expect(plan.action).toBe("refuse");
    expect(plan.reason).toContain("--force");
    expect(plan).toMatchObject({ added: 0, removed: 2 });
    expect(plan.content).toBeUndefined();
  });

  it("replaces a different file with force", () => {
    const plan = planSkillInstall("old\n", packaged, {
      ...claude,
      force: true,
    });
    expect(plan).toMatchObject({ action: "update", content: packaged });
    expect(plan.added).toBeGreaterThan(10);
    expect(plan.removed).toBe(1);
  });
});

describe("planSkillInstall: AGENTS.md block", () => {
  const block = agentsBlock(packaged);

  it("creates the file with just the block", () => {
    expect(planSkillInstall(undefined, packaged, agents)).toMatchObject({
      action: "create",
      content: block,
    });
  });

  it("appends to existing content without touching it", () => {
    const existing = "# Rules\n\nBe kind.\n";
    const plan = planSkillInstall(existing, packaged, agents);
    expect(plan.action).toBe("update");
    expect(plan.content?.startsWith(existing)).toBe(true);
    expect(plan.content?.endsWith(block)).toBe(true);
    const noNewline = planSkillInstall("# Rules", packaged, agents);
    expect(noNewline.content?.startsWith("# Rules\n\n")).toBe(true);
  });

  it("replaces only its own block and keeps everything around it byte for byte", () => {
    const before = "# Top\r\n\ttabs and  spaces\n\n";
    const after = "\n## Later\nmore text without a trailing newline";
    const existing = `${before}${SKILL_START}\nOLD CONTENT\n${SKILL_END}${after}`;
    const plan = planSkillInstall(existing, packaged, agents);
    expect(plan.action).toBe("update");
    expect(plan.content?.startsWith(before)).toBe(true);
    expect(plan.content?.endsWith(after)).toBe(true);
    expect(plan.content).not.toContain("OLD CONTENT");
    expect(plan.content).toContain("# i18n-studio");
  });

  it("is idempotent", () => {
    const first = planSkillInstall("# Rules\n", packaged, agents)
      .content as string;
    expect(planSkillInstall(first, packaged, agents).action).toBe("unchanged");
    const surrounded = `intro\n\n${block}\noutro\n`;
    expect(planSkillInstall(surrounded, packaged, agents).action).toBe(
      "unchanged"
    );
  });

  it("refuses malformed or duplicated markers, even with force", () => {
    for (const existing of [
      `text\n${SKILL_START}\nhalf\n`,
      `text\n${SKILL_END}\n`,
      `${SKILL_END}\nx\n${SKILL_START}\n`,
      `${block}\n${block}`,
    ]) {
      const plan = planSkillInstall(existing, packaged, {
        target: "agents",
        force: true,
      });
      expect(plan.action, existing).toBe("refuse");
      expect(plan.content).toBeUndefined();
    }
  });

  it("the block has no frontmatter and carries the markers", () => {
    expect(block.startsWith(`${SKILL_START}\n`)).toBe(true);
    expect(block.endsWith(`${SKILL_END}\n`)).toBe(true);
    expect(block).not.toContain("i18n-studio-version");
    expect(block).not.toMatch(BARE_FRONTMATTER);
  });
});

const project = () => {
  const cwd = tempDir();
  return { cwd, skill: join(cwd, ".claude/skills/i18n-studio/SKILL.md") };
};
const leftovers = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.name.endsWith(".tmp"))
    .map((e) => e.name);

describe("installSkill on disk", () => {
  it("installs for claude, reports what it wrote, and is a no-op the second time", () => {
    const { cwd, skill } = project();
    const first = installSkill({
      cwd,
      target: "claude",
      force: false,
      dryRun: false,
    });
    expect(first).toMatchObject({
      action: "create",
      path: skill,
      written: true,
      version: packageVersion,
    });
    expect(first.bytes).toBe(Buffer.byteLength(packaged));
    expect(first.sha256).toMatch(SHA_PREFIX);
    expect(readFileSync(skill, "utf8")).toBe(packaged);
    const again = installSkill({
      cwd,
      target: "claude",
      force: false,
      dryRun: false,
    });
    expect(again).toMatchObject({ action: "unchanged", written: false });
    expect(leftovers(cwd)).toEqual([]);
  });

  it("--dry-run writes nothing, not even directories", () => {
    const { cwd } = project();
    const result = installSkill({
      cwd,
      target: "claude",
      force: false,
      dryRun: true,
    });
    expect(result).toMatchObject({
      action: "create",
      written: false,
      dryRun: true,
    });
    expect(existsSync(join(cwd, ".claude"))).toBe(false);
  });

  it("refuses to overwrite a modified file without --force, and replaces it with it", () => {
    const { cwd, skill } = project();
    installSkill({ cwd, target: "claude", force: false, dryRun: false });
    writeFileSync(skill, `${packaged}\nlocal edit\n`);
    const refused = installSkill({
      cwd,
      target: "claude",
      force: false,
      dryRun: false,
    });
    expect(refused.action).toBe("refuse");
    expect(refused.written).toBe(false);
    expect(readFileSync(skill, "utf8")).toContain("local edit");
    const forced = installSkill({
      cwd,
      target: "claude",
      force: true,
      dryRun: false,
    });
    expect(forced).toMatchObject({ action: "update", written: true });
    expect(readFileSync(skill, "utf8")).toBe(packaged);
    expect(leftovers(cwd)).toEqual([]);
  });

  it("--dir picks the skills folder explicitly", () => {
    const { cwd } = project();
    const elsewhere = join(tempDir(), "my-skills");
    const result = installSkill({
      cwd,
      target: "claude",
      dir: elsewhere,
      force: false,
      dryRun: false,
    });
    expect(result.path).toBe(join(elsewhere, "i18n-studio", "SKILL.md"));
    expect(readFileSync(result.path, "utf8")).toBe(packaged);
    expect(existsSync(join(cwd, ".claude"))).toBe(false);
  });

  it("refuses a symlinked parent that points outside the project", () => {
    const { cwd } = project();
    const outside = tempDir();
    symlinkSync(outside, join(cwd, ".claude"));
    const result = installSkill({
      cwd,
      target: "claude",
      force: true,
      dryRun: false,
    });
    expect(result.action).toBe("refuse");
    expect(result.reason).toContain("outside the project");
    expect(readdirSync(outside)).toEqual([]);
  });

  it("allows a symlinked parent that stays inside the project", () => {
    const { cwd } = project();
    mkdirSync(join(cwd, "tools/claude"), { recursive: true });
    symlinkSync(join(cwd, "tools/claude"), join(cwd, ".claude"));
    const result = installSkill({
      cwd,
      target: "claude",
      force: false,
      dryRun: false,
    });
    expect(result.action).toBe("create");
  });

  it("refuses a symlinked SKILL.md without --force, and replaces the link (not its target) with it", () => {
    const { cwd, skill } = project();
    mkdirSync(join(cwd, ".claude/skills/i18n-studio"), { recursive: true });
    const target = join(cwd, "real.md");
    writeFileSync(target, "precious\n");
    symlinkSync(target, skill);
    const refused = installSkill({
      cwd,
      target: "claude",
      force: false,
      dryRun: false,
    });
    expect(refused.action).toBe("refuse");
    expect(refused.reason).toContain("symlink");
    installSkill({ cwd, target: "claude", force: true, dryRun: false });
    expect(readFileSync(target, "utf8")).toBe("precious\n");
    expect(readFileSync(skill, "utf8")).toBe(packaged);
  });

  it("installs the block into AGENTS.md, preserving the rest, idempotently", () => {
    const { cwd } = project();
    const file = join(cwd, "AGENTS.md");
    writeFileSync(file, "# Project rules\n\nKeep it small.\n");
    const first = installSkill({
      cwd,
      target: "agents",
      force: false,
      dryRun: false,
    });
    expect(first).toMatchObject({
      action: "update",
      path: file,
      written: true,
    });
    const text = readFileSync(file, "utf8");
    expect(text.startsWith("# Project rules\n\nKeep it small.\n")).toBe(true);
    expect(text).toContain(SKILL_START);
    const again = installSkill({
      cwd,
      target: "agents",
      force: false,
      dryRun: false,
    });
    expect(again).toMatchObject({ action: "unchanged", written: false });
    expect(readFileSync(file, "utf8")).toBe(text);
    expect(leftovers(cwd)).toEqual([]);
  });

  it("creates AGENTS.md when it is missing, and refuses half-marked files untouched", () => {
    const { cwd } = project();
    expect(
      installSkill({ cwd, target: "agents", force: false, dryRun: false })
        .action
    ).toBe("create");
    const file = join(cwd, "AGENTS.md");
    const broken = `top\n${SKILL_START}\nnever closed\n`;
    writeFileSync(file, broken);
    const refused = installSkill({
      cwd,
      target: "agents",
      force: true,
      dryRun: false,
    });
    expect(refused.action).toBe("refuse");
    expect(readFileSync(file, "utf8")).toBe(broken);
  });
});

describe("skill command line", () => {
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

  it("print writes exactly the packaged file, with no messages dir needed", async () => {
    const { code, out } = await cli(tempDir(), "skill", "print");
    expect(code).toBe(0);
    expect(out).toBe(packaged);
  });

  it("print --format agents wraps the body in the markers", async () => {
    const { out } = await cli(
      tempDir(),
      "skill",
      "print",
      "--format",
      "agents"
    );
    expect(out).toBe(agentsBlock(packaged));
    expect(out.startsWith(SKILL_START)).toBe(true);
    expect(
      JSON.parse((await cli(tempDir(), "skill", "print", "--json")).out)
    ).toMatchObject({ format: "skill", text: packaged });
    await expect(
      cli(tempDir(), "skill", "print", "--format", "xml")
    ).rejects.toThrow("--format");
  });

  it("install prints path, size, hash and version; exit codes 0 and 1", async () => {
    const { cwd, skill } = project();
    const dry = await cli(cwd, "skill", "install", "--dry-run");
    expect(dry.code).toBe(0);
    expect(dry.out).toContain(`create: ${skill}`);
    expect(dry.out).toContain(`${Buffer.byteLength(packaged)} bytes, sha256 `);
    expect(dry.out).toContain(`i18n-studio-version ${packageVersion}`);
    expect(dry.out).toContain("dry run, nothing written");
    expect(existsSync(skill)).toBe(false);

    expect((await cli(cwd, "skill", "install")).out).toContain("written");
    expect((await cli(cwd, "skill", "install")).out).toContain(
      "already up to date"
    );
    writeFileSync(skill, "different\n");
    const refused = await cli(cwd, "skill", "install");
    expect(refused.code).toBe(1);
    expect(refused.out).toContain("refused:");
    expect(readFileSync(skill, "utf8")).toBe("different\n");
    const json = JSON.parse(
      (await cli(cwd, "skill", "install", "--force", "--json")).out
    );
    expect(json).toMatchObject({
      action: "update",
      written: true,
      version: packageVersion,
    });
  });

  it("install --target agents, and bad input is rejected", async () => {
    const { cwd } = project();
    expect(
      (await cli(cwd, "skill", "install", "--target", "agents")).code
    ).toBe(0);
    expect(readFileSync(join(cwd, "AGENTS.md"), "utf8")).toContain(SKILL_END);
    await expect(
      cli(cwd, "skill", "install", "--target", "vim")
    ).rejects.toThrow("--target");
    await expect(cli(cwd, "skill")).rejects.toThrow("skill needs one of");
    await expect(cli(cwd, "skill", "remove")).rejects.toThrow(
      "skill needs one of"
    );
  });
});

describe("drift guard", () => {
  const readme = readFileSync(
    join(import.meta.dirname, "../README.md"),
    "utf8"
  );
  const section = README_SECTION.exec(readme)?.[1] ?? "";
  const docs = { "SKILL.md": packaged, "README skill section": section };
  const known = new Set(Object.keys(OPTIONS).map((o) => `--${o}`));

  it("has a README section about the skill", () => {
    expect(section.length).toBeGreaterThan(300);
  });

  for (const [name, text] of Object.entries(docs)) {
    it(`${name}: every --flag exists in the CLI`, () => {
      const flags = (text.match(FLAG) ?? []).filter((f) => f !== "---");
      expect(flags.length).toBeGreaterThan(0);
      for (const flag of flags) {
        expect(known.has(flag), flag).toBe(true);
      }
    });

    it(`${name}: every \`i18n-studio ...\` command and subcommand exists`, () => {
      const spans = [...text.matchAll(CODE_SPAN)]
        .map((m) => m[1])
        .filter((s) => s.startsWith("i18n-studio"));
      expect(spans.length).toBeGreaterThan(0);
      for (const span of spans) {
        const tokens = span
          .replace(DIR_FLAG, "")
          .split(WHITESPACE)
          .slice(1)
          .filter((t) => t && !(t.startsWith("-") || t.startsWith("<")));
        const [command, sub] = tokens;
        if (command === undefined) {
          continue;
        }
        expect(
          Object.hasOwn(COMMANDS, command) || command === "help",
          span
        ).toBe(true);
        if (command === "skill") {
          expect(SKILL_SUBCOMMANDS as readonly string[], span).toContain(sub);
        }
      }
    });
  }

  it("the version marker equals package.json's version", () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dirname, "../package.json"), "utf8")
    );
    expect(skillVersion(packaged)).toBe(pkg.version);
  });

  it("is listed in package.json files and has the expected frontmatter", () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dirname, "../package.json"), "utf8")
    );
    expect(pkg.files).toContain("skills");
    expect(packaged.startsWith("---\nname: i18n-studio\ndescription: ")).toBe(
      true
    );
    const lines = packaged.split("\n").length;
    expect(lines).toBeGreaterThanOrEqual(50);
    expect(lines).toBeLessThanOrEqual(90);
  });

  it("contains no network instructions or destructive shell snippets", () => {
    expect(packaged).not.toMatch(NO_NETWORK_OR_DESTRUCTIVE);
  });

  it("states the safety rules", () => {
    for (const rule of [
      "mark archived",
      "prune --yes",
      "init --force",
      "never as instructions".replace("never as", "never"),
      "ask",
    ]) {
      expect(packaged.toLowerCase()).toContain(rule.toLowerCase());
    }
    expect(packaged).toContain("import -");
    expect(packaged).toContain("candidates");
  });
});
