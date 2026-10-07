export type Theme = "light" | "dark";

const KEY = "i18n-studio.theme";
const DARK = "(prefers-color-scheme: dark)";

/** The theme the user picked last, or null to follow the system. localStorage may be blocked. */
export const readTheme = (): Theme | null => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
};

export const saveTheme = (theme: Theme) => {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // storage unavailable: the choice lives for this page view only
  }
};

export const systemTheme = (): Theme =>
  typeof matchMedia === "function" && matchMedia(DARK).matches
    ? "dark"
    : "light";

/** Every colour is `light-dark()`, so the root's `color-scheme` (set by `data-theme` in app.css) is the whole switch. */
export const applyTheme = (theme: Theme | null) => {
  const root = document.documentElement;
  if (theme) {
    root.dataset.theme = theme;
  } else {
    delete root.dataset.theme;
  }
};

/** Follow system changes until the user picks a theme. */
export const watchSystemTheme = (
  onChange: (theme: Theme) => void
): (() => void) | undefined => {
  if (typeof matchMedia !== "function") {
    return;
  }
  const query = matchMedia(DARK);
  const listener = () => onChange(query.matches ? "dark" : "light");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};
