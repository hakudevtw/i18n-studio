import { describe, expect, it } from "vitest";
import { placeMenu } from "../src/ui/place.js";
import {
  emptyStaged,
  listStaged,
  stagedReducer,
  truncate,
} from "../src/ui/staged.js";

const rect = (left: number, top: number, width = 80, height = 24) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});
const menu = { width: 140, height: 120 };
const viewport = { width: 1000, height: 700 };

describe("placeMenu", () => {
  it("opens below and aligned to the trigger when there is room", () => {
    expect(placeMenu(rect(100, 100), menu, viewport)).toEqual({
      x: 100,
      y: 128,
      placement: "bottom",
      align: "start",
      maxHeight: 120,
    });
  });

  it("flips above when the bottom edge would clip it", () => {
    const placed = placeMenu(rect(100, 650), menu, viewport);
    expect(placed.placement).toBe("top");
    expect(placed.y).toBe(650 - 4 - 120);
    expect(placed.y + placed.maxHeight).toBeLessThanOrEqual(650);
  });

  it("aligns to the trigger's right edge when the right edge would clip it", () => {
    const placed = placeMenu(rect(950, 100, 40), menu, viewport);
    expect(placed.align).toBe("end");
    expect(placed.x).toBe(990 - 140);
    expect(placed.x + menu.width).toBeLessThanOrEqual(viewport.width - 8);
  });

  it("flips both ways in the bottom-right corner", () => {
    const placed = placeMenu(rect(960, 680, 30), menu, viewport);
    expect(placed).toMatchObject({ placement: "top", align: "end" });
    expect(placed.x + menu.width).toBeLessThanOrEqual(viewport.width);
    expect(placed.y).toBeGreaterThanOrEqual(8);
  });

  it("keeps the menu inside the viewport when the trigger is partly off-screen", () => {
    const placed = placeMenu(rect(-30, 100, 60), menu, viewport);
    expect(placed.x).toBe(8);
    const right = placeMenu(rect(990, 100, 60), menu, viewport);
    expect(right.x + menu.width).toBeLessThanOrEqual(viewport.width - 8);
  });

  it("limits the height (menu scrolls) in a tiny viewport, on the roomier side", () => {
    const tiny = { width: 200, height: 100 };
    const placed = placeMenu(rect(10, 60, 40, 20), menu, tiny);
    expect(placed.maxHeight).toBeLessThan(menu.height);
    expect(placed.y).toBeGreaterThanOrEqual(0);
    expect(placed.y + placed.maxHeight).toBeLessThanOrEqual(tiny.height);
  });

  it("prefers the side with more room when neither fits", () => {
    const placed = placeMenu(rect(10, 300, 40, 20), menu, {
      width: 400,
      height: 400,
    });
    expect(placed.placement).toBe("top");
    expect(placed.maxHeight).toBeLessThanOrEqual(menu.height);
  });

  it("pins a menu wider than the viewport to the margin", () => {
    const placed = placeMenu(
      rect(100, 100),
      { width: 500, height: 50 },
      { width: 300, height: 400 }
    );
    expect(placed.x).toBe(8);
  });
});

describe("pending changes list", () => {
  it("lists cell edits and status changes in a stable order, with old and new values", () => {
    let s = stagedReducer(emptyStaged, {
      type: "edit",
      id: "b.k",
      lang: "ko",
      original: "o1",
      value: "n1",
    });
    s = stagedReducer(s, {
      type: "edit",
      id: "a.k",
      lang: "es",
      original: "o2",
      value: "n2",
    });
    s = stagedReducer(s, {
      type: "edit",
      id: "a.k",
      lang: "ko",
      original: "o3",
      value: "n3",
    });
    s = stagedReducer(s, {
      type: "status",
      id: "a.k",
      state: "approved",
      expectedState: "edited",
    });
    expect(
      listStaged(s).map((e) => [e.id, e.kind, e.lang ?? "", e.from, e.to])
    ).toEqual([
      ["a.k", "cell", "es", "o2", "n2"],
      ["a.k", "cell", "ko", "o3", "n3"],
      ["a.k", "status", "", "edited", "approved"],
      ["b.k", "cell", "ko", "o1", "n1"],
    ]);
    expect(listStaged(emptyStaged)).toEqual([]);
  });

  it("reverting an entry (the original value / current state) removes it", () => {
    let s = stagedReducer(emptyStaged, {
      type: "edit",
      id: "a.k",
      lang: "ko",
      original: "old",
      value: "new",
    });
    s = stagedReducer(s, {
      type: "status",
      id: "a.k",
      state: "approved",
      expectedState: "edited",
    });
    for (const entry of listStaged(s)) {
      s =
        entry.kind === "cell"
          ? stagedReducer(s, {
              type: "edit",
              id: entry.id,
              lang: entry.lang ?? "",
              original: entry.from,
              value: entry.from,
            })
          : stagedReducer(s, {
              type: "status",
              id: entry.id,
              state: entry.from,
              expectedState: entry.from,
            });
    }
    expect(s).toEqual(emptyStaged);
  });
});

describe("truncate", () => {
  it("collapses whitespace and shortens long text with an ellipsis", () => {
    expect(truncate("short")).toBe("short");
    expect(truncate("a\n  b\tc")).toBe("a b c");
    expect(truncate("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
    expect(truncate("x".repeat(10), 10)).toBe("x".repeat(10));
    expect(truncate("", 5)).toBe("");
  });
});
