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
};
