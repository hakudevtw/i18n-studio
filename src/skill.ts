import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { atomicWriteAll } from "./fsx.js";

export const SKILL_START = "<!-- i18n-studio:start -->";
export const SKILL_END = "<!-- i18n-studio:end -->";
export const SKILL_TARGETS = ["claude", "agents"] as const;
export type SkillTarget = (typeof SKILL_TARGETS)[number];
export const SKILL_FORMATS = ["skill", "agents"] as const;
export type SkillFormat = (typeof SKILL_FORMATS)[number];
export const SKILL_SUBCOMMANDS = ["print", "install"] as const;

const FRONTMATTER = /^---\n[\s\S]*?\n---\n+/;
const VERSION = /^i18n-studio-version:\s*(\S+)\s*$/m;

/** The one file this command can ever install: fixed relative to the package, never user-supplied. */
export const packagedSkillPath = () =>
  join(import.meta.dirname, "../skills/i18n-studio/SKILL.md");

export const readPackagedSkill = () =>
  readFileSync(packagedSkillPath(), "utf8");

export const skillVersion = (text: string) => VERSION.exec(text)?.[1];

/** The skill body wrapped in markers, for AGENTS.md / CLAUDE.md. Ends with a newline. */
export const agentsBlock = (skill: string) =>
  `${SKILL_START}\n${skill.replace(FRONTMATTER, "").trimEnd()}\n${SKILL_END}\n`;

export const renderSkill = (skill: string, format: SkillFormat) =>
  format === "agents" ? agentsBlock(skill) : skill;

export type SkillPlan = {
  action: "create" | "update" | "unchanged" | "refuse";
  /** The full file content to write (undefined when nothing is written). */
  content?: string;
  reason?: string;
  /** Line-level summary against the existing file. */
  added: number;
  removed: number;
};

const countLines = (text: string) => {
  const counts = new Map<string, number>();
  for (const line of text.split("\n")) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
};

/** Lines only in `next` / only in `old` (multiset difference; a summary, not a diff). */
export const lineSummary = (old: string, next: string) => {
  const before = countLines(old);
  const after = countLines(next);
  let added = 0;
  let removed = 0;
  for (const [line, n] of after) {
    added += Math.max(0, n - (before.get(line) ?? 0));
  }
  for (const [line, n] of before) {
    removed += Math.max(0, n - (after.get(line) ?? 0));
  }
  return { added, removed };
};

const refuse = (reason: string): SkillPlan => ({
  action: "refuse",
  reason,
  added: 0,
  removed: 0,
});

/** What to put between existing content and an appended block. */
const separator = (existing: string) => {
  if (existing === "") {
    return "";
  }
  return existing.endsWith("\n") ? "\n" : "\n\n";
};

const planBlock = (
  existing: string | undefined,
  packaged: string
): SkillPlan => {
  const block = agentsBlock(packaged);
  if (existing === undefined) {
    return {
      action: "create",
      content: block,
      added: block.split("\n").length - 1,
      removed: 0,
    };
  }
  const start = existing.indexOf(SKILL_START);
  const end = existing.indexOf(SKILL_END);
  if ((start === -1) !== (end === -1)) {
    return refuse(
      "only one of the i18n-studio markers is present; fix AGENTS.md by hand"
    );
  }
  if (
    start !== existing.lastIndexOf(SKILL_START) ||
    end !== existing.lastIndexOf(SKILL_END)
  ) {
    return refuse(
      "the i18n-studio markers appear more than once; fix AGENTS.md by hand"
    );
  }
  if (start === -1) {
    const gap = separator(existing);
    const content = `${existing}${gap}${block}`;
    return { action: "update", content, ...lineSummary(existing, content) };
  }
  if (end < start) {
    return refuse(
      "the i18n-studio end marker comes before the start marker; fix AGENTS.md by hand"
    );
  }
  const after = existing.slice(end + SKILL_END.length);
  const content = `${existing.slice(0, start)}${block.trimEnd()}${after}`;
  if (content === existing) {
    return { action: "unchanged", added: 0, removed: 0 };
  }
  return { action: "update", content, ...lineSummary(existing, content) };
};

