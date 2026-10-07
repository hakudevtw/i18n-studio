/** Shared between the Node side (server, static report) and the browser UI. Types only plus constants. */

export const UI_LOCALES = ["en", "ko", "zh-TW", "ja"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];
/** `auto` picks from the browser language. */
export type UiLocaleSetting = UiLocale | "auto";

export type ModelCell = {
  text: string;
  /** Previous value; rendered struck through before `text` (proposal diffs). */
  old?: string;
  /** Highlight: the value differs from the recorded state or from a proposal. */
  changed?: boolean;
  /** Why it is highlighted (the UI translates this into a tooltip). */
  mark?: "changed" | "proposed";
};

export type ModelRow = {
  /** Sidebar group, normally the namespace. */
  group: string;
  key: string;
  /** One badge per row. */
  status: string;
  cells: ModelCell[];
};

/** Banners are structured so the UI can translate them. */
export type Banner =
  | { kind: "noRecords" }
  | {
      kind: "proposal";
      changed: number;
      pending: number;
      confirmed: number;
      manual: number;
    };

export type Model = {
  /** English title (used for the static page's <title>; the UI translates its own). */
  title: string;
  /** Headers for `cells` (locales). */
  columns: string[];
  rows: ModelRow[];
  banners: Banner[];
  /** "Copy as TSV" starts with a header row unless false. */
  copyHeader: boolean;
  uiLocale: UiLocaleSetting;
  /** The server refuses writes (config `readOnly`); the static report is always read-only. */
  readOnly: boolean;
  /** Show the language select in the top bar (config `languageSwitcher`). */
  languageSwitcher: boolean;
  /** Keep unsaved edits in the browser (config `persistDrafts`). */
  persistDrafts: boolean;
  /** First 12 hex of sha256(messages dir): keys the browser draft; the path itself never leaves the server. */
  projectId: string;
  /** Initial state of the "Show archived" toggle (the page does not remember changes). */
  showArchived: boolean;
  /** States a row can be set to (built in plus custom); never derived ones. */
  storedStates: string[];
};

/** `POST /api/save` request. Every field is a string; ids are `<namespace>.<dotted.key>`. */
export type SaveEdit = {
  id: string;
  lang: string;
  /** The value the client saw; the save is refused (409) when disk differs. */
  expectedOld: string;
  new: string;
};
export type SaveStatusChange = {
  id: string;
  /** A stored state: built in or a configured custom state. */
  state: string;
  /** The derived state the client saw; refused (409) when it differs now. */
  expectedState: string;
};
/** Permanently delete an archived row from every language and from the status file. */
export type SavePrune = { id: string };
/** `prune` is sent on its own: a batch either edits or deletes, never both. */
export type SavePayload = {
  edits: SaveEdit[];
  statuses: SaveStatusChange[];
  prune?: SavePrune[];
};

export type SaveConflict = {
  id: string;
  lang?: string;
  kind: "value" | "state";
  /** What is on disk now. */
  current: string;
};

export type SaveResult = {
  ok: true;
  /** `deleted` is set only on a prune batch. */
  written: { files: number; cells: number; deleted?: number };
  /** Rows of other languages that became stale because the source locale was edited. */
  staleRows: number;
  warnings: string[];
  model: Model;
};
