// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { makeT } from "../../src/ui/i18n.js";
import { Report } from "../../src/ui/report.js";
import {
  blur,
  button,
  cell,
  choose,
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
  type,
} from "./dom.js";

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
const grid = () => q("table");

beforeAll(installDomStubs);
afterEach(cleanup);

describe("cell editor", () => {
  it("opens on double-click and Enter commits into the staged set", async () => {
    await show();
    await dblclick(cell("home", "ko"));
    expect(editor()).not.toBeNull();
    expect(pending()).toBe("0 pending changes");
    await type(editor(), "집");
    await key(editor(), "Enter");
    expect(editor()).toBeNull();
    expect(pending()).toBe("1 pending change");
    const td = cell("home", "ko");
    expect(td?.classList.contains("dirty")).toBe(true);
    expect(td?.querySelector("del")?.textContent).toBe("홈");
    expect(td?.textContent).toContain("집");
    expect(td?.querySelector(".dot")).not.toBeNull();
  });

  it("a small edit shows only the changed words, a rewrite shows both values", async () => {
    await show();
    await dblclick(cell("home", "en"));
    await type(editor(), "Home page");
    await key(editor(), "Enter");
    const small = cell("home", "en");
    expect(small?.querySelector("ins.word")?.textContent).toBe(" page");
    expect(small?.querySelector("del")).toBeNull();
    await dblclick(cell("home", "ko"));
    await type(editor(), "집");
    await key(editor(), "Enter");
    const rewrite = cell("home", "ko");
    expect(rewrite?.querySelector("del:not(.word)")?.textContent).toBe("홈");
    expect(rewrite?.querySelector("ins")).toBeNull();
  });

  it("clicking inside the open editor keeps it open and focused", async () => {
    await show();
    await dblclick(cell("home", "ko"));
    await type(editor(), "집");
    await click(editor());
    await dblclick(editor());
    expect(editor()).not.toBeNull();
    expect(document.activeElement).toBe(editor());
    expect(editor()?.value).toBe("집");
    expect(pending()).toBe("0 pending changes");
  });

  it("Shift+Enter does not commit (it inserts a newline), Escape cancels", async () => {
    await show();
    await dblclick(cell("home", "ko"));
    await type(editor(), "a\nb");
    await key(editor(), "Enter", { shiftKey: true });
    expect(editor()).not.toBeNull();
    expect(pending()).toBe("0 pending changes");
    await key(editor(), "Escape");
    expect(editor()).toBeNull();
    expect(pending()).toBe("0 pending changes");
    expect(cell("home", "ko")?.textContent).toBe("홈");
  });

  it("Tab commits and moves to the next cell, wrapping to the next row", async () => {
    await show();
    await dblclick(cell("home", "ko"));
    await type(editor(), "집");
    await key(editor(), "Tab");
    expect(pending()).toBe("1 pending change");
    expect(grid()?.getAttribute("aria-activedescendant")).toBe("cell-1-1");
    await dblclick(cell("faq", "en"));
    await type(editor(), "FAQ!");
    await key(editor(), "Tab", { shiftKey: true });
    expect(pending()).toBe("2 pending changes");
    expect(grid()?.getAttribute("aria-activedescendant")).toBe("cell-0-2");
  });

  it("blur commits", async () => {
    await show();
    await dblclick(cell("home", "ko"));
    await type(editor(), "집");
    await blur(editor());
    expect(editor()).toBeNull();
    expect(pending()).toBe("1 pending change");
  });

  it("ignores Enter while an IME composition is active", async () => {
    await show();
    await dblclick(cell("home", "ko"));
    await type(editor(), "ㅈ");
    await key(editor(), "Enter", { isComposing: true });
    expect(editor()).not.toBeNull();
    expect(pending()).toBe("0 pending changes");
  });

  it("typing the original value back removes the change", async () => {
    await show();
    await dblclick(cell("home", "ko"));
    await type(editor(), "집");
    await key(editor(), "Enter");
    expect(pending()).toBe("1 pending change");
    await dblclick(cell("home", "ko"));
    expect(editor()?.value).toBe("집");
    await type(editor(), "홈");
    await key(editor(), "Enter");
    expect(pending()).toBe("0 pending changes");
    expect(button("Save")?.disabled).toBe(true);
    expect(button("Discard")?.disabled).toBe(true);
    expect(cell("home", "ko")?.querySelector("del")).toBeNull();
  });

  it("uses a labelled textarea for accessibility", async () => {
    await show();
    await dblclick(cell("home", "ko"));
    expect(editor()?.getAttribute("aria-label")).toBe("Edit ko: home");
  });
});

