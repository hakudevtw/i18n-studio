// @vitest-environment jsdom
import { act } from "preact/test-utils";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { DRAFT_VERSION, type Draft, draftKey } from "../../src/ui/draft.js";
import { makeT } from "../../src/ui/i18n.js";
import { Report } from "../../src/ui/report.js";
import { App } from "../../src/ui/studio-app.js";
import {
  button,
  cell,
  cleanup,
  click,
  dblclick,
  editor,
  installDomStubs,
  key,
  model,
  mount,
  noop,
  pending,
  q,
  qa,
  settle,
  type,
} from "./dom.js";

const api = vi.hoisted(() => ({ saveBatch: vi.fn(), fetchModel: vi.fn() }));
vi.mock("../../src/ui/api", async (original) => ({
  ...(await original<typeof import("../../src/ui/api")>()),
  ...api,
}));

const KEY = draftKey("proj-test");
const show = (m = model()) =>
  mount(
    <Report
      locale="en"
      model={m}
      onLocale={noop}
      onModel={noop}
      tr={makeT("en")}
    />
  );
const stage = async (rowKey: string, lang: string, value: string) => {
  await dblclick(cell(rowKey, lang));
  await type(editor(), value);
  await key(editor(), "Enter");
};
const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
const stored = (): Draft | null => {
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as Draft) : null;
};
const seed = (over: Partial<Draft> = {}) =>
  localStorage.setItem(
    KEY,
    JSON.stringify({
      version: DRAFT_VERSION,
      projectId: "proj-test",
      savedAt: Date.now() - 5 * 60_000,
      edits: [{ id: "nav.home", lang: "ko", original: "홈", current: "집" }],
      statuses: [],
      ...over,
    })
  );

