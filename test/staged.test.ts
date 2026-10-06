import { describe, expect, it } from "vitest";
import type { ModelRow } from "../src/model.js";
import { clampSel, move } from "../src/ui/nav.js";
import {
  cellKey,
  countStaged,
  emptyStaged,
  hasConflicts,
  type Staged,
  stagedReducer,
  staleRowCount,
  toPayload,
} from "../src/ui/staged.js";

const edit = (s: Staged, value: string, original = "old", lang = "ko") =>
  stagedReducer(s, { type: "edit", id: "a.k", lang, original, value });

describe("staged edits", () => {
  it("counts changed cells and removes the entry when the original is typed back", () => {
    let s = edit(emptyStaged, "new");
    expect(countStaged(s)).toBe(1);
    expect(s.cells[cellKey("a.k", "ko")]).toMatchObject({
      original: "old",
      current: "new",
    });
    s = edit(s, "newer");
    expect(countStaged(s)).toBe(1);
    expect(s.cells[cellKey("a.k", "ko")].original).toBe("old");
    s = edit(s, "old");
    expect(countStaged(s)).toBe(0);
    expect(s).toEqual(emptyStaged);
  });

  it("keys cells by id and language", () => {
    let s = edit(emptyStaged, "x");
    s = edit(s, "y", "old", "es");
    s = stagedReducer(s, {
      type: "edit",
      id: "b.k",
      lang: "ko",
      original: "o",
      value: "p",
    });
    expect(countStaged(s)).toBe(3);
  });

  it("stages statuses and unstages them when set back to the current state", () => {
    let s = stagedReducer(emptyStaged, {
      type: "status",
      id: "a.k",
      state: "approved",
      expectedState: "edited",
    });
    expect(countStaged(s)).toBe(1);
    s = stagedReducer(s, {
      type: "status",
      id: "a.k",
      state: "in-review",
      expectedState: "edited",
    });
    expect(s.statuses["a.k"]).toMatchObject({
      state: "in-review",
      expectedState: "edited",
    });
    s = stagedReducer(s, {
      type: "status",
      id: "a.k",
      state: "edited",
      expectedState: "edited",
    });
    expect(countStaged(s)).toBe(0);
  });

  it("discard clears everything", () => {
    let s = edit(emptyStaged, "x");
    s = stagedReducer(s, {
      type: "status",
      id: "a.k",
      state: "approved",
      expectedState: "new",
    });
    expect(stagedReducer(s, { type: "discard" })).toEqual(emptyStaged);
  });
});

describe("batch payload", () => {
  it("builds expectedOld/expectedState from the baseline", () => {
    let s = edit(emptyStaged, "new");
    s = stagedReducer(s, {
      type: "status",
      id: "a.k",
      state: "approved",
      expectedState: "edited",
    });
    expect(toPayload(s)).toEqual({
      edits: [{ id: "a.k", lang: "ko", expectedOld: "old", new: "new" }],
      statuses: [{ id: "a.k", state: "approved", expectedState: "edited" }],
    });
    expect(toPayload(emptyStaged)).toEqual({ edits: [], statuses: [] });
  });
});

describe("conflict resolution", () => {
  const conflicted = () => {
    let s = edit(emptyStaged, "mine");
    s = stagedReducer(s, {
      type: "status",
      id: "a.k",
      state: "approved",
      expectedState: "edited",
    });
    return stagedReducer(s, {
      type: "conflicts",
      conflicts: [
        { id: "a.k", lang: "ko", kind: "value", current: "theirs" },
        { id: "a.k", kind: "state", current: "in-review" },
        { id: "zzz", lang: "ko", kind: "value", current: "ignored" },
      ],
    });
  };

  it("marks the conflicted cells and statuses and keeps every staged edit", () => {
    const s = conflicted();
    expect(hasConflicts(s)).toBe(true);
    expect(s.cells[cellKey("a.k", "ko")]).toMatchObject({
      current: "mine",
      conflict: "theirs",
    });
    expect(s.statuses["a.k"].conflict).toBe("in-review");
    expect(countStaged(s)).toBe(2);
  });

  it("Keep mine re-bases the expectation on the current value", () => {
    let s = stagedReducer(conflicted(), {
      type: "keepMine",
      key: cellKey("a.k", "ko"),
    });
    s = stagedReducer(s, { type: "keepMine", key: "a.k" });
    expect(hasConflicts(s)).toBe(false);
    expect(toPayload(s)).toEqual({
      edits: [{ id: "a.k", lang: "ko", expectedOld: "theirs", new: "mine" }],
      statuses: [{ id: "a.k", state: "approved", expectedState: "in-review" }],
    });
  });

  it("Keep mine drops the entry when mine now equals theirs", () => {
    let s = edit(emptyStaged, "same");
    s = stagedReducer(s, {
      type: "conflicts",
      conflicts: [{ id: "a.k", lang: "ko", kind: "value", current: "same" }],
    });
    s = stagedReducer(s, { type: "keepMine", key: cellKey("a.k", "ko") });
    expect(countStaged(s)).toBe(0);
  });

  it("Use theirs drops my edit", () => {
    let s = stagedReducer(conflicted(), {
      type: "useTheirs",
      key: cellKey("a.k", "ko"),
    });
    s = stagedReducer(s, { type: "useTheirs", key: "a.k" });
    expect(s).toEqual(emptyStaged);
  });
});

