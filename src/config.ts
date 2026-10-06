import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { UI_LOCALES, type UiLocaleSetting } from "./model.js";
import {
  BUILTIN_STORED,
  DEFAULT_EXPORT_STATES,
  DERIVED_STATES,
  PROBLEM_KINDS,
} from "./states.js";

export type Indent = number | "tab" | "auto";

export type Config = {
  /** Folder holding `<lang>/<namespace>.json`. */
  i18nDir: string;
  /** Locale whose files define the canonical keys, order and namespaces. */
  sourceLocale: string;
  /** Folder holding `<namespace>.tsv` review-status files (meant to be committed). */
  statusDir: string;
  /** Folder for generated reports/exports/proposals (disposable). */
  reportDir: string;
  /** Studio "Copy as TSV" starts with a header row. */
  copyHeader: boolean;
  /** Studio port; unset = start at 4321 and walk up if taken. */
  port?: number;
  /** Problem kinds that make `check` exit 1 (`status-file` always does). */
  failOn: string[];
  /** Globs over `<namespace>.<dotted.path>` for keys that may stay empty/untranslated. */
  ignoreKeys: string[];
  /** States `export` includes by default. */
  exportStates: string[];
  /** Extra stored states (kebab-case labels). */
  customStates: string[];
  localeOrder: string[];
  excludeLocales: string[];
  namespaceOrder: string[];
  excludeNamespaces: string[];
  indent: Indent;
  /** Language of the studio/report page; "auto" follows the browser. */
  uiLocale: UiLocaleSetting;
};

export const DEFAULTS = {
  sourceLocale: "en",
  copyHeader: true,
  failOn: ["status-file"],
  ignoreKeys: [],
  exportStates: DEFAULT_EXPORT_STATES,
  customStates: [],
  localeOrder: [],
  excludeLocales: [],
  namespaceOrder: [],
  excludeNamespaces: [],
  indent: "auto",
  uiLocale: "auto",
} as const satisfies Partial<Record<keyof Config, unknown>>;

export type ConfigFlags = {
  dir?: string;
  source?: string;
  "status-dir"?: string;
  "report-dir"?: string;
  config?: string;
  "copy-header"?: boolean;
  port?: string;
  "fail-on"?: string;
  indent?: string;
  "ui-lang"?: string;
};

export const CONFIG_FILE = "i18n-studio.config.json";

type Kind = "string" | "boolean" | "port" | "strings" | "indent" | "uiLocale";
/** Config-file keys and their types. Anything else is rejected. */
const FILE_SCHEMA: Record<string, Kind> = {
  dir: "string",
  source: "string",
  statusDir: "string",
  reportDir: "string",
  copyHeader: "boolean",
  port: "port",
  failOn: "strings",
  ignoreKeys: "strings",
  exportStates: "strings",
  customStates: "strings",
  localeOrder: "strings",
  excludeLocales: "strings",
  namespaceOrder: "strings",
  excludeNamespaces: "strings",
  indent: "indent",
  uiLocale: "uiLocale",
};

const DIGITS = /^\d+$/;
const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const MAX_PORT = 65_535;
const MAX_INDENT = 8;

const isPort = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_PORT;
const isIndent = (v: unknown): v is Indent =>
  v === "tab" ||
  v === "auto" ||
  (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_INDENT);

const isUiLocale = (v: unknown): v is UiLocaleSetting =>
  v === "auto" || (UI_LOCALES as readonly unknown[]).includes(v);

const VALID: Record<Kind, (v: unknown) => boolean> = {
  uiLocale: isUiLocale,
  string: (v) => typeof v === "string" && v !== "",
  boolean: (v) => typeof v === "boolean",
  port: isPort,
  strings: (v) =>
    Array.isArray(v) && v.every((x) => typeof x === "string" && x !== ""),
  indent: isIndent,
};
const EXPECTED: Record<Kind, string> = {
  uiLocale: `"auto" or one of ${UI_LOCALES.join(", ")}`,
  string: "a non-empty string",
  boolean: "true or false",
  port: "an integer between 0 and 65535",
  strings: "an array of non-empty strings",
  indent: 'a number 1-8, "tab" or "auto"',
};

type Values = Record<string, unknown>;

/** JSON only, on purpose: reading the config never executes code. Strict about keys and types. */
const readConfigFile = (file: string): Values => {
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
    const kind = FILE_SCHEMA[key];
    if (!kind) {
      throw new Error(
        `${file}: unknown key "${key}" (allowed: ${Object.keys(FILE_SCHEMA).join(", ")})`
      );
    }
    if (!VALID[kind](value)) {
      throw new Error(`${file}: "${key}" must be ${EXPECTED[kind]}`);
    }
  }
  return data as Values;
};

