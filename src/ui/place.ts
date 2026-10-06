/** Viewport-relative rectangle, as from `getBoundingClientRect()`. */
export type Rect = { left: number; top: number; right: number; bottom: number };
export type Size = { width: number; height: number };
export type Placement = {
  x: number;
  y: number;
  placement: "bottom" | "top";
  align: "start" | "end";
  /** The menu is shorter than its content when the viewport is tiny: scroll inside it. */
  maxHeight: number;
};

const GAP = 4;
const MARGIN = 8;

/**
 * Where to put a fixed-position menu so it stays fully visible: below the trigger when it
 * fits (or when there is more room below than above), otherwise flipped above; aligned to
 * the trigger's left edge unless that overflows, then to its right edge; always clamped to
 * the viewport margin. Pure, so every edge case is unit-tested.
 */
export const placeMenu = (
  trigger: Rect,
  menu: Size,
  viewport: Size
): Placement => {
  const gap = GAP;
  const margin = MARGIN;
  const below = Math.max(0, viewport.height - trigger.bottom - gap - margin);
  const above = Math.max(0, trigger.top - gap - margin);
  const placement = menu.height <= below || below >= above ? "bottom" : "top";
  const room = placement === "bottom" ? below : above;
  const maxHeight = Math.min(menu.height, Math.max(room, 0));
  const y =
    placement === "bottom"
      ? trigger.bottom + gap
      : trigger.top - gap - maxHeight;

  const fitsAtStart = trigger.left + menu.width <= viewport.width - margin;
  const align = fitsAtStart ? "start" : "end";
  const wanted = align === "start" ? trigger.left : trigger.right - menu.width;
  const x = Math.max(
    margin,
    Math.min(wanted, viewport.width - margin - menu.width)
  );
  return { x, y, placement, align, maxHeight };
};
