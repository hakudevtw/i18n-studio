import { describe, expect, it } from "vitest";
import type { ModelRow } from "../src/model.js";
import {
  DRAFT_VERSION,
  type Draft,
  type DraftStorage,
  draftKey,
  loadDraft,
  nothingRestored,
  parseDraft,
  reconcile,
  relativeTime,
  serializeDraft,
} from "../src/ui/draft.js";
import { emptyStaged, stagedReducer } from "../src/ui/staged.js";

const PROJECT = "abc123def456";
const rows: ModelRow[] = [
  {
    group: "nav",
    key: "home",
    status: "approved",
    cells: [{ text: "Home" }, { text: "홈" }],
  },
  {
    group: "nav",
    key: "faq",
    status: "edited",
    cells: [{ text: "FAQ" }, { text: "질문" }],
  },
];
const columns = ["en", "ko"];
const draft = (over: Partial<Draft> = {}): Draft => ({
  version: DRAFT_VERSION,
  projectId: PROJECT,
  savedAt: 1000,
  edits: [{ id: "nav.home", lang: "ko", original: "홈", current: "집" }],
  statuses: [],
  ...over,
});
const staged = () =>
  stagedReducer(
    stagedReducer(emptyStaged, {
      type: "edit",
      id: "nav.home",
      lang: "ko",
      original: "홈",
      value: "집",
    }),
    {
      type: "status",
      id: "nav.faq",
      state: "approved",
      expectedState: "edited",
    }
  );

