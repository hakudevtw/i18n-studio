// @vitest-environment jsdom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { SaveConflict } from "../../src/model.js";
import { makeT } from "../../src/ui/i18n.js";
import { Report } from "../../src/ui/report.js";
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
const { ApiError } = await import("../../src/ui/api.js");

const onModel = vi.fn();
const show = (m = model()) =>
  mount(
    <Report
      locale="en"
      model={m}
      onLocale={noop}
      onModel={onModel}
      tr={makeT("en")}
    />
  );
const result = (extra = {}) => ({
  ok: true,
  written: { files: 1, cells: 1 },
  staleRows: 0,
  warnings: [],
  model: model(),
  ...extra,
});
const stage = async (rowKey: string, lang: string, value: string) => {
  await dblclick(cell(rowKey, lang));
  await type(editor(), value);
  await key(editor(), "Enter");
};

beforeAll(installDomStubs);
beforeEach(() => {
  api.saveBatch.mockReset();
  api.fetchModel.mockReset().mockResolvedValue(model());
  onModel.mockReset();
});
afterEach(cleanup);

describe("saving", () => {
  it("sends one batch with expectedOld from the baseline, then clears and replaces the model", async () => {
    api.saveBatch.mockResolvedValue(result());
    await show();
    await stage("home", "ko", "집");
    await stage("faq", "ko", "FAQ");
    await click(button("Save"));
    await settle();
    expect(api.saveBatch).toHaveBeenCalledTimes(1);
    expect(api.saveBatch).toHaveBeenCalledWith({
      edits: [
        { id: "nav.home", lang: "ko", expectedOld: "홈", new: "집" },
        {
          id: "nav.faq",
          lang: "ko",
          expectedOld: "자주 묻는 질문",
          new: "FAQ",
        },
      ],
      statuses: [],
    });
    expect(pending()).toBe("0 pending changes");
    expect(onModel).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Translation status" })
    );
    expect(q(".toast")?.textContent).toBe("Saved 2 changes.");
  });

  it("commits an editor that is still open before building the batch", async () => {
    api.saveBatch.mockResolvedValue(result());
    await show();
    await dblclick(cell("home", "ko"));
    await type(editor(), "집");
    await click(button("Save")); // no Enter first
    await settle();
    expect(api.saveBatch).toHaveBeenCalledWith({
      edits: [{ id: "nav.home", lang: "ko", expectedOld: "홈", new: "집" }],
      statuses: [],
    });
  });

  it("Ctrl+S saves, Cmd+S too", async () => {
    api.saveBatch.mockResolvedValue(result());
    await show();
    await stage("home", "ko", "집");
    await key(window, "s", { ctrlKey: true });
    await settle();
    expect(api.saveBatch).toHaveBeenCalledTimes(1);
    await stage("home", "ko", "집2");
    await key(window, "s", { metaKey: true });
    await settle();
    expect(api.saveBatch).toHaveBeenCalledTimes(2);
  });

  it("does nothing when there are no changes", async () => {
    await show();
    await key(window, "s", { ctrlKey: true });
    expect(api.saveBatch).not.toHaveBeenCalled();
    expect(button("Save")?.disabled).toBe(true);
  });

  it("includes the status changes and reports stale rows in the toast", async () => {
    api.saveBatch.mockResolvedValue(result({ staleRows: 2 }));
    await show();
    await click(q(".badge-btn"));
    await click(
      qa('[role="menuitemradio"]').find((i) => i.textContent === "in-review")
    );
    await click(button("Save"));
    await settle();
    expect(api.saveBatch).toHaveBeenCalledWith({
      edits: [],
      statuses: [
        { id: "nav.home", state: "in-review", expectedState: "approved" },
      ],
    });
    expect(q(".toast")?.textContent).toBe(
      "Saved 1 change. 2 rows are now stale"
    );
  });
});

