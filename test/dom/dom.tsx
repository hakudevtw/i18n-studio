import { type ComponentChild, render } from "preact";
import { act } from "preact/test-utils";
import type { Model } from "../../src/model.js";

/** Does nothing, on purpose. */
export const noop = (): void => {
  // intentionally empty
};

/** jsdom lacks a few browser APIs the page uses; stand them in. */
export const installDomStubs = () => {
  const dialog = HTMLDialogElement.prototype;
  dialog.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  dialog.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  Element.prototype.scrollIntoView = noop;
  Element.prototype.scrollTo = noop;
};

export const model = (overrides: Partial<Model> = {}): Model => ({
  title: "Translation status",
  columns: ["en", "ko"],
  banners: [],
  copyHeader: true,
  uiLocale: "en",
  readOnly: false,
  languageSwitcher: true,
  showArchived: false,
  storedStates: ["ai-draft", "in-review", "approved", "archived"],
  rows: [
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
      cells: [
        { text: "FAQ" },
        { text: "자주 묻는 질문", changed: true, mark: "changed" },
      ],
    },
    {
      group: "common",
      key: "ok",
      status: "approved",
      cells: [{ text: "OK" }, { text: "확인" }],
    },
    {
      group: "common",
      key: "old",
      status: "archived",
      cells: [{ text: "Old" }, { text: "옛" }],
    },
  ],
  ...overrides,
});

const mounted: HTMLElement[] = [];

export const mount = async (ui: ComponentChild) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  mounted.push(host);
  await act(() => {
    render(ui, host);
  });
  return host;
};

export const cleanup = () => {
  for (const host of mounted.splice(0)) {
    render(null, host);
    host.remove();
  }
  document.body.replaceChildren();
  history.replaceState(null, "", "/");
};

export const q = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector);
export const qa = <T extends Element = HTMLElement>(selector: string) => [
  ...document.querySelectorAll<T>(selector),
];

/** The text of the first match for a button, by its visible label. */
export const button = (label: string) =>
  qa<HTMLButtonElement>("button").find((b) => b.textContent?.trim() === label);

export const click = (el: Element | null | undefined) =>
  act(() => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

export const dblclick = (el: Element | null | undefined) =>
  act(() => {
    el?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });

export const key = (
  el: Element | Window | null | undefined,
  name: string,
  init: KeyboardEventInit = {}
) =>
  act(() => {
    el?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: name,
        bubbles: true,
        cancelable: true,
        ...init,
      })
    );
  });

/** Set a field's value the way typing does. */
export const type = (
  el: HTMLInputElement | HTMLTextAreaElement | null,
  value: string
) =>
  act(() => {
    if (el) {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

export const choose = (el: HTMLSelectElement | null, value: string) =>
  act(() => {
    if (el) {
      el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

export const blur = (el: Element | null) =>
  act(() => {
    el?.dispatchEvent(new FocusEvent("blur"));
  });

export const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** The cell of `rowKey` in column `lang` (the order of the model's columns). */
export const cell = (rowKey: string, lang: string, columns = ["en", "ko"]) => {
  const row = qa("tbody tr").find(
    (r) => r.querySelector("td.key")?.textContent === rowKey
  );
  return (
    row?.querySelectorAll<HTMLElement>("td.text")[columns.indexOf(lang)] ?? null
  );
};

export const editor = () => q<HTMLTextAreaElement>("textarea.editor");
export const pending = () => q("#pending")?.textContent;
