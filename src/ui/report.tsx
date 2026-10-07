import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import {
  type Banner,
  type Model,
  type ModelRow,
  UI_LOCALES,
  type UiLocale,
} from "../model";
import { ApiError, fetchModel, saveBatch } from "./api";
import { ConfirmDialog, ManualCopyDialog, ShortcutsDialog } from "./dialogs";
import { type Restored, relativeTime } from "./draft";
import { Changed, type Editing, Grid, type GridActions } from "./grid";
import type { Translator } from "./i18n";
import { MenuLayer, type MenuTarget } from "./menu";
import { clampSel, type Move, move, type Sel } from "./nav";
import {
  cellKey,
  countStaged,
  hasConflicts,
  hasSourceEdits,
  listStaged,
  rowId,
  type Staged,
  type StagedAction,
  type StagedEntry,
  stagedReducer,
  staleRowCount,
  toPayload,
  truncate,
} from "./staged";
import {
  applyTheme,
  readTheme,
  saveTheme,
  systemTheme,
  type Theme,
  watchSystemTheme,
} from "./theme";
import { tsvText } from "./tsv";
import { usePersistDraft, useRestoredDraft } from "./use-draft";
import { diffWords } from "./word-diff";

const TYPING = /^(INPUT|TEXTAREA|SELECT)$/;

/** A one-line list entry can show an inline word diff, never the stacked rewrite. */
const diffable = (from: string, to: string, lang?: string) =>
  diffWords(from, to, lang) !== null;

const SunIcon = () => (
  <svg
    aria-hidden="true"
    fill="none"
    height="16"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-width="2"
    viewBox="0 0 24 24"
    width="16"
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

const MoonIcon = () => (
  <svg
    aria-hidden="true"
    fill="none"
    height="16"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    stroke-width="2"
    viewBox="0 0 24 24"
    width="16"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);
const COPY_RESET_MS = 1500;
const TOAST_MS = 4000;
const DERIVED = ["missing", "stale", "edited", "new"];
const LOCALE_NAMES: Record<UiLocale, string> = {
  en: "English",
  ko: "한국어",
  "zh-TW": "繁體中文",
  ja: "日本語",
};
const MOVES: Record<string, Move> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Home: "home",
  End: "end",
  PageUp: "pageUp",
  PageDown: "pageDown",
};

const bannerText = (b: Banner, { t }: Translator) => {
  if (b.kind === "noRecords") {
    return t("banner.noRecords");
  }
  const parts = (
    [
      ["banner.changed", b.changed],
      ["banner.pending", b.pending],
      ["banner.confirmed", b.confirmed],
      ["banner.manual", b.manual],
    ] as const
  )
    .filter(([, n]) => n > 0)
    .map(([key, n]) => t(key, { n }));
  return t("banner.proposal", { parts: parts.join(", ") });
};

/** Clipboard API, with the legacy textarea path for viewers that block it. */
const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  const ta = document.createElement("textarea");
  ta.className = "offscreen";
  ta.value = text;
  ta.readOnly = true;
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    // blocked
  }
  ta.remove();
  return ok;
};

const groupFromHash = (groups: string[]) => {
  const wanted = decodeURIComponent(location.hash.slice(1));
  return groups.includes(wanted) ? wanted : "";
};

const matches = (r: ModelRow, q: string, cols: number[]) =>
  !q ||
  r.key.toLowerCase().includes(q) ||
  cols.some((i) => {
    const c = r.cells[i];
    return c && `${c.text}${c.old ?? ""}`.toLowerCase().includes(q);
  });

type Problem = {
  kind: "conflict" | "forbidden" | "tooLarge" | "invalid" | "network";
  message: string;
};

const problemOf = (e: unknown): Problem => {
  if (!(e instanceof ApiError)) {
    return { kind: "network", message: (e as Error).message };
  }
  const kinds: Record<number, Problem["kind"]> = {
    403: "forbidden",
    409: "conflict",
    413: "tooLarge",
  };
  return { kind: kinds[e.status] ?? "invalid", message: e.message };
};

type Confirm = { kind: "discard" | "source"; n: number };
type CopyState = "copy" | "copied" | "copyBlocked";

type ReportProps = {
  model: Model;
  tr: Translator;
  locale: UiLocale;
  onLocale: (locale: UiLocale) => void;
  onModel: (model: Model) => void;
};

