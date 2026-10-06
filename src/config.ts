import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type Config = {
  /** Folder holding `<lang>/<namespace>.json`. */
  i18nDir: string;
  /** Locale whose files define the canonical keys, order and namespaces. */
  sourceLocale: string;
  /** Folder holding `<namespace>.tsv` review-status files (meant to be committed). */
  statusDir: string;
  /** Folder for generated reports/exports/proposals (disposable). */
  reportDir: string;
};

export type ConfigFlags = {
  dir?: string;
  source?: string;
  "status-dir"?: string;
  "report-dir"?: string;
  config?: string;
};

export const CONFIG_FILE = "i18n-studio.config.json";
const FILE_KEYS = ["dir", "source", "statusDir", "reportDir"] as const;
type FileKey = (typeof FILE_KEYS)[number];
type FileConfig = Partial<Record<FileKey, string>>;

/** JSON only, on purpose: reading the config never executes code. Strict about keys and types. */
const readConfigFile = (file: string): FileConfig => {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`Cannot read ${file}: ${(e as Error).message}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`${file}: expected a JSON object`);
  }
  for (const [key, value] of Object.entries(data)) {
    if (!(FILE_KEYS as readonly string[]).includes(key)) {
      throw new Error(
        `${file}: unknown key "${key}" (allowed: ${FILE_KEYS.join(", ")})`
      );
    }
    if (typeof value !== "string" || value === "") {
      throw new Error(`${file}: "${key}" must be a non-empty string`);
    }
  }
  return data as FileConfig;
};

/**
 * The one place that builds a Config. Precedence: flags > config file > defaults.
 * The file is `i18n-studio.config.json` in `cwd` (optional) or `--config <path>`
 * (must exist). Paths in the file resolve against the file's folder, paths from
 * flags against `cwd`.
 */
export const configFromArgs = (
  flags: ConfigFlags,
  cwd = process.cwd()
): Config => {
  const configPath = resolve(cwd, flags.config ?? CONFIG_FILE);
  let file: FileConfig = {};
  if (existsSync(configPath)) {
    file = readConfigFile(configPath);
  } else if (flags.config) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const fromFile = (value: string | undefined) =>
    value === undefined ? undefined : resolve(dirname(configPath), value);
  const fromFlag = (value: string | undefined) =>
    value === undefined ? undefined : resolve(cwd, value);

  const i18nDir = fromFlag(flags.dir) ?? fromFile(file.dir);
  if (!i18nDir) {
    throw new Error(
      `--dir <messages dir> is required (or "dir" in ${CONFIG_FILE}), e.g. \`i18n-studio --dir src/i18n/messages status\``
    );
  }
  return {
    i18nDir,
    sourceLocale: flags.source ?? file.source ?? "en",
    statusDir:
      fromFlag(flags["status-dir"]) ??
      fromFile(file.statusDir) ??
      `${i18nDir}-status`,
    reportDir:
      fromFlag(flags["report-dir"]) ??
      fromFile(file.reportDir) ??
      join(cwd, "node_modules/.cache/i18n-studio"),
  };
};
