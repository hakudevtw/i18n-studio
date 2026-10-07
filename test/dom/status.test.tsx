// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { makeT } from "../../src/ui/i18n.js";
import { Report } from "../../src/ui/report.js";
import {
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
const items = () => qa('[role="menuitemradio"]');
const item = (label: string) => items().find((i) => i.textContent === label);
const bodyRows = () => qa("tbody tr:not(.group)");

beforeAll(installDomStubs);
afterEach(cleanup);

describe("row status menu", () => {
  it("lists only storable states, in a top-level layer outside the scroll container", async () => {
    await show({
      ...model(),
      storedStates: [
        "ai-draft",
        "in-review",
        "approved",
        "archived",
        "legal-ok",
      ],
    });
    await click(q(".badge-btn"));
    const menu = q('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(items().map((i) => i.textContent)).toEqual([
      "ai-draft",
      "in-review",
      "approved",
      "archived",
      "legal-ok",
    ]);
    for (const derived of ["missing", "stale", "edited", "new"]) {
      expect(item(derived)).toBeUndefined();
    }
    expect(menu?.closest(".scroll")).toBeNull();
    expect(menu?.closest("td")).toBeNull();
    expect(item("approved")?.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(item("approved"));
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    await show();
    const trigger = q(".badge-btn");
    await click(trigger);
    await key(q('[role="menu"]'), "Escape");
    expect(q('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on an outside click, on scroll and on resize", async () => {
    await show();
    for (const close of [
      () =>
        document.body.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true })
        ),
      () => window.dispatchEvent(new Event("scroll")),
      () => window.dispatchEvent(new Event("resize")),
    ]) {
      await click(q(".badge-btn"));
      expect(q('[role="menu"]')).not.toBeNull();
      await act(() => {
        close();
      });
      expect(q('[role="menu"]')).toBeNull();
    }
  });

  it("clicking the trigger again closes it, arrow keys move between items", async () => {
    await show();
    await click(q(".badge-btn"));
    await key(q('[role="menu"]'), "ArrowDown");
    expect(document.activeElement).toBe(item("archived"));
    await key(q('[role="menu"]'), "ArrowDown");
    expect(document.activeElement).toBe(item("ai-draft"));
    await key(q('[role="menu"]'), "End");
    expect(document.activeElement).toBe(item("archived"));
    await click(q(".badge-btn"));
    expect(q('[role="menu"]')).toBeNull();
  });

  it("stages the chosen status; choosing the current state stages nothing", async () => {
    await show();
    await click(q(".badge-btn"));
    await click(item("approved"));
    expect(pending()).toBe("0 pending changes");
    await click(q(".badge-btn"));
    await click(item("in-review"));
    expect(pending()).toBe("1 pending change");
    expect(q("td.status.dirty .badge")?.textContent).toBe("in-review");
    await click(q(".badge-btn"));
    expect(item("in-review")?.getAttribute("aria-checked")).toBe("true");
    await click(item("approved")); // back to what is on disk
    expect(pending()).toBe("0 pending changes");
  });

  it("opens from the keyboard on the status cell", async () => {
    await show();
    await key(q("table"), "ArrowDown");
    await key(q("table"), "ArrowLeft");
    await key(q("table"), "Enter");
    expect(q('[role="menu"]')).not.toBeNull();
  });
});

describe("bulk status", () => {
  it("selects all visible rows and stages one status for them", async () => {
    await show();
    await click(q("th.check input"));
    expect(qa<HTMLInputElement>("td.check input").every((i) => i.checked)).toBe(
      true
    );
    expect(button("Set status for 3 selected")?.disabled).toBe(true);
    await choose(q<HTMLSelectElement>(".bulk select"), "archived");
    await click(button("Set status for 3 selected"));
    expect(pending()).toBe("3 pending changes");
    expect(q(".bulk")).toBeNull();
    expect(qa("td.status.dirty")).toHaveLength(3);
  });

  it("skips rows that already have that status and toggles single rows", async () => {
    await show();
    await click(qa("td.check input")[0]);
    await click(qa("td.check input")[2]);
    await choose(q<HTMLSelectElement>(".bulk select"), "approved");
    await click(button("Set status for 2 selected"));
    expect(pending()).toBe("0 pending changes");
    await click(qa("td.check input")[0]);
    await click(qa("td.check input")[0]);
    expect(q(".bulk")).toBeNull();
  });
});