describe("stale row count", () => {
  const rows: ModelRow[] = [
    {
      group: "a",
      key: "k1",
      status: "approved",
      cells: [{ text: "Hello" }, { text: "안녕" }, { text: "Hola" }],
    },
    {
      group: "a",
      key: "k2",
      status: "approved",
      cells: [{ text: "Bye" }, { text: "" }, { text: "" }],
    },
    {
      group: "a",
      key: "k3",
      status: "approved",
      cells: [{ text: "Yes" }, { text: "네" }, { text: "Sí" }],
    },
  ];
  const columns = ["en", "ko", "es"];
  const sourceEdit = (id: string) =>
    ({ type: "edit", id, lang: "en", original: "x", value: "y" }) as const;

  it("counts only edited rows that have translations to go stale", () => {
    let s = stagedReducer(emptyStaged, sourceEdit("a.k1"));
    s = stagedReducer(s, sourceEdit("a.k2"));
    expect(staleRowCount(rows, s, "en", columns)).toBe(1);
  });

  it("ignores edits of other languages and counts staged translations", () => {
    let s = edit(emptyStaged, "x", "old", "ko");
    expect(staleRowCount(rows, s, "en", columns)).toBe(0);
    s = stagedReducer(emptyStaged, sourceEdit("a.k2"));
    s = stagedReducer(s, {
      type: "edit",
      id: "a.k2",
      lang: "es",
      original: "",
      value: "Adiós",
    });
    expect(staleRowCount(rows, s, "en", columns)).toBe(1);
  });
});

describe("keyboard navigation", () => {
  const dims = { rows: 3, cols: 4 }; // status + 3 languages

  it("starts at the first language cell", () => {
    expect(move(null, "down", dims)).toEqual({ row: 1, col: 1 });
    expect(move(null, "right", dims)).toEqual({ row: 0, col: 2 });
  });

  it("moves with the arrows and clamps at the edges", () => {
    expect(move({ row: 0, col: 1 }, "up", dims)).toEqual({ row: 0, col: 1 });
    expect(move({ row: 2, col: 3 }, "down", dims)).toEqual({ row: 2, col: 3 });
    expect(move({ row: 1, col: 1 }, "left", dims)).toEqual({ row: 1, col: 0 });
    expect(move({ row: 1, col: 0 }, "left", dims)).toEqual({ row: 1, col: 0 });
    expect(move({ row: 1, col: 3 }, "right", dims)).toEqual({ row: 1, col: 3 });
    expect(move({ row: 1, col: 2 }, "home", dims)).toEqual({ row: 1, col: 0 });
    expect(move({ row: 1, col: 1 }, "end", dims)).toEqual({ row: 1, col: 3 });
    expect(move({ row: 0, col: 1 }, "pageDown", dims)).toEqual({
      row: 2,
      col: 1,
    });
    expect(move({ row: 2, col: 1 }, "pageUp", dims)).toEqual({
      row: 0,
      col: 1,
    });
  });

  it("walks language cells with Tab/Shift+Tab, wrapping across rows and skipping status", () => {
    expect(move({ row: 0, col: 1 }, "next", dims)).toEqual({ row: 0, col: 2 });
    expect(move({ row: 0, col: 3 }, "next", dims)).toEqual({ row: 1, col: 1 });
    expect(move({ row: 2, col: 3 }, "next", dims)).toEqual({ row: 2, col: 3 });
    expect(move({ row: 0, col: 0 }, "next", dims)).toEqual({ row: 0, col: 1 });
    expect(move({ row: 1, col: 1 }, "prev", dims)).toEqual({ row: 0, col: 3 });
    expect(move({ row: 0, col: 1 }, "prev", dims)).toEqual({ row: 0, col: 1 });
  });

  it("returns null for an empty grid and clamps stale selections", () => {
    expect(move({ row: 0, col: 0 }, "down", { rows: 0, cols: 4 })).toBeNull();
    expect(clampSel({ row: 9, col: 9 }, dims)).toEqual({ row: 2, col: 3 });
    expect(clampSel({ row: 1, col: 1 }, { rows: 0, cols: 4 })).toBeNull();
    expect(clampSel(null, dims)).toBeNull();
  });
});