describe("grid keyboard", () => {
  it("arrow keys move the selected cell, Enter edits, Escape leaves the editor", async () => {
    await show();
    await key(grid(), "ArrowDown");
    expect(grid()?.getAttribute("aria-activedescendant")).toBe("cell-1-1");
    expect(q("#cell-1-1")?.getAttribute("aria-selected")).toBe("true");
    await key(grid(), "ArrowRight");
    expect(grid()?.getAttribute("aria-activedescendant")).toBe("cell-1-2");
    await key(grid(), "ArrowLeft");
    await key(grid(), "ArrowUp");
    expect(grid()?.getAttribute("aria-activedescendant")).toBe("cell-0-1");
    await key(grid(), "Enter");
    expect(editor()).not.toBeNull();
    await key(editor(), "Escape");
    expect(editor()).toBeNull();
    await key(grid(), "F2");
    expect(editor()).not.toBeNull();
  });

  it("Space selects the row, ? opens the shortcut sheet", async () => {
    await show();
    await key(grid(), "ArrowDown");
    await key(grid(), " ");
    expect(qa<HTMLInputElement>("td.check input")[1].checked).toBe(true);
    await key(document.body, "?");
    expect(q("dialog[open] h3")?.textContent).toBe("Keyboard shortcuts");
    expect(qa("dialog[open] li").length).toBeGreaterThanOrEqual(6);
  });

  it("does not steal keys from the search box", async () => {
    await show();
    await key(q('input[type="search"]'), "?");
    expect(q("dialog[open]")).toBeNull();
  });
});

describe("pending changes list", () => {
  it("expands into exactly what will be written, jumps to a cell and reverts one item", async () => {
    await show();
    await dblclick(cell("home", "ko"));
    await type(editor(), "집");
    await key(editor(), "Enter");
    await dblclick(cell("faq", "en"));
    await type(editor(), "FAQ!");
    await key(editor(), "Enter");
    expect(q("#pending-list")).toBeNull();
    await click(q("#pending"));
    expect(q("#pending")?.getAttribute("aria-expanded")).toBe("true");
    const entries = qa("#pending-list li");
    expect(
      entries.map((li) => li.querySelector(".entry-id")?.textContent)
    ).toEqual(["nav.faq", "nav.home"]);
    expect(entries[1].querySelector(".entry-change")?.textContent).toContain(
      "홈 → 집"
    );
    expect(entries[1].querySelector(".entry-what")?.textContent).toBe("ko");

    await click(entries[1].querySelector("button.entry"));
    expect(grid()?.getAttribute("aria-activedescendant")).toBe("cell-0-2");

    await click(entries[0].querySelector("button.mini"));
    expect(pending()).toBe("1 pending change");
    expect(cell("faq", "en")?.textContent).toBe("FAQ");
    await click(qa("#pending-list button.mini")[0]);
    expect(q("#pending-list")).toBeNull(); // nothing left to list
    expect(pending()).toBe("0 pending changes");
  });

  it("a jump selects the cell and centres it, clear of the open pending list", async () => {
    await show(model({ showArchived: true }));
    await dblclick(cell("home", "ko"));
    await type(editor(), "집");
    await key(editor(), "Enter");
    await click(cell("faq", "en"));
    await click(q("#pending"));
    const scrolled: Element[] = [];
    const spy = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(function (this: Element, arg) {
        if (typeof arg === "object" && arg.block === "center") {
          scrolled.push(this);
        }
      });
    await click(q("#pending-list button.entry"));
    spy.mockRestore();
    const target = cell("home", "ko");
    expect(grid()?.getAttribute("aria-activedescendant")).toBe(target?.id);
    expect(scrolled).toEqual([target]);
  });

  it("marks groups holding unsaved changes in the sidebar", async () => {
    await show();
    expect(qa("#side .dot")).toHaveLength(0);
    await dblclick(cell("home", "ko"));
    await type(editor(), "집");
    await key(editor(), "Enter");
    const marked = qa("#side button")
      .filter((b) => b.querySelector(".dot"))
      .map((b) => b.querySelector("span")?.firstChild?.textContent);
    expect(marked).toHaveLength(2); // "All" and the row's group
  });

  it("truncates long values and lists status changes", async () => {
    await show();
    await dblclick(cell("home", "ko"));
    await type(editor(), "x".repeat(200));
    await key(editor(), "Enter");
    await click(q(".badge-btn"));
    await click(
      qa('[role="menuitemradio"]').find((i) => i.textContent === "in-review")
    );
    await click(q("#pending"));
    const text = qa("#pending-list .entry-change").map(
      (e) => e.textContent ?? ""
    );
    expect(text[0]).toContain("…");
    expect(text[0].length).toBeLessThan(120);
    expect(text[1]).toBe("approved → in-review");
  });
});