describe("serialize / parse", () => {
  it("round-trips the staged set and nothing else", () => {
    const out = serializeDraft(staged(), PROJECT, 5000);
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    expect(JSON.parse(out.text)).toEqual({
      version: DRAFT_VERSION,
      projectId: PROJECT,
      savedAt: 5000,
      edits: [{ id: "nav.home", lang: "ko", original: "홈", current: "집" }],
      statuses: [{ id: "nav.faq", state: "approved", expectedState: "edited" }],
    });
    expect(parseDraft(out.text, PROJECT)).toMatchObject({ savedAt: 5000 });
  });

  it("does not store conflict markers, tokens or paths", () => {
    let s = stagedReducer(emptyStaged, {
      type: "edit",
      id: "a.b",
      lang: "ko",
      original: "o",
      value: "n",
    });
    s = stagedReducer(s, {
      type: "conflicts",
      conflicts: [{ id: "a.b", lang: "ko", kind: "value", current: "disk" }],
    });
    const out = serializeDraft(s, PROJECT, 1);
    expect(out.ok && out.text).not.toContain("disk");
    expect(out.ok && out.text).not.toContain("conflict");
  });

  it("an empty set is not stored (so nothing lingers)", () => {
    expect(serializeDraft(emptyStaged, PROJECT, 1)).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("reverting the only edit shrinks the draft to nothing", () => {
    const s = stagedReducer(staged(), {
      type: "edit",
      id: "nav.home",
      lang: "ko",
      original: "홈",
      value: "홈",
    });
    const out = serializeDraft(s, PROJECT, 1);
    expect(out.ok && JSON.parse(out.text).edits).toEqual([]);
    const none = stagedReducer(s, {
      type: "status",
      id: "nav.faq",
      state: "edited",
      expectedState: "edited",
    });
    expect(serializeDraft(none, PROJECT, 1)).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("refuses to store more than the size cap", () => {
    const big = stagedReducer(emptyStaged, {
      type: "edit",
      id: "a.b",
      lang: "ko",
      original: "o",
      value: "x".repeat(500),
    });
    expect(serializeDraft(big, PROJECT, 1, 200)).toEqual({
      ok: false,
      reason: "too-large",
    });
    expect(serializeDraft(big, PROJECT, 1, 5000).ok).toBe(true);
  });

  it("parses nothing for corrupt, old, foreign or malformed data", () => {
    const text = JSON.stringify(draft());
    expect(parseDraft(text, PROJECT)).not.toBeNull();
    expect(parseDraft(null, PROJECT)).toBeNull();
    expect(parseDraft("", PROJECT)).toBeNull();
    expect(parseDraft("{nope", PROJECT)).toBeNull();
    expect(parseDraft("null", PROJECT)).toBeNull();
    expect(parseDraft("[]", PROJECT)).toBeNull();
    expect(
      parseDraft(JSON.stringify(draft({ version: 99 })), PROJECT)
    ).toBeNull();
    expect(parseDraft(text, "another-proj")).toBeNull();
    expect(
      parseDraft(JSON.stringify({ ...draft(), savedAt: "x" }), PROJECT)
    ).toBeNull();
    expect(
      parseDraft(JSON.stringify({ ...draft(), edits: "x" }), PROJECT)
    ).toBeNull();
  });

  it("skips malformed entries but keeps the good ones", () => {
    const text = JSON.stringify({
      ...draft(),
      edits: [
        { id: "nav.home", lang: "ko", original: "홈", current: "집" },
        { id: 5 },
        null,
      ],
      statuses: [{ id: "nav.faq" }],
    });
    const parsed = parseDraft(text, PROJECT);
    expect(parsed?.edits).toHaveLength(1);
    expect(parsed?.statuses).toHaveLength(0);
  });
});

describe("reconcile against the fresh model", () => {
  it("restores an edit whose original still matches", () => {
    const r = reconcile(draft(), rows, columns);
    expect(r).toMatchObject({
      restored: 1,
      conflicts: 0,
      dropped: 0,
      savedAt: 1000,
    });
    expect(r.staged.cells["nav.home\tko"]).toEqual({
      id: "nav.home",
      lang: "ko",
      original: "홈",
      current: "집",
    });
  });

  it("turns an edit whose original changed into a conflict (nothing dropped or overwritten)", () => {
    const moved = rows.map((row) =>
      row.key === "home"
        ? { ...row, cells: [row.cells[0], { text: "ホーム" }] }
        : row
    );
    const r = reconcile(draft(), moved, columns);
    expect(r).toMatchObject({ restored: 1, conflicts: 1, dropped: 0 });
    expect(r.staged.cells["nav.home\tko"]).toMatchObject({
      original: "홈",
      current: "집",
      conflict: "ホーム",
    });
  });

  it("drops edits for rows or languages that no longer exist, and counts them", () => {
    const r = reconcile(
      draft({
        edits: [
          { id: "nav.gone", lang: "ko", original: "a", current: "b" },
          { id: "nav.home", lang: "fr", original: "a", current: "b" },
          { id: "nav.home", lang: "ko", original: "홈", current: "집" },
        ],
        statuses: [{ id: "nav.gone", state: "approved", expectedState: "new" }],
      }),
      rows,
      columns
    );
    expect(r).toMatchObject({ restored: 1, dropped: 3, conflicts: 0 });
  });

  it("restores a status change, or a conflict when the state moved on", () => {
    const ok = reconcile(
      draft({
        edits: [],
        statuses: [
          { id: "nav.faq", state: "approved", expectedState: "edited" },
        ],
      }),
      rows,
      columns
    );
    expect(ok.staged.statuses["nav.faq"]).toEqual({
      id: "nav.faq",
      state: "approved",
      expectedState: "edited",
    });
    const moved = reconcile(
      draft({
        edits: [],
        statuses: [
          { id: "nav.faq", state: "archived", expectedState: "stale" },
        ],
      }),
      rows,
      columns
    );
    expect(moved).toMatchObject({ restored: 1, conflicts: 1 });
    expect(moved.staged.statuses["nav.faq"].conflict).toBe("edited");
  });

  it("ignores changes that already match the disk", () => {
    const r = reconcile(
      draft({
        edits: [{ id: "nav.home", lang: "ko", original: "x", current: "홈" }],
        statuses: [{ id: "nav.home", state: "approved", expectedState: "new" }],
      }),
      rows,
      columns
    );
    expect(r).toMatchObject({ restored: 0, dropped: 0, conflicts: 0 });
  });

  it("compares with the value on disk for rows overlaid by an import proposal", () => {
    const overlaid = [
      {
        ...rows[0],
        cells: [rows[0].cells[0], { text: "proposed", old: "홈" }],
      },
    ];
    expect(reconcile(draft(), overlaid, columns).conflicts).toBe(0);
  });
});

describe("loadDraft", () => {
  const storageWith = (value: string | null): DraftStorage => ({
    read: (key) => (key === draftKey(PROJECT) ? value : null),
    write: () => true,
    remove: () => {
      // nothing to remove in this fake
    },
  });

  it("reads and reconciles the draft for this project only", () => {
    expect(
      loadDraft(storageWith(JSON.stringify(draft())), PROJECT, rows, columns)
        .restored
    ).toBe(1);
    expect(
      loadDraft(storageWith(JSON.stringify(draft())), "other", rows, columns)
    ).toBe(nothingRestored);
    expect(loadDraft(storageWith(null), PROJECT, rows, columns)).toBe(
      nothingRestored
    );
    expect(loadDraft(storageWith("{broken"), PROJECT, rows, columns)).toBe(
      nothingRestored
    );
  });

  it("keys drafts by project", () => {
    expect(draftKey("abc")).toBe("i18n-studio:draft:abc");
  });
});

describe("relativeTime", () => {
  const now = 10_000_000_000;
  it("speaks in the page language", () => {
    expect(relativeTime(now - 5 * 60_000, now, "en")).toBe("5 minutes ago");
    expect(relativeTime(now - 3 * 3_600_000, now, "en")).toBe("3 hours ago");
    expect(relativeTime(now - 2 * 86_400_000, now, "en")).toBe("2 days ago");
    expect(relativeTime(now - 30_000, now, "en")).toBe("30 seconds ago");
    expect(relativeTime(now, now, "en")).toBe("now");
    expect(relativeTime(now - 5 * 60_000, now, "ko")).toBe("5분 전");
    expect(relativeTime(now - 5 * 60_000, now, "ja")).toBe("5 分前");
  });
});