beforeAll(installDomStubs);
beforeEach(() => {
  localStorage.clear();
  api.saveBatch.mockReset();
  api.fetchModel.mockReset().mockResolvedValue(model());
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("persisting", () => {
  it("writes the staged set after a short delay, and a remount restores it with a banner", async () => {
    await show();
    await stage("home", "ko", "집");
    expect(stored()).toBeNull(); // debounced
    await wait(400);
    expect(stored()).toMatchObject({
      version: DRAFT_VERSION,
      projectId: "proj-test",
      edits: [{ id: "nav.home", lang: "ko", original: "홈", current: "집" }],
      statuses: [],
    });
    expect(JSON.stringify(stored()).toLowerCase()).not.toContain("token");

    cleanup(); // the tab is closed or refreshed
    await show();
    expect(pending()).toBe("1 pending change");
    expect(cell("home", "ko")?.classList.contains("dirty")).toBe(true);
    expect(cell("home", "ko")?.textContent).toContain("집");
    expect(q("#draft")?.textContent).toContain(
      "Restored 1 unsaved change (saved now)"
    );
  });

  it("flushes immediately when the page is hidden or closed", async () => {
    await show();
    await stage("home", "ko", "집");
    window.dispatchEvent(new Event("pagehide"));
    expect(stored()?.edits).toHaveLength(1);
    localStorage.clear();
    await stage("faq", "ko", "질문!");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(stored()?.edits).toHaveLength(2);
  });

  it("stores status changes too", async () => {
    await show();
    await click(q(".badge-btn"));
    await click(
      qa('[role="menuitemradio"]').find((i) => i.textContent === "in-review")
    );
    await wait(400);
    expect(stored()?.statuses).toEqual([
      { id: "nav.home", state: "in-review", expectedState: "approved" },
    ]);
    cleanup();
    await show();
    expect(q("td.status.dirty .badge")?.textContent).toBe("in-review");
  });

  it("removes the draft as soon as nothing is pending (revert to the original)", async () => {
    await show();
    await stage("home", "ko", "집");
    await wait(400);
    expect(stored()).not.toBeNull();
    await stage("home", "ko", "홈");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("clears the draft after a successful save", async () => {
    api.saveBatch.mockResolvedValue({
      ok: true,
      written: { files: 1, cells: 1 },
      staleRows: 0,
      warnings: [],
      model: model(),
    });
    await show();
    await stage("home", "ko", "집");
    await wait(400);
    expect(stored()).not.toBeNull();
    await click(button("Save"));
    await settle();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("clears the draft on a confirmed discard, but not when the confirmation is cancelled", async () => {
    await show();
    await stage("home", "ko", "집");
    await wait(400);
    await click(button("Discard"));
    await click(button("Cancel"));
    await wait(400);
    expect(stored()).not.toBeNull();
    await click(button("Discard"));
    await click(
      qa<HTMLButtonElement>("dialog button").find(
        (b) => b.textContent === "Discard"
      )
    );
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe("restoring", () => {
  it("the banner's Discard asks first, then clears everything restored", async () => {
    seed();
    await show();
    expect(pending()).toBe("1 pending change");
    await click(
      qa<HTMLButtonElement>("#draft button").find(
        (b) => b.textContent === "Discard"
      )
    );
    expect(q("dialog[open] p")?.textContent).toContain(
      "Discard 1 pending change?"
    );
    await click(
      qa<HTMLButtonElement>("dialog button").find(
        (b) => b.textContent === "Discard"
      )
    );
    expect(pending()).toBe("0 pending changes");
    expect(q("#draft")).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("the banner can be dismissed without discarding", async () => {
    seed();
    await show();
    await click(button("Dismiss"));
    expect(q("#draft")).toBeNull();
    expect(pending()).toBe("1 pending change");
  });

  it("shows a restored edit whose original changed as a conflict, with both resolutions", async () => {
    seed({
      edits: [
        { id: "nav.home", lang: "ko", original: "예전 값", current: "집" },
      ],
    });
    await show();
    expect(q("#draft")?.textContent).toContain(
      "1 conflicts with a change on disk"
    );
    expect(q(".conflict-value")?.textContent).toBe("홈");
    expect(cell("home", "ko")?.classList.contains("conflicted")).toBe(true);

    await click(button("Keep mine"));
    expect(qa(".conflict")).toHaveLength(0);
    expect(pending()).toBe("1 pending change");
    api.saveBatch.mockResolvedValueOnce({
      ok: true,
      written: { files: 1, cells: 1 },
      staleRows: 0,
      warnings: [],
      model: model(),
    });
    await click(button("Save"));
    await settle();
    expect(api.saveBatch).toHaveBeenCalledWith({
      edits: [{ id: "nav.home", lang: "ko", expectedOld: "홈", new: "집" }],
      statuses: [],
    });
  });

  it("Use theirs drops a conflicted restored edit", async () => {
    seed({
      edits: [
        { id: "nav.home", lang: "ko", original: "예전 값", current: "집" },
      ],
    });
    await show();
    await click(button("Use theirs"));
    expect(pending()).toBe("0 pending changes");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("drops edits for rows or languages that are gone and says so", async () => {
    seed({
      edits: [
        { id: "nav.gone", lang: "ko", original: "a", current: "b" },
        { id: "nav.home", lang: "ko", original: "홈", current: "집" },
      ],
    });
    await show();
    expect(pending()).toBe("1 pending change");
    expect(q("#draft")?.textContent).toContain("1 could not be restored");
  });

  it("restores a status conflict as a status conflict", async () => {
    seed({
      edits: [],
      statuses: [{ id: "nav.faq", state: "approved", expectedState: "stale" }],
    });
    await show();
    expect(q(".conflict")?.textContent).toContain("Status on disk now: edited");
  });

  it("ignores a draft of another project, a corrupt one, or an old version", async () => {
    for (const raw of [
      JSON.stringify({
        version: DRAFT_VERSION,
        projectId: "elsewhere",
        savedAt: 1,
        edits: [{ id: "nav.home", lang: "ko", original: "홈", current: "집" }],
        statuses: [],
      }),
      "{corrupt",
      JSON.stringify({
        version: 0,
        projectId: "proj-test",
        savedAt: 1,
        edits: [],
        statuses: [],
      }),
    ]) {
      localStorage.setItem(KEY, raw);
      await show();
      expect(pending()).toBe("0 pending changes");
      expect(q("#draft")).toBeNull();
      cleanup();
    }
  });
});

describe("when the draft cannot be kept", () => {
  it("shows a notice only while changes are pending, and editing keeps working", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await show();
    expect(q("#draft-trouble")).toBeNull();
    await stage("home", "ko", "집");
    await wait(400);
    expect(q("#draft-trouble")?.textContent).toContain("cannot keep drafts");
    expect(pending()).toBe("1 pending change");
    await stage("faq", "ko", "질문!");
    expect(pending()).toBe("2 pending changes");
    await stage("home", "ko", "홈");
    await stage("faq", "ko", "자주 묻는 질문");
    expect(q("#draft-trouble")).toBeNull();
  });

  it("works when reading storage throws too", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await show();
    await stage("home", "ko", "집");
    expect(pending()).toBe("1 pending change");
  });

  it("warns, and stops keeping the draft, when it is too large", async () => {
    await show();
    await dblclick(cell("home", "ko"));
    await type(editor(), "x".repeat(1_100_000));
    await key(editor(), "Enter");
    await wait(400);
    expect(q("#draft-trouble")?.textContent).toContain("too large");
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe("another tab", () => {
  it("warns when another tab changes the draft while changes are pending", async () => {
    await show();
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    await settle();
    expect(q("#draft-other-tab")).toBeNull(); // nothing pending here: nothing to lose
    await stage("home", "ko", "집");
    await act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: KEY, newValue: "{}" })
      );
    });
    expect(q("#draft-other-tab")?.textContent).toContain(
      "Another browser tab changed the draft"
    );
    await click(qa<HTMLButtonElement>("#draft-other-tab button")[0]);
    expect(q("#draft-other-tab")).toBeNull();
  });

  it("ignores storage events for other keys", async () => {
    await show();
    await stage("home", "ko", "집");
    await act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "something-else" })
      );
    });
    expect(q("#draft-other-tab")).toBeNull();
  });
});

describe("never persisting", () => {
  const spies = () => ({
    get: vi.spyOn(Storage.prototype, "getItem"),
    set: vi.spyOn(Storage.prototype, "setItem"),
    del: vi.spyOn(Storage.prototype, "removeItem"),
  });
  const touchedDraft = (s: ReturnType<typeof spies>) =>
    [s.get, s.set, s.del].some((spy) =>
      spy.mock.calls.some(([k]) => String(k).startsWith("i18n-studio:draft"))
    );

  it("with persistDrafts off: nothing is read or written, and an existing draft is left alone", async () => {
    seed();
    const before = localStorage.getItem(KEY);
    const s = spies();
    await show(model({ persistDrafts: false }));
    expect(pending()).toBe("0 pending changes");
    expect(q("#draft")).toBeNull();
    await stage("home", "ko", "집");
    window.dispatchEvent(new Event("pagehide"));
    await wait(400);
    expect(touchedDraft(s)).toBe(false);
    expect(localStorage.getItem(KEY)).toBe(before);
  });

  it("in read-only mode: nothing is read or written", async () => {
    seed();
    const s = spies();
    await show(model({ readOnly: true }));
    await wait(400);
    expect(pending()).toBeUndefined();
    expect(touchedDraft(s)).toBe(false);
  });

  it("the static report (embedded model) never persists", async () => {
    seed();
    const script = document.createElement("script");
    script.type = "application/json";
    script.id = "data";
    script.textContent = JSON.stringify(model({ readOnly: true }));
    document.body.appendChild(script);
    const s = spies();
    await mount(<App />);
    await vi.waitFor(() => {
      if (!q(".bar")) {
        throw new Error("not rendered yet");
      }
    });
    await wait(400);
    expect(touchedDraft(s)).toBe(false);
    expect(q("#draft")).toBeNull();
  });
});