export const Report = ({
  model,
  tr,
  locale,
  onLocale,
  onModel,
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one component owns the studio state
}: ReportProps) => {
  const { t, tn, has } = tr;
  const writable = !model.readOnly;
  const source = model.columns[0];
  const [q, setQ] = useState("");
  const [theme, setTheme] = useState<Theme>(() => readTheme() ?? systemTheme());
  useEffect(
    () =>
      watchSystemTheme((next) => {
        if (!readTheme()) {
          setTheme(next);
        }
      }),
    []
  );
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    saveTheme(next);
    applyTheme(next);
    setTheme(next);
  };
  const [status, setStatus] = useState("");
  const [lang, setLang] = useState("");
  const [showArchived, setShowArchived] = useState(model.showArchived);
  const groups = useMemo(
    () => [...new Set(model.rows.map((r) => r.group))],
    [model]
  );
  const statuses = useMemo(
    () => [...new Set(model.rows.map((r) => r.status))],
    [model]
  );
  const [group, setGroup] = useState(() => groupFromHash(groups));
  const [copyState, setCopyState] = useState<CopyState>("copy");
  const [manual, setManual] = useState<string | null>(null);
  const draft = useRestoredDraft({
    enabled: writable && model.persistDrafts,
    projectId: model.projectId,
    rows: model.rows,
    columns: model.columns,
  });
  const [staged, setStaged] = useState<Staged>(draft.staged);
  const stagedRef = useRef(staged);
  const [draftNote, setDraftNote] = useState<Restored | null>(
    draft.restored + draft.dropped > 0 ? draft : null
  );
  const savedAgo = useMemo(
    () => relativeTime(draft.savedAt, Date.now(), locale),
    [draft.savedAt, locale]
  );
  const persistence = usePersistDraft({
    enabled: writable && model.persistDrafts,
    projectId: model.projectId,
    staged,
    latest: stagedRef,
  });
  const [editing, setEditing] = useState<Editing | null>(null);
  const editingRef = useRef<Editing | null>(null);
  const cancelled = useRef(false);
  const [sel, setSel] = useState<Sel | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const menuFor = menu?.id ?? null;
  const [details, setDetails] = useState(false);
  // State, not a ref: a jump within the current view changes nothing else, and
  // still has to re-render so the effect below can select and reveal the cell.
  const [jump, setJump] = useState<{ id: string; lang?: string } | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkState, setBulkState] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [saving, setSaving] = useState(false);
  const [help, setHelp] = useState(false);
  const gridRef = useRef<HTMLTableElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const statusLabel = (s: string) =>
    has(`status.${s}`) ? t(`status.${s}`) : s;
  const groupLabel = (g: string) =>
    has(`groupName.${g}`) ? t(`groupName.${g}`) : g;
  const isReal = (s: string) =>
    model.storedStates.includes(s) || DERIVED.includes(s);
  const editable = (r: ModelRow) =>
    writable && isReal(r.status) && r.status !== "archived";
  const statusEditable = (r: ModelRow) => writable && isReal(r.status);

  const cols = model.columns
    .map((_, i) => i)
    .filter((i) => lang === "" || String(i) === lang);
  const needle = q.toLowerCase();
  const base = model.rows.filter(
    (r) =>
      (showArchived || status === "archived" || r.status !== "archived") &&
      (!status || r.status === status) &&
      matches(r, needle, cols)
  );
  const visible = base.filter((r) => !group || r.group === group);
  const dims = { rows: visible.length, cols: cols.length + 1 };
  const count = countStaged(staged);

  const apply = (action: StagedAction) => {
    stagedRef.current = stagedReducer(stagedRef.current, action);
    setStaged(stagedRef.current);
  };
  const focusGrid = () => gridRef.current?.focus({ preventScroll: true });

  const startEdit = (rowIdx: number, col: number) => {
    const row = visible[rowIdx];
    if (!row) {
      return;
    }
    if (col === 0) {
      const cell = document.getElementById(`cell-${rowIdx}-0`);
      if (statusEditable(row) && cell) {
        setMenu({
          id: rowId(row),
          rect: cell.getBoundingClientRect(),
          trigger: null,
        });
      }
      return;
    }
    if (!editable(row)) {
      return;
    }
    const modelCol = cols[col - 1];
    const lang_ = model.columns[modelCol];
    const cell = row.cells[modelCol];
    const staged_ = stagedRef.current.cells[cellKey(rowId(row), lang_)];
    cancelled.current = false;
    const next: Editing = {
      id: rowId(row),
      lang: lang_,
      original: staged_?.original ?? cell?.old ?? cell?.text ?? "",
      value: staged_?.current ?? cell?.text ?? "",
    };
    editingRef.current = next;
    setEditing(next);
    setSel({ row: rowIdx, col });
  };

  const commit = (value: string, then?: Move) => {
    const ed = editingRef.current;
    if (!ed || cancelled.current) {
      return;
    }
    editingRef.current = null;
    setEditing(null);
    apply({
      type: "edit",
      id: ed.id,
      lang: ed.lang,
      original: ed.original,
      value,
    });
    if (then) {
      setSel(move(sel, then, dims));
    }
    focusGrid();
  };
  const cancel = () => {
    cancelled.current = true;
    editingRef.current = null;
    setEditing(null);
    focusGrid();
  };

  const stageStatus = (id: string, state: string, expectedState: string) =>
    apply({ type: "status", id, state, expectedState });

  const send = async (s: Staged) => {
    setSaving(true);
    setProblem(null);
    try {
      const result = await saveBatch(toPayload(s));
      apply({ type: "discard" });
      setSelected(new Set());
      onModel(result.model);
      const stale =
        result.staleRows > 0 ? ` ${tn("toast.stale", result.staleRows)}` : "";
      setToast(`${tn("toast.saved", countStaged(s))}.${stale}`);
    } catch (e) {
      const p = problemOf(e);
      setProblem(p);
      if (e instanceof ApiError && e.status === 409) {
        apply({ type: "conflicts", conflicts: e.conflicts ?? [] });
        fetchModel().then(onModel, () => {
          // keep the model we have; the conflict banner is already shown
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const save = async (confirmedSource = false) => {
    if (saving || !writable) {
      return;
    }
    const open = editingRef.current;
    if (open) {
      commit(open.value); // an open editor counts: commit it before building the batch
    }
    const s = stagedRef.current;
    if (countStaged(s) === 0) {
      return;
    }
    if (hasConflicts(s)) {
      setProblem({ kind: "conflict", message: "" });
      return;
    }
    if (!confirmedSource && hasSourceEdits(s, source)) {
      setConfirm({
        kind: "source",
        n: staleRowCount(model.rows, s, source, model.columns),
      });
      return;
    }
    await send(s);
  };

  const activate = (at: Sel) => startEdit(at.row, at.col);
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  const toggleAll = () => {
    const ids = visible.filter(statusEditable).map(rowId);
    setSelected((prev) => {
      const all = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of ids) {
        if (all) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return next;
    });
  };

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: flat key map
  const onGridKeyDown = (e: KeyboardEvent) => {
    const typing = (e.target as HTMLElement).tagName === "TEXTAREA";
    if (editingRef.current || typing || e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }
    const step =
      MOVES[e.key] ??
      (e.key === "Tab" ? (e.shiftKey ? "prev" : "next") : undefined);
    if (step) {
      const next = move(sel, step, dims);
      const stays = next && sel && next.row === sel.row && next.col === sel.col;
      if (!(e.key === "Tab" && stays)) {
        e.preventDefault();
      }
      setSel(next);
    } else if ((e.key === "Enter" || e.key === "F2") && sel) {
      e.preventDefault();
      activate(sel);
    } else if (e.key === " " && sel && visible[sel.row]) {
      e.preventDefault();
      if (statusEditable(visible[sel.row])) {
        toggle(rowId(visible[sel.row]));
      }
    } else if (e.key === "Escape") {
      setMenu(null);
    }
  };

  // Global shortcuts use the latest closures through a ref (registered once).
  const latest = useRef({ save, setHelp, writable });
  latest.current = { save, setHelp, writable };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        latest.current.save();
        return;
      }
      const target = e.target as HTMLElement;
      const typing = TYPING.test(target.tagName);
      if (
        latest.current.writable &&
        (e.key === "?" || (e.key === "/" && e.shiftKey)) &&
        !typing &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
        e.preventDefault();
        latest.current.setHelp(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (count === 0) {
      return;
    }
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [count]);

  // Close the status menu and give focus back to what opened it.
  const closeMenu = useCallback(() => {
    const open = menuRef.current;
    setMenu(null);
    (open?.trigger ?? gridRef.current)?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (count === 0) {
      setDetails(false);
    }
  }, [count]);

  // Jump from the pending list: reveal the row (clear filters), then select the cell.
  useEffect(() => {
    if (!jump) {
      return;
    }
    const at = visible.findIndex((r) => rowId(r) === jump.id);
    if (at === -1) {
      return;
    }
    setJump(null);
    const modelCol = jump.lang ? model.columns.indexOf(jump.lang) : -1;
    const col = Math.max(0, jump.lang ? cols.indexOf(modelCol) + 1 : 0);
    setSel({ row: at, col });
    focusGrid();
    // Centred, so the open pending list does not cover it; also when the
    // selection did not change and the scroll effect would not run.
    document
      .getElementById(`cell-${at}-${col}`)
      ?.scrollIntoView({ block: "center", inline: "nearest" });
  });

  useEffect(() => {
    if (toast === null) {
      return;
    }
    const id = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  // The grid can shrink under the selection (filters, saving): keep it inside.
  useEffect(() => {
    const next = clampSel(sel, dims);
    if (next?.row !== sel?.row || next?.col !== sel?.col) {
      setSel(next);
    }
  }, [dims.rows, dims.cols]);
  useEffect(() => {
    if (sel) {
      document
        .getElementById(`cell-${sel.row}-${sel.col}`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [sel?.row, sel?.col]);

  const pick = (g: string) => {
    setGroup(g);
    history.replaceState(
      null,
      "",
      g ? `#${encodeURIComponent(g)}` : location.pathname
    );
    scrollRef.current?.scrollTo(0, 0);
  };

  const copy = async () => {
    const overlay = visible.map((r) => ({
      ...r,
      status: stagedRef.current.statuses[rowId(r)]?.state ?? r.status,
      cells: r.cells.map((c, i) => ({
        ...c,
        text:
          stagedRef.current.cells[cellKey(rowId(r), model.columns[i])]
            ?.current ?? c.text,
      })),
    }));
    const text = tsvText(overlay, model.columns, cols, model.copyHeader);
    const ok = await copyText(text);
    if (!ok) {
      setManual(text);
    }
    setCopyState(ok ? "copied" : "copyBlocked");
    setTimeout(() => setCopyState("copy"), COPY_RESET_MS);
  };

  const bulk = () => {
    if (!bulkState) {
      return;
    }
    for (const r of model.rows) {
      if (selected.has(rowId(r)) && statusEditable(r)) {
        stageStatus(rowId(r), bulkState, r.status);
      }
    }
    setSelected(new Set());
  };

  const actions: GridActions = {
    select: (at) => {
      setSel(at);
      focusGrid();
    },
    edit: startEdit,
    input: (value) => {
      if (editingRef.current) {
        editingRef.current = { ...editingRef.current, value };
        setEditing(editingRef.current);
      }
    },
    commit,
    cancel,
    keyDown: onGridKeyDown,
    menu: (target) => (target ? setMenu(target) : closeMenu()),
    status: stageStatus,
    toggle,
    toggleAll,
    keep: (key) => apply({ type: "keepMine", key }),
    theirs: (key) => apply({ type: "useTheirs", key }),
  };

  const menuRow = menu
    ? model.rows.find((r) => rowId(r) === menu.id)
    : undefined;
  const entryText = (kind: "cell" | "status", value: string) =>
    kind === "status" ? statusLabel(value) : truncate(value);
  const jumpTo = (id: string, language?: string) => {
    const row = model.rows.find((r) => rowId(r) === id);
    if (!row) {
      return;
    }
    setQ("");
    setStatus("");
    setLang("");
    setShowArchived(true);
    pick(row.group);
    setJump({ id, lang: language });
  };
  const revert = (entry: StagedEntry) =>
    entry.kind === "cell"
      ? apply({
          type: "edit",
          id: entry.id,
          lang: entry.lang ?? "",
          original: entry.from,
          value: entry.from,
        })
      : apply({
          type: "status",
          id: entry.id,
          state: entry.from,
          expectedState: entry.from,
        });

  // Groups holding unsaved changes, marked in the sidebar.
  const dirtyGroups = new Set(
    listStaged(staged).flatMap((entry) => {
      const row = model.rows.find((r) => rowId(r) === entry.id);
      return row ? [row.group] : [];
    })
  );

  const banner = model.banners.map((b) => bannerText(b, tr)).join(" ");
  const problemText =
    problem &&
    {
      conflict: t("error.conflict"),
      forbidden: t("error.forbidden"),
      tooLarge: t("error.tooLarge"),
      invalid: t("error.invalid", { message: problem.message }),
      network: t("error.network", { message: problem.message }),
    }[problem.kind];

  return (
    <>
      <aside>
        <h1>{t("title")}</h1>
        <ul id="side">
          {["", ...groups].map((g) => {
            const n = base.filter((r) => !g || r.group === g).length;
            const dirty = g ? dirtyGroups.has(g) : dirtyGroups.size > 0;
            return (
              <li key={g}>
                <button
                  aria-current={g === group}
                  class={n === 0 ? "zero" : ""}
                  onClick={() => pick(g)}
                  type="button"
                >
                  <span>
                    {g ? groupLabel(g) : t("sidebar.all")}
                    {dirty && (
                      <span
                        aria-label={t("sidebar.pending")}
                        class="dot"
                        role="img"
                        title={t("sidebar.pending")}
                      />
                    )}
                  </span>
                  <span class="n">{n}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <main>
        <div class="bar">
          <div class="bar-title">
            <h2>{group ? groupLabel(group) : t("sidebar.all")}</h2>
            <span id="count">
              {group
                ? t("rows", { n: visible.length })
                : t("rowsInGroups", { n: visible.length, g: groups.length })}
            </span>
          </div>
          <div class="bar-actions">
            {model.languageSwitcher && (
              <select
                aria-label={t("lang.switcher")}
                class="lang-switcher"
                onChange={(e) =>
                  onLocale((e.target as HTMLSelectElement).value as UiLocale)
                }
                value={locale}
              >
                {UI_LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {LOCALE_NAMES[l]}
                  </option>
                ))}
              </select>
            )}
            <button
              aria-label={t(
                theme === "dark" ? "theme.toLight" : "theme.toDark"
              )}
              class="act icon"
              onClick={toggleTheme}
              title={t(theme === "dark" ? "theme.toLight" : "theme.toDark")}
              type="button"
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
            {writable && (
              <button
                aria-label={t("help.button")}
                class="act icon"
                onClick={() => setHelp(true)}
                title={t("help.button")}
                type="button"
              >
                ?
              </button>
            )}
          </div>
        </div>
        {banner && <div id="banner">{banner}</div>}
        {draftNote && count > 0 && (
          <div aria-live="polite" class="note" id="draft">
            <span>
              {[
                draftNote.restored > 0 &&
                  tn("draft.restored", draftNote.restored, { when: savedAgo }),
                draftNote.conflicts > 0 &&
                  tn("draft.conflicts", draftNote.conflicts),
                draftNote.dropped > 0 && tn("draft.dropped", draftNote.dropped),
              ]
                .filter(Boolean)
                .join(" ")}
            </span>
            <button
              class="mini"
              onClick={() => setConfirm({ kind: "discard", n: count })}
              type="button"
            >
              {t("bar.discard")}
            </button>
            <button
              class="mini"
              onClick={() => setDraftNote(null)}
              type="button"
            >
              {t("draft.dismiss")}
            </button>
          </div>
        )}
        {count > 0 && persistence.trouble && (
          <div aria-live="polite" class="note" id="draft-trouble">
            {t(
              persistence.trouble === "tooLarge"
                ? "draft.tooLarge"
                : "draft.unavailable"
            )}
          </div>
        )}
        {count > 0 && persistence.otherTab && (
          <div aria-live="polite" class="note" id="draft-other-tab">
            <span>{t("draft.otherTab")}</span>
            <button
              class="mini"
              onClick={persistence.dismissOtherTab}
              type="button"
            >
              {t("draft.dismiss")}
            </button>
          </div>
        )}
        {problemText && (
          <div id="error" role="alert">
            {problemText}
          </div>
        )}
        <div class="filters">
          <input
            aria-label={t("search.placeholder")}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            placeholder={t("search.placeholder")}
            type="search"
            value={q}
          />
          <select
            aria-label={t("filter.status")}
            onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}
            value={status}
          >
            <option value="">{t("filter.statusAll")}</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
          <select
            aria-label={t("filter.lang")}
            onChange={(e) => setLang((e.target as HTMLSelectElement).value)}
            value={lang}
          >
            <option value="">{t("filter.langAll")}</option>
            {model.columns.map((c, i) => (
              <option key={c} value={String(i)}>
                {c}
              </option>
            ))}
          </select>
          <label class="chk">
            <input
              checked={showArchived}
              onChange={(e) =>
                setShowArchived((e.target as HTMLInputElement).checked)
              }
              type="checkbox"
            />
            {t("archived.show")}
          </label>
          <button class="act" onClick={copy} type="button">
            {t(copyState)}
          </button>
          {writable && selected.size > 0 && (
            <span class="bulk">
              <select
                aria-label={t("bulk.choose")}
                onChange={(e) =>
                  setBulkState((e.target as HTMLSelectElement).value)
                }
                value={bulkState}
              >
                <option value="">{t("bulk.choose")}</option>
                {model.storedStates.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </select>
              <button
                class="act"
                disabled={!bulkState}
                onClick={bulk}
                type="button"
              >
                {tn("bulk.set", selected.size)}
              </button>
            </span>
          )}
        </div>
        <div class="scroll" ref={scrollRef}>
          {visible.length === 0 ? (
            <div class="empty">{t("empty")}</div>
          ) : (
            <Grid
              cols={cols}
              editable={editable}
              editing={editing}
              gridRef={gridRef}
              group={group}
              groupLabel={groupLabel}
              menuFor={menuFor}
              model={model}
              on={actions}
              query={q.trim()}
              rows={visible}
              sel={sel}
              selected={selected}
              staged={staged}
              statusEditable={statusEditable}
              statusLabel={statusLabel}
              tr={tr}
              writable={writable}
            />
          )}
        </div>
        {writable && (
          <section aria-label={t("bar.save")} class="savebar">
            {details && count > 0 && (
              <div class="details" id="pending-list">
                <h3>{t("bar.list")}</h3>
                <ul>
                  {listStaged(staged).map((entry) => (
                    <li key={`${entry.kind}:${entry.key}`}>
                      <button
                        aria-label={t("bar.jump", { id: entry.id })}
                        class="entry"
                        onClick={() => jumpTo(entry.id, entry.lang)}
                        type="button"
                      >
                        <span class="entry-head">
                          <span class="entry-what">
                            {entry.lang ?? t("col.status")}
                          </span>
                          <span class="entry-id">{entry.id}</span>
                        </span>
                        <span class="entry-change">
                          {entry.kind === "cell" &&
                          diffable(entry.from, entry.to, entry.lang) ? (
                            <Changed
                              after={entry.to}
                              before={entry.from}
                              lang={entry.lang}
                            />
                          ) : (
                            <>
                              <del>{entryText(entry.kind, entry.from)}</del>
                              {" → "}
                              {entryText(entry.kind, entry.to)}
                            </>
                          )}
                        </span>
                      </button>
                      <button
                        aria-label={`${t("bar.revert")}: ${entry.id}`}
                        class="mini"
                        onClick={() => revert(entry)}
                        type="button"
                      >
                        {t("bar.revert")}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button
              aria-controls="pending-list"
              aria-expanded={details}
              class="pending-toggle"
              disabled={count === 0}
              id="pending"
              onClick={() => setDetails(!details)}
              type="button"
            >
              {tn("bar.pending", count)}
            </button>
            <span class="spacer" />
            <button
              class="act"
              disabled={count === 0 || saving}
              onClick={() => setConfirm({ kind: "discard", n: count })}
              type="button"
            >
              {t("bar.discard")}
            </button>
            <button
              class="act primary"
              disabled={count === 0 || saving}
              onClick={() => save()}
              type="button"
            >
              {saving ? t("bar.saving") : t("bar.save")}
            </button>
          </section>
        )}
        {toast && <output class="toast">{toast}</output>}
      </main>
      {menu && menuRow && (
        <MenuLayer
          badgeClass={(value) => `badge b-${value}`}
          items={model.storedStates.map((s) => ({
            value: s,
            label: statusLabel(s),
            checked: s === (staged.statuses[menu.id]?.state ?? menuRow.status),
          }))}
          label={t("status.menu")}
          onClose={closeMenu}
          onPick={(state) => {
            stageStatus(menu.id, state, menuRow.status);
            closeMenu();
          }}
          target={menu}
        />
      )}
      {manual !== null && (
        <ManualCopyDialog
          onClose={() => setManual(null)}
          text={manual}
          tr={tr}
        />
      )}
      {help && <ShortcutsDialog onClose={() => setHelp(false)} tr={tr} />}
      {confirm && (
        <ConfirmDialog
          onCancel={() => setConfirm(null)}
          onYes={() => {
            const kind = confirm.kind;
            setConfirm(null);
            if (kind === "discard") {
              apply({ type: "discard" });
              setProblem(null);
            } else {
              save(true);
            }
          }}
          text={tn(`confirm.${confirm.kind}`, confirm.n)}
          tr={tr}
          yes={t(`confirm.${confirm.kind}.yes`)}
        />
      )}
    </>
  );
};