describe("source locale edits", () => {
  it("asks first, counting rows that have translations, and only saves after confirmation", async () => {
    api.saveBatch.mockResolvedValue(result());
    await show();
    await stage("faq", "en", "FAQ!");
    await click(button("Save"));
    expect(api.saveBatch).not.toHaveBeenCalled();
    const dialog = q("dialog[open]");
    expect(dialog?.querySelector("p")?.textContent).toBe(
      "You are editing the source language. 1 row with existing translations will become stale and need review. Save anyway?"
    );
    await click(button("Cancel"));
    expect(q("dialog")).toBeNull();
    expect(api.saveBatch).not.toHaveBeenCalled();
    expect(pending()).toBe("1 pending change");
    await click(button("Save"));
    await click(button("Save anyway"));
    await settle();
    expect(api.saveBatch).toHaveBeenCalledTimes(1);
    expect(pending()).toBe("0 pending changes");
  });

  it("does not ask for edits of other languages", async () => {
    api.saveBatch.mockResolvedValue(result());
    await show();
    await stage("faq", "ko", "x");
    await click(button("Save"));
    expect(q("dialog")).toBeNull();
    expect(api.saveBatch).toHaveBeenCalledTimes(1);
  });
});

describe("conflicts (409)", () => {
  const conflict: SaveConflict[] = [
    { id: "nav.home", lang: "ko", kind: "value", current: "디스크" },
  ];
  const stageConflict = async () => {
    api.saveBatch.mockRejectedValueOnce(
      new ApiError(409, "conflict", conflict)
    );
    await show();
    await stage("home", "ko", "집");
    await stage("faq", "ko", "FAQ");
    await click(button("Save"));
    await settle();
  };

  it("keeps every staged edit and marks the conflicted cell with the value on disk", async () => {
    await stageConflict();
    expect(pending()).toBe("2 pending changes");
    expect(q("#error")?.textContent).toContain("Some values changed on disk");
    expect(qa(".conflict")).toHaveLength(1);
    expect(q(".conflict-value")?.textContent).toBe("디스크");
    expect(cell("home", "ko")?.classList.contains("conflicted")).toBe(true);
    expect(api.fetchModel).toHaveBeenCalled(); // refreshed in the background
  });

  it("Keep mine re-bases the expectation on what is on disk", async () => {
    await stageConflict();
    await click(button("Keep mine"));
    expect(qa(".conflict")).toHaveLength(0);
    expect(pending()).toBe("2 pending changes");
    api.saveBatch.mockResolvedValueOnce(result());
    await click(button("Save"));
    await settle();
    expect(api.saveBatch).toHaveBeenLastCalledWith({
      edits: [
        { id: "nav.home", lang: "ko", expectedOld: "디스크", new: "집" },
        {
          id: "nav.faq",
          lang: "ko",
          expectedOld: "자주 묻는 질문",
          new: "FAQ",
        },
      ],
      statuses: [],
    });
  });

  it("Use theirs drops my edit and keeps the others", async () => {
    await stageConflict();
    await click(button("Use theirs"));
    expect(pending()).toBe("1 pending change");
    expect(qa(".conflict")).toHaveLength(0);
    expect(cell("home", "ko")?.textContent).toBe("홈");
  });

  it("refuses to send while a conflict is unresolved", async () => {
    await stageConflict();
    await click(button("Save"));
    expect(api.saveBatch).toHaveBeenCalledTimes(1);
  });

  it("shows the state on disk for a status conflict", async () => {
    api.saveBatch.mockRejectedValueOnce(
      new ApiError(409, "conflict", [
        { id: "nav.home", kind: "state", current: "stale" },
      ])
    );
    await show();
    await click(q(".badge-btn"));
    await click(
      qa('[role="menuitemradio"]').find((i) => i.textContent === "archived")
    );
    await click(button("Save"));
    await settle();
    expect(q(".conflict")?.textContent).toContain("Status on disk now: stale");
    await click(button("Keep mine"));
    api.saveBatch.mockResolvedValueOnce(result());
    await click(button("Save"));
    await settle();
    expect(api.saveBatch).toHaveBeenLastCalledWith({
      edits: [],
      statuses: [{ id: "nav.home", state: "archived", expectedState: "stale" }],
    });
  });
});

