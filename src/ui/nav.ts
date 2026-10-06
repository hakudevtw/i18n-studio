/** Selected grid cell. `col` 0 is the status cell, 1.. are the language columns. */
export type Sel = { row: number; col: number };
export type Dims = { rows: number; cols: number };
export type Move =
  | "left"
  | "right"
  | "up"
  | "down"
  | "next"
  | "prev"
  | "home"
  | "end"
  | "pageUp"
  | "pageDown";

const PAGE = 10;
const FIRST_VALUE_COL = 1;

const clamp = (n: number, max: number) => Math.max(0, Math.min(n, max));

/** Keep a selection inside the grid (rows can shrink when filters change). */
export const clampSel = (sel: Sel | null, { rows, cols }: Dims): Sel | null =>
  sel === null || rows === 0 || cols === 0
    ? null
    : { row: clamp(sel.row, rows - 1), col: clamp(sel.col, cols - 1) };

/** Pure keyboard navigation. Tab/Shift+Tab walk the language cells, wrapping across rows. */
export const move = (sel: Sel | null, action: Move, dims: Dims): Sel | null => {
  if (dims.rows === 0 || dims.cols === 0) {
    return null;
  }
  const start = Math.min(FIRST_VALUE_COL, dims.cols - 1);
  const at = clampSel(sel, dims) ?? { row: 0, col: start };
  const lastRow = dims.rows - 1;
  const lastCol = dims.cols - 1;
  switch (action) {
    case "left":
      return { ...at, col: clamp(at.col - 1, lastCol) };
    case "right":
      return { ...at, col: clamp(at.col + 1, lastCol) };
    case "up":
      return { ...at, row: clamp(at.row - 1, lastRow) };
    case "down":
      return { ...at, row: clamp(at.row + 1, lastRow) };
    case "pageUp":
      return { ...at, row: clamp(at.row - PAGE, lastRow) };
    case "pageDown":
      return { ...at, row: clamp(at.row + PAGE, lastRow) };
    case "home":
      return { ...at, col: 0 };
    case "end":
      return { ...at, col: lastCol };
    case "next":
      if (at.col < lastCol) {
        return { ...at, col: Math.max(at.col + 1, start) };
      }
      return at.row < lastRow ? { row: at.row + 1, col: start } : at;
    case "prev":
      if (at.col > start) {
        return { ...at, col: at.col - 1 };
      }
      return at.row > 0 ? { row: at.row - 1, col: lastCol } : at;
    default:
      return at;
  }
};