/**
 * Decide what installing would do, without touching the disk. `existing` is the current
 * file (undefined when missing). A different SKILL.md is only replaced with `force`;
 * the marked block in AGENTS.md is the tool's own region and is updated in place.
 */
export const planSkillInstall = (
  existing: string | undefined,
  packaged: string,
  flags: { target: SkillTarget; force: boolean }
): SkillPlan => {
  if (flags.target === "agents") {
    return planBlock(existing, packaged);
  }
  if (existing === undefined) {
    return {
      action: "create",
      content: packaged,
      ...lineSummary("", packaged),
    };
  }
  if (existing === packaged) {
    return { action: "unchanged", added: 0, removed: 0 };
  }
  const summary = lineSummary(existing, packaged);
  if (!flags.force) {
    return {
      action: "refuse",
      reason: `a different file already exists (+${summary.added} / -${summary.removed} lines if replaced); review it, then use --force`,
      ...summary,
    };
  }
  return { action: "update", content: packaged, ...summary };
};

const within = (root: string, path: string) =>
  path === root || path.startsWith(`${root}${sep}`);

/** Throws when a symlink on the way from cwd to `file` leads outside cwd. */
const assertInsideCwd = (cwd: string, file: string) => {
  const root = realpathSync(cwd);
  let walk = resolve(file);
  const chain: string[] = [];
  while (walk !== resolve(cwd) && walk !== dirname(walk)) {
    chain.unshift(walk);
    walk = dirname(walk);
  }
  for (const part of chain) {
    if (!existsSync(part)) {
      break;
    }
    if (lstatSync(part).isSymbolicLink() && !within(root, realpathSync(part))) {
      throw new Error(
        `${part} is a symlink that points outside the project; refusing`
      );
    }
  }
};

export type SkillInstallOptions = {
  cwd: string;
  target: SkillTarget;
  /** Explicit directory: the skills dir (claude) or the folder holding AGENTS.md (agents). */
  dir?: string;
  force: boolean;
  dryRun: boolean;
};

export type SkillInstallResult = {
  action: SkillPlan["action"];
  path: string;
  bytes: number;
  sha256: string;
  version: string | undefined;
  written: boolean;
  dryRun: boolean;
  reason?: string;
  added: number;
  removed: number;
};

export const skillDestination = (
  o: Pick<SkillInstallOptions, "cwd" | "target" | "dir">
) => {
  if (o.target === "agents") {
    return join(o.dir ? resolve(o.cwd, o.dir) : o.cwd, "AGENTS.md");
  }
  const skills = o.dir
    ? resolve(o.cwd, o.dir)
    : join(o.cwd, ".claude", "skills");
  return join(skills, "i18n-studio", "SKILL.md");
};

/** Plan (and, unless dry run, perform) an install. Never called implicitly. */
export const installSkill = (o: SkillInstallOptions): SkillInstallResult => {
  const packaged = readPackagedSkill();
  const path = skillDestination(o);
  let unsafe: string | undefined;
  if (!o.dir) {
    try {
      assertInsideCwd(o.cwd, path);
    } catch (e) {
      unsafe = (e as Error).message;
    }
  }
  const linked =
    !unsafe && existsSync(path) && lstatSync(path).isSymbolicLink();
  const existing =
    !unsafe && existsSync(path) ? readFileSync(path, "utf8") : undefined;
  let plan = unsafe ? refuse(unsafe) : planSkillInstall(existing, packaged, o);
  if (linked && !o.force) {
    plan = refuse(`${path} is a symlink; use --force to replace it`);
  }
  const shown = o.target === "agents" ? agentsBlock(packaged) : packaged;
  const write = plan.content !== undefined && !o.dryRun;
  if (write) {
    atomicWriteAll([{ path, content: plan.content as string }]);
  }
  return {
    action: plan.action,
    path,
    bytes: Buffer.byteLength(shown),
    sha256: createHash("sha256").update(shown).digest("hex").slice(0, 12),
    version: skillVersion(packaged),
    written: write,
    dryRun: o.dryRun,
    reason: plan.reason,
    added: plan.added,
    removed: plan.removed,
  };
};