describe("other save errors keep the staged edits", () => {
  const cases: [string, unknown, string][] = [
    ["403", new ApiError(403, "forbidden"), "refused the save"],
    ["413", new ApiError(413, "body too large"), "Too many changes"],
    [
      "400",
      new ApiError(400, "nothing to save"),
      "The save was rejected: nothing to save",
    ],
    [
      "network",
      new TypeError("fetch failed"),
      "Could not reach the server: fetch failed",
    ],
  ];
  for (const [name, error, text] of cases) {
    it(`shows a clear message for ${name}`, async () => {
      api.saveBatch.mockRejectedValueOnce(error);
      await show();
      await stage("home", "ko", "집");
      await click(button("Save"));
      await settle();
      expect(q("#error")?.textContent).toContain(text);
      expect(pending()).toBe("1 pending change");
      expect(button("Save")?.disabled).toBe(false);
    });
  }
});

describe("discard and the unload guard", () => {
  it("asks before discarding and then clears everything", async () => {
    await show();
    await stage("home", "ko", "집");
    await click(button("Discard"));
    expect(q("dialog[open] p")?.textContent).toBe(
      "Discard 1 pending change? It cannot be recovered."
    );
    await click(button("Cancel"));
    expect(pending()).toBe("1 pending change");
    await click(button("Discard"));
    await click(
      qa<HTMLButtonElement>("dialog button").find(
        (b) => b.textContent === "Discard"
      )
    );
    expect(pending()).toBe("0 pending changes");
    expect(cell("home", "ko")?.textContent).toBe("홈");
  });

  it("registers beforeunload only while changes are pending", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const guarded = (spy: typeof add) =>
      spy.mock.calls.filter(([name]) => name === "beforeunload").length;
    await show();
    expect(guarded(add)).toBe(0);
    await stage("home", "ko", "집");
    expect(guarded(add)).toBe(1);
    const handler = add.mock.calls.find(
      ([name]) => name === "beforeunload"
    )?.[1] as EventListener;
    const event = new Event("beforeunload", { cancelable: true });
    handler(event);
    expect(event.defaultPrevented).toBe(true);
    await click(button("Discard"));
    await click(
      qa<HTMLButtonElement>("dialog button").find(
        (b) => b.textContent === "Discard"
      )
    );
    expect(guarded(remove)).toBeGreaterThanOrEqual(1);
    add.mockRestore();
    remove.mockRestore();
  });
});

describe("permanent delete", () => {
  const selectRow = async (rowKey: string) =>
    click(
      qa<HTMLInputElement>("tbody tr")
        .find((r) => r.querySelector("td.key")?.textContent === rowKey)
        ?.querySelector('input[type="checkbox"]')
    );
  const deleteButton = () => q("button.act.danger");

  it("is offered only when every selected row is archived", async () => {
    await show(model({ showArchived: true }));
    await selectRow("ok");
    expect(deleteButton()).toBeNull();
    await selectRow("ok");
    await selectRow("old");
    expect(deleteButton()?.textContent).toBe("Delete 1 permanently");
  });

  it("is blocked while edits are pending", async () => {
    await show(model({ showArchived: true }));
    await stage("home", "ko", "집");
    await selectRow("old");
    expect(deleteButton()?.hasAttribute("disabled")).toBe(true);
  });

  it("confirms with the keys listed, then sends only the prune", async () => {
    api.saveBatch.mockResolvedValue(
      result({ written: { files: 3, cells: 0, deleted: 1 } })
    );
    await show(model({ showArchived: true }));
    await selectRow("old");
    await click(deleteButton());
    expect(qa(".confirm-items li").map((li) => li.textContent)).toEqual([
      "common.old",
    ]);
    await click(q("dialog button.act.danger"));
    await settle();
    expect(api.saveBatch).toHaveBeenCalledWith({
      edits: [],
      statuses: [],
      prune: [{ id: "common.old" }],
    });
    expect(onModel).toHaveBeenCalled();
    expect(q(".toast")?.textContent).toBe("Deleted 1 key");
  });
});
