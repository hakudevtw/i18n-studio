/**
 * biome-ignore-all lint/a11y/useSemanticElements: ARIA grid pattern: the table is the one focusable widget
 * biome-ignore-all lint/a11y/noNoninteractiveElementToInteractiveRole: cells are gridcells of that widget
 * biome-ignore-all lint/a11y/useFocusableInteractive: focus stays on the grid (aria-activedescendant)
 * biome-ignore-all lint/a11y/useKeyWithClickEvents: keyboard handling is on the grid, see report.tsx
 */
import type { Ref, VNode } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { Model, ModelCell, ModelRow } from "../model";
import type { Translator } from "./i18n";
import type { MenuTarget } from "./menu";
import type { Move, Sel } from "./nav";
import { cellKey, rowId, type Staged } from "./staged";

export type Editing = {
  id: string;
  lang: string;
  original: string;
  value: string;
};

export type GridActions = {
  select: (sel: Sel) => void;
  edit: (row: number, col: number) => void;
  input: (value: string) => void;
  commit: (value: string, then?: Move) => void;
  cancel: () => void;
  keyDown: (e: KeyboardEvent) => void;
  menu: (target: MenuTarget | null) => void;
  status: (id: string, state: string, expectedState: string) => void;
  toggle: (id: string) => void;
  toggleAll: () => void;
  keep: (key: string) => void;
  theirs: (key: string) => void;
};

export type GridProps = {
  tr: Translator;
  model: Model;
  rows: ModelRow[];
  cols: number[];
  group: string;
  writable: boolean;
  staged: Staged;
  sel: Sel | null;
  editing: Editing | null;
  menuFor: string | null;
  selected: ReadonlySet<string>;
  gridRef: Ref<HTMLTableElement>;
  editable: (r: ModelRow) => boolean;
  statusEditable: (r: ModelRow) => boolean;
  groupLabel: (g: string) => string;
  statusLabel: (s: string) => string;
  on: GridActions;
};

const cellId = (row: number, col: number) => `cell-${row}-${col}`;
const MAX_EDITOR_ROWS = 10;

/** Textarea editor: Enter commits, Shift+Enter newline, Esc cancels, Tab commits and moves. */
const Editor = ({
  tr,
  editing,
  label,
  on,
}: {
  tr: Translator;
  editing: Editing;
  label: string;
  on: GridActions;
}) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.focus();
    el?.select(); // whole value selected: type to replace, an arrow key to edit in place
  }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    // Never act on keys that confirm an IME composition (Korean, Japanese, Chinese).
    if (e.isComposing || e.keyCode === 229) {
      return;
    }
    if (["Enter", "Escape", "Tab"].includes(e.key)) {
      e.stopPropagation();
    }
    const value = (e.currentTarget as HTMLTextAreaElement).value;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      on.commit(value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      on.cancel();
    } else if (e.key === "Tab") {
      e.preventDefault();
      on.commit(value, e.shiftKey ? "prev" : "next");
    }
  };
  return (
    <textarea
      aria-label={label}
      class="editor"
      onBlur={(e) => on.commit((e.currentTarget as HTMLTextAreaElement).value)}
      onInput={(e) => on.input((e.currentTarget as HTMLTextAreaElement).value)}
      onKeyDown={onKeyDown}
      ref={ref}
      rows={Math.min(MAX_EDITOR_ROWS, editing.value.split("\n").length + 1)}
      title={tr.t("help.commit")}
      value={editing.value}
    />
  );
};

const Conflict = ({
  tr,
  current,
  state,
  onKeep,
  onTheirs,
}: {
  tr: Translator;
  current: string;
  state?: boolean;
  onKeep: () => void;
  onTheirs: () => void;
}) => (
  <div class="conflict" role="alert">
    <div class="conflict-theirs">
      {state
        ? tr.t("conflict.theirsState", { state: current })
        : tr.t("conflict.theirs")}
      {state ? null : <span class="conflict-value">{current}</span>}
    </div>
    <div class="conflict-actions">
      <button class="mini" onClick={onKeep} type="button">
        {tr.t("conflict.keepMine")}
      </button>
      <button class="mini" onClick={onTheirs} type="button">
        {tr.t("conflict.useTheirs")}
      </button>
    </div>
  </div>
);

const ValueCell = ({
  g,
  row,
  rowIdx,
  col,
  modelCol,
}: {
  g: GridProps;
  row: ModelRow;
  rowIdx: number;
  col: number;
  modelCol: number;
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one cell, several visual states
}) => {
  const { tr, on, staged, editing } = g;
  const c: ModelCell | undefined = row.cells[modelCol];
  const lang = g.model.columns[modelCol];
  const id = rowId(row);
  const key = cellKey(id, lang);
  const sc = staged.cells[key];
  const isSel = g.sel?.row === rowIdx && g.sel.col === col;
  const isEditing = editing?.id === id && editing.lang === lang;
  const readOnly = !g.editable(row);
  const classes = [
    "text",
    c?.changed && "changed",
    sc && "dirty",
    sc?.conflict !== undefined && "conflicted",
    isSel && "sel",
    g.writable && readOnly && "readonly",
  ].filter(Boolean);
  let title: string | undefined;
  if (sc) {
    title = tr.t("cell.dirty");
  } else if (c?.changed) {
    title = tr.t(c.mark === "proposed" ? "cell.proposed" : "cell.changed");
  } else if (g.writable && row.status === "archived") {
    title = tr.t("cell.archived");
  }
  const struck = sc ? sc.original : c?.old;
  return (
    <td
      aria-selected={g.writable ? isSel : undefined}
      class={classes.join(" ")}
      id={cellId(rowIdx, col)}
      onClick={() => on.select({ row: rowIdx, col })}
      onDblClick={() => on.edit(rowIdx, col)}
      role="gridcell"
      title={title}
    >
      {isEditing && editing ? (
        <Editor
          editing={editing}
          label={tr.t("cell.edit", { lang, key: row.key })}
          on={on}
          tr={tr}
        />
      ) : (
        <>
          {struck !== undefined && <del>{struck}</del>}
          {sc ? sc.current : c?.text}
          {sc && <span aria-hidden="true" class="dot" />}
          {sc?.conflict !== undefined && (
            <Conflict
              current={sc.conflict}
              onKeep={() => on.keep(key)}
              onTheirs={() => on.theirs(key)}
              tr={tr}
            />
          )}
        </>
      )}
    </td>
  );
};