const flagValues = (flags: ConfigFlags): Values => {
  const out: Values = {};
  if (flags.source !== undefined) {
    out.source = flags.source;
  }
  if (flags["copy-header"] !== undefined) {
    out.copyHeader = flags["copy-header"];
  }
  if (flags.port !== undefined) {
    out.port = Number(flags.port);
    if (!isPort(out.port)) {
      throw new Error(`--port must be ${EXPECTED.port}`);
    }
  }
  if (flags["fail-on"] !== undefined) {
    out.failOn = flags["fail-on"]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (flags.indent !== undefined) {
    out.indent = DIGITS.test(flags.indent)
      ? Number(flags.indent)
      : flags.indent;
    if (!isIndent(out.indent)) {
      throw new Error(`--indent must be ${EXPECTED.indent}`);
    }
  }
  if (flags["ui-lang"] !== undefined) {
    out.uiLocale = flags["ui-lang"];
    if (!isUiLocale(out.uiLocale)) {
      throw new Error(`--ui-lang must be ${EXPECTED.uiLocale}`);
    }
  }
  return out;
};

const unknownNames = (label: string, names: string[], allowed: string[]) => {
  const bad = names.filter((n) => !allowed.includes(n));
  if (bad.length > 0) {
    throw new Error(
      `${label}: unknown value(s) ${bad.join(", ")} (allowed: ${allowed.join(", ")})`
    );
  }
};

const validateStates = (c: Config) => {
  for (const name of c.customStates) {
    const taken = [...BUILTIN_STORED, ...DERIVED_STATES] as string[];
    if (!KEBAB.test(name) || taken.includes(name)) {
      throw new Error(
        `customStates: "${name}" must be kebab-case and not a built-in state (${taken.join(", ")})`
      );
    }
  }
  const known = [...BUILTIN_STORED, ...DERIVED_STATES, ...c.customStates];
  unknownNames("exportStates", c.exportStates, known);
  unknownNames("failOn", c.failOn, [...PROBLEM_KINDS]);
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
  let file: Values = {};
  if (existsSync(configPath)) {
    file = readConfigFile(configPath);
  } else if (flags.config) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const opts: Values = { ...file, ...flagValues(flags) };
  const path = (flag: string | undefined, key: string) => {
    if (flag !== undefined) {
      return resolve(cwd, flag);
    }
    const value = file[key] as string | undefined;
    return value === undefined
      ? undefined
      : resolve(dirname(configPath), value);
  };

  const i18nDir = path(flags.dir, "dir");
  if (!i18nDir) {
    throw new Error(
      `--dir <messages dir> is required (or "dir" in ${CONFIG_FILE}), e.g. \`i18n-studio --dir src/i18n/messages status\``
    );
  }
  const pick = <K extends keyof typeof DEFAULTS>(key: string, name: K) =>
    (opts[key] ?? DEFAULTS[name]) as Config[K & keyof Config];
  const config: Config = {
    i18nDir,
    sourceLocale: pick("source", "sourceLocale"),
    statusDir: path(flags["status-dir"], "statusDir") ?? `${i18nDir}-status`,
    reportDir:
      path(flags["report-dir"], "reportDir") ??
      join(cwd, "node_modules/.cache/i18n-studio"),
    copyHeader: pick("copyHeader", "copyHeader"),
    port: opts.port as number | undefined,
    failOn: [...new Set(["status-file", ...pick("failOn", "failOn")])],
    ignoreKeys: pick("ignoreKeys", "ignoreKeys"),
    exportStates: pick("exportStates", "exportStates"),
    customStates: pick("customStates", "customStates"),
    localeOrder: pick("localeOrder", "localeOrder"),
    excludeLocales: pick("excludeLocales", "excludeLocales"),
    namespaceOrder: pick("namespaceOrder", "namespaceOrder"),
    excludeNamespaces: pick("excludeNamespaces", "excludeNamespaces"),
    indent: pick("indent", "indent"),
    uiLocale: pick("uiLocale", "uiLocale"),
  };
  validateStates(config);
  return config;
};

/** Config with every optional setting at its default; handy for tests and embedding. */
export const baseConfig = (
  paths: Pick<Config, "i18nDir" | "statusDir" | "reportDir">,
  overrides: Partial<Config> = {}
): Config => ({
  ...paths,
  sourceLocale: DEFAULTS.sourceLocale,
  copyHeader: DEFAULTS.copyHeader,
  failOn: [...DEFAULTS.failOn],
  ignoreKeys: [],
  exportStates: [...DEFAULTS.exportStates],
  customStates: [],
  localeOrder: [],
  excludeLocales: [],
  namespaceOrder: [],
  excludeNamespaces: [],
  indent: DEFAULTS.indent,
  uiLocale: DEFAULTS.uiLocale,
  ...overrides,
});