describe("archived rows", () => {
  it("are hidden by default and shown with the toggle, read-only except for the status", async () => {
    await show();
    expect(bodyRows()).toHaveLength(3);
    const toggle = qa<HTMLInputElement>("label.chk input")[0];
    expect(toggle.checked).toBe(false);
    await click(toggle);
    expect(toggle.checked).toBe(true);
    expect(bodyRows()).toHaveLength(4);
    const archived = qa("tr.archived")[0];
    expect(archived.querySelector("td.key")?.textContent).toBe("old");
    await dblclick(cell("old", "ko"));
    expect(editor()).toBeNull();
    expect(cell("old", "ko")?.getAttribute("title")).toBe(
      "Archived rows are read-only"
    );
    await click(archived.querySelector(".badge-btn"));
    await click(item("approved"));
    expect(pending()).toBe("1 pending change");
    await click(toggle);
    expect(bodyRows()).toHaveLength(3);
  });

  it("starts in the configured state and flips", async () => {
    await show(model({ showArchived: true }));
    const toggle = qa<HTMLInputElement>("label.chk input")[0];
    expect(toggle.checked).toBe(true);
    expect(bodyRows()).toHaveLength(4);
    await click(toggle);
    expect(toggle.checked).toBe(false);
    expect(bodyRows()).toHaveLength(3);
  });

  it("choosing the archived status filter reveals them", async () => {
    await show();
    await choose(qa<HTMLSelectElement>(".filters select")[0], "archived");
    expect(bodyRows()).toHaveLength(1);
  });

  it("do not count towards the sidebar totals while hidden", async () => {
    await show();
    expect(q("#side button")?.textContent).toBe("All3");
    await click(qa<HTMLInputElement>("label.chk input")[0]);
    expect(q("#side button")?.textContent).toBe("All4");
  });
});

describe("read-only mode", () => {
  it("renders no edit affordances at all", async () => {
    await show(model({ readOnly: true }));
    expect(q(".savebar")).toBeNull();
    expect(q("th.check")).toBeNull();
    expect(q("td.check")).toBeNull();
    expect(q(".badge-btn")).toBeNull();
    expect(q("table")?.getAttribute("tabindex")).toBeNull();
    expect(q('button[aria-label="Keyboard shortcuts (?)"]')).toBeNull();
    await dblclick(cell("home", "ko"));
    expect(editor()).toBeNull();
    await key(q("table"), "Enter");
    expect(editor()).toBeNull();
    await key(document.body, "?");
    expect(q("dialog")).toBeNull();
    await key(window, "s", { ctrlKey: true });
    expect(q(".toast")).toBeNull();
    expect(button("Copy as TSV")).toBeDefined();
  });
});

describe("top bar layout", () => {
  it("groups title and count on the left, language switcher and shortcuts on the right", async () => {
    await show();
    const bar = q(".bar");
    expect([...(bar?.children ?? [])].map((c) => c.className)).toEqual([
      "bar-title",
      "bar-actions",
    ]);
    const title = q(".bar-title");
    expect([...(title?.children ?? [])].map((c) => c.tagName)).toEqual([
      "H2",
      "SPAN",
    ]);
    expect(q("#count")?.parentElement).toBe(title);
    const actions = [...(q(".bar-actions")?.children ?? [])];
    expect(actions.map((c) => c.tagName)).toEqual([
      "SELECT",
      "BUTTON",
      "BUTTON",
    ]);
    expect(actions[1].getAttribute("aria-label")).toBe("Switch to dark theme");
    expect(actions[2].getAttribute("aria-label")).toBe(
      "Keyboard shortcuts (?)"
    );
    expect(actions[2].classList.contains("icon")).toBe(true);
    expect(actions[2].textContent).toBe("?");
  });

  it("omits the switcher when it is turned off", async () => {
    await show(model({ languageSwitcher: false }));
    expect(
      [...(q(".bar-actions")?.children ?? [])].map((c) => c.tagName)
    ).toEqual(["BUTTON", "BUTTON"]);
  });

  it("follows the system theme until a theme is picked, then remembers it", async () => {
    localStorage.removeItem("i18n-studio.theme");
    await show();
    await click(q('[aria-label="Switch to dark theme"]'));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("i18n-studio.theme")).toBe("dark");
    await click(q('[aria-label="Switch to light theme"]'));
    expect(document.documentElement.dataset.theme).toBe("light");
    localStorage.removeItem("i18n-studio.theme");
    delete document.documentElement.dataset.theme;
  });
});