const StatusCell = ({
  g,
  row,
  rowIdx,
}: {
  g: GridProps;
  row: ModelRow;
  rowIdx: number;
}) => {
  const { tr, on, staged } = g;
  const id = rowId(row);
  const ss = staged.statuses[id];
  const shown = ss ? ss.state : row.status;
  const isSel = g.sel?.row === rowIdx && g.sel.col === 0;
  const canEdit = g.statusEditable(row);
  const badge = <span class={`badge b-${shown}`}>{g.statusLabel(shown)}</span>;
  return (
    <td
      aria-selected={g.writable ? isSel : undefined}
      class={["status", isSel && "sel", ss && "dirty"]
        .filter(Boolean)
        .join(" ")}
      id={cellId(rowIdx, 0)}
      onClick={() => on.select({ row: rowIdx, col: 0 })}
      role="gridcell"
    >
      {canEdit ? (
        <button
          aria-expanded={g.menuFor === id}
          aria-haspopup="menu"
          aria-label={`${tr.t("status.menu")}: ${g.statusLabel(shown)}`}
          class="badge-btn"
          data-menu-trigger=""
          onClick={(e) => {
            e.stopPropagation();
            const trigger = e.currentTarget as HTMLElement;
            on.menu(
              g.menuFor === id
                ? null
                : { id, rect: trigger.getBoundingClientRect(), trigger }
            );
          }}
          tabIndex={-1}
          type="button"
        >
          {badge}
        </button>
      ) : (
        badge
      )}
      {ss && <span aria-hidden="true" class="dot" />}
      {ss?.conflict !== undefined && (
        <Conflict
          current={g.statusLabel(ss.conflict)}
          onKeep={() => on.keep(id)}
          onTheirs={() => on.theirs(id)}
          state
          tr={tr}
        />
      )}
    </td>
  );
};

const GroupRow = ({ g, group }: { g: GridProps; group: string }) => (
  <tr class="group">
    <td class="label" colSpan={g.writable ? 3 : 2} role="gridcell">
      {g.groupLabel(group)}
    </td>
    <td colSpan={Math.max(1, g.cols.length)} role="gridcell" />
  </tr>
);

const BodyRow = ({
  g,
  row,
  rowIdx,
}: {
  g: GridProps;
  row: ModelRow;
  rowIdx: number;
}) => {
  const id = rowId(row);
  return (
    <tr class={row.status === "archived" ? "archived" : undefined}>
      {g.writable && (
        <td class="check" role="gridcell">
          <input
            aria-label={g.tr.t("select.row", { key: row.key })}
            checked={g.selected.has(id)}
            onChange={() => g.on.toggle(id)}
            type="checkbox"
          />
        </td>
      )}
      <StatusCell g={g} row={row} rowIdx={rowIdx} />
      <td class="key" role="gridcell">
        {row.key}
      </td>
      {g.cols.map((modelCol, p) => (
        <ValueCell
          col={p + 1}
          g={g}
          key={modelCol}
          modelCol={modelCol}
          row={row}
          rowIdx={rowIdx}
        />
      ))}
    </tr>
  );
};

export const Grid = (g: GridProps) => {
  const { tr, model, rows, cols, writable } = g;
  const body: VNode[] = [];
  let current: string | null = null;
  for (const [rowIdx, row] of rows.entries()) {
    if (!g.group && row.group !== current) {
      current = row.group;
      body.push(<GroupRow g={g} group={row.group} key={`g:${row.group}`} />);
    }
    body.push(
      <BodyRow
        g={g}
        key={`${row.group}.${row.key}`}
        row={row}
        rowIdx={rowIdx}
      />
    );
  }
  const activeCell = g.sel ? cellId(g.sel.row, g.sel.col) : undefined;
  const allSelected =
    rows.length > 0 && rows.every((r) => g.selected.has(rowId(r)));
  return (
    <table
      aria-activedescendant={writable ? activeCell : undefined}
      aria-label={tr.t("title")}
      class={writable ? "writable" : undefined}
      onKeyDown={writable ? g.on.keyDown : undefined}
      ref={g.gridRef}
      role="grid"
      style={{ "--cols": cols.length }}
      tabIndex={writable ? 0 : undefined}
    >
      <colgroup>
        {writable && <col class="c-check" />}
        <col class="c-status" />
        <col class="c-key" />
        {cols.map((i) => (
          <col key={i} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {writable && (
            <th class="check" role="columnheader">
              <input
                aria-label={tr.t("select.all")}
                checked={allSelected}
                onChange={g.on.toggleAll}
                type="checkbox"
              />
            </th>
          )}
          <th class="status" role="columnheader">
            {tr.t("col.status")}
          </th>
          <th class="key" role="columnheader">
            {tr.t("col.key")}
          </th>
          {cols.map((i) => (
            <th key={i} role="columnheader">
              {model.columns[i]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{body}</tbody>
    </table>
  );
};