describe("copy as TSV", () => {
  it("copies the current staged values", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await show();
    await dblclick(cell("home", "ko"));
    await type(editor(), "집");
    await key(editor(), "Enter");
    await click(button("Copy as TSV"));
    const copied = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(copied.split("\n")[0]).toBe("status\tnamespace\tkey\ten\tko");
    expect(copied).toContain("approved\tnav\thome\tHome\t집");
  });
});

describe("filters", () => {
  it("search narrows the rows and shows the empty state", async () => {
    await show();
    await type(q('input[type="search"]'), "faq");
    expect(qa("tbody tr:not(.group)")).toHaveLength(1);
    await type(q('input[type="search"]'), "zzz");
    expect(q(".empty")?.textContent).toBe("No rows match the current filters.");
    await choose(qa<HTMLSelectElement>(".filters select")[0], "approved");
    expect(q("table")).toBeNull();
  });

  it("highlights the search text in keys and values, ignoring case", async () => {
    await show();
    await type(q('input[type="search"]'), "FAQ");
    expect(qa("mark").map((m) => m.textContent.toLowerCase())).not.toHaveLength(
      0
    );
    expect(qa("mark").every((m) => m.textContent.toLowerCase() === "faq")).toBe(
      true
    );
    await type(q('input[type="search"]'), "");
    expect(qa("mark")).toHaveLength(0);
  });
});

describe("editor selection", () => {
  const open = async (how: "dblclick" | "enter" | "f2") => {
    if (how === "dblclick") {
      await dblclick(cell("home", "ko"));
    } else {
      await key(grid(), "ArrowDown");
      await key(grid(), how === "enter" ? "Enter" : "F2");
    }
    return editor() as HTMLTextAreaElement;
  };

  for (const how of ["dblclick", "enter", "f2"] as const) {
    it(`opens with the whole value selected (${how})`, async () => {
      await show();
      const ta = await open(how);
      expect(ta.value.length).toBeGreaterThan(0);
      expect(ta.selectionStart).toBe(0);
      expect(ta.selectionEnd).toBe(ta.value.length);
    });
  }

  it("selects the whole of a multi-line value", async () => {
    const m = model();
    m.rows[0].cells[1] = { text: "첫 줄\n둘째 줄\n셋째 줄" };
    await show(m);
    const ta = await open("dblclick");
    expect(ta.value).toBe("첫 줄\n둘째 줄\n셋째 줄");
    expect(ta.selectionStart).toBe(0);
    expect(ta.selectionEnd).toBe(ta.value.length);
  });

  it("typing replaces the selection; moving the caret edits in place", async () => {
    await show();
    await type(await open("dblclick"), "집");
    expect(editor()?.value).toBe("집");
    await key(editor(), "Enter");
    expect(pending()).toBe("1 pending change");

    const again = await open("dblclick");
    expect(again.selectionEnd - again.selectionStart).toBe(again.value.length);
    again.setSelectionRange(1, 1); // what an arrow key does in a browser
    expect(again.selectionStart).toBe(again.selectionEnd);
    await key(again, "Enter");
    expect(pending()).toBe("1 pending change");
  });
});
