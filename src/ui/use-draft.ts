import { useEffect, useMemo, useState } from "preact/hooks";
import type { ModelRow } from "../model";
import {
  browserStorage,
  type DraftStorage,
  draftKey,
  loadDraft,
  nothingRestored,
  type Restored,
  serializeDraft,
} from "./draft";
import { countStaged, type Staged } from "./staged";

const DEBOUNCE_MS = 300;

/** Read the stored draft once, on the first render, before anything can overwrite it. */
export const useRestoredDraft = (opts: {
  enabled: boolean;
  projectId: string;
  rows: ModelRow[];
  columns: string[];
  storage?: DraftStorage;
}): Restored => {
  const [restored] = useState(() =>
    opts.enabled
      ? loadDraft(
          opts.storage ?? browserStorage(),
          opts.projectId,
          opts.rows,
          opts.columns
        )
      : nothingRestored
  );
  return restored;
};

export type DraftTrouble = "unavailable" | "tooLarge" | null;

/**
 * Keep the staged set in localStorage: debounced writes, flushed when the page is hidden
 * or closed, removed as soon as nothing is pending. When disabled it never reads or writes.
 */
export const usePersistDraft = (opts: {
  enabled: boolean;
  projectId: string;
  staged: Staged;
  latest: { current: Staged };
  storage?: DraftStorage;
}) => {
  const { enabled, projectId, staged, latest } = opts;
  const storage = useMemo(
    () => opts.storage ?? browserStorage(),
    [opts.storage]
  );
  const key = draftKey(projectId);
  const [trouble, setTrouble] = useState<DraftTrouble>(null);
  const [otherTab, setOtherTab] = useState(false);
  const count = countStaged(staged);

  const write = (s: Staged) => {
    const out = serializeDraft(s, projectId, Date.now());
    if (!out.ok) {
      storage.remove(key);
      setTrouble(out.reason === "too-large" ? "tooLarge" : null);
      return;
    }
    setTrouble(storage.write(key, out.text) ? null : "unavailable");
  };

  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (count === 0) {
      storage.remove(key);
      setTrouble(null);
      setOtherTab(false);
      return;
    }
    const id = setTimeout(() => write(latest.current), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [enabled, staged]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const flush = () => {
      if (countStaged(latest.current) > 0) {
        write(latest.current);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        flush();
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === key && countStaged(latest.current) > 0) {
        setOtherTab(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    window.addEventListener("storage", onStorage);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("storage", onStorage);
    };
  }, [enabled, key]);

  return { trouble, otherTab, dismissOtherTab: () => setOtherTab(false) };
};
