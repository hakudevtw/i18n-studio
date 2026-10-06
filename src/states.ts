/** States that can be stored in the status files (built in). Custom ones come from config. */
export const BUILTIN_STORED = [
  "ai-draft",
  "in-review",
  "approved",
  "archived",
] as const;

/** States derived from the data, never stored. */
export const DERIVED_STATES = ["missing", "stale", "edited", "new"] as const;

/** Default set of states `export` includes. */
export const DEFAULT_EXPORT_STATES = [
  "ai-draft",
  "edited",
  "new",
  "stale",
  "missing",
];

/** Kinds of problems `check` reports. `status-file` always fails. */
export const PROBLEM_KINDS = [
  "status-file",
  "missing-key",
  "orphan-key",
  "empty",
  "order",
  "stale",
  "edited",
  "new",
  "ai-draft",
  "in-review",
] as const;
export type ProblemKind = (typeof PROBLEM_KINDS)[number];
