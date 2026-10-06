import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { type Placement, placeMenu, type Rect } from "./place";

export type MenuItem = {
  value: string;
  label: string;
  checked: boolean;
};

export type MenuTarget = {
  /** What the menu belongs to (a row id). */
  id: string;
  rect: Rect;
  /** Focus returns here when the menu closes. */
  trigger: HTMLElement | null;
};

type Props = {
  target: MenuTarget;
  label: string;
  items: MenuItem[];
  badgeClass: (value: string) => string;
  onPick: (value: string) => void;
  onClose: () => void;
};

const viewport = () => ({
  width: document.documentElement.clientWidth,
  height: document.documentElement.clientHeight,
});

/**
 * A menu in a top-level layer: `position: fixed` next to the trigger, so no scroll
 * container or sticky cell can clip it. Esc and outside clicks close it, scrolling or
 * resizing closes it (the trigger moved), and focus goes back to the trigger.
 */
export const MenuLayer = ({
  target,
  label,
  items,
  badgeClass,
  onPick,
  onClose,
}: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el) {
      setPlace(
        placeMenu(
          target.rect,
          { width: el.offsetWidth, height: el.offsetHeight },
          viewport()
        )
      );
    }
  }, [target]);

  useEffect(() => {
    if (!place) {
      return;
    }
    const buttons = ref.current?.querySelectorAll<HTMLElement>("button");
    const checked = ref.current?.querySelector<HTMLElement>(
      '[aria-checked="true"]'
    );
    (checked ?? buttons?.[0])?.focus({ preventScroll: true });
  }, [place === null]);

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      // The trigger toggles the menu itself; everything else outside closes it.
      if (!(ref.current?.contains(t) || t.closest("[data-menu-trigger]"))) {
        onClose();
      }
    };
    window.addEventListener("mousedown", outside);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent) => {
    const buttons = [
      ...(ref.current?.querySelectorAll<HTMLElement>("button") ?? []),
    ];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      buttons[(i + buttons.length) % buttons.length]?.focus();
    };
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown") {
      go(at + 1);
    } else if (e.key === "ArrowUp") {
      go(at - 1);
    } else if (e.key === "Home") {
      go(0);
    } else if (e.key === "End") {
      go(buttons.length - 1);
    } else if (e.key === "Tab") {
      onClose();
    }
  };

  return (
    <div
      aria-label={label}
      class="menu"
      onKeyDown={onKeyDown}
      ref={ref}
      role="menu"
      style={{
        left: `${place?.x ?? 0}px`,
        top: `${place?.y ?? 0}px`,
        maxHeight: place ? `${place.maxHeight}px` : undefined,
        visibility: place ? "visible" : "hidden",
      }}
    >
      {items.map((item) => (
        <button
          aria-checked={item.checked}
          class="menu-item"
          key={item.value}
          onClick={() => onPick(item.value)}
          role="menuitemradio"
          type="button"
        >
          <span class={badgeClass(item.value)}>{item.label}</span>
        </button>
      ))}
    </div>
  );
};
