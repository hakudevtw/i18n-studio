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
import type { Model } from "../../src/model.js";
import { forget, remember } from "../../src/ui/remember.js";
import { App } from "../../src/ui/studio-app.js";
import { choose, cleanup, installDomStubs, model, mount, q } from "./dom.js";

/** The static-report path: the model is embedded, nothing is fetched. */
const embed = (m: Model) => {
  const script = document.createElement("script");
  script.type = "application/json";
  script.id = "data";
  script.textContent = JSON.stringify(m);
  document.body.appendChild(script);
};
const open = async (m: Model) => {
  embed(m);
  await mount(<App />);
  await vi.waitFor(() => {
    if (!q(".bar")) {
      throw new Error("page not rendered yet");
    }
  });
  // Effects after a state change outside act() run on the next animation frame.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
};
const picker = () => q<HTMLSelectElement>(".lang-switcher");

beforeAll(installDomStubs);
beforeEach(() => {
  forget();
  history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  forget();
  vi.restoreAllMocks();
});

describe("language switcher", () => {
  it("offers the four languages, and a choice changes the page and is remembered", async () => {
    await open(model({ uiLocale: "en" }));
    expect([...(picker()?.options ?? [])].map((o) => o.value)).toEqual([
      "en",
      "ko",
      "zh-TW",
      "ja",
    ]);
    expect(document.documentElement.lang).toBe("en");
    await choose(picker(), "ko");
    expect(document.documentElement.lang).toBe("ko");
    expect(document.title).toBe("번역 현황");
    expect(localStorage.getItem("i18n-studio.lang")).toBe("ko");

    cleanup(); // a new page view picks the remembered choice up
    await open(model({ uiLocale: "en" }));
    expect(document.documentElement.lang).toBe("ko");
    expect(picker()?.value).toBe("ko");
  });

  it("?lang= beats the remembered choice, which beats uiLocale", async () => {
    remember("zh-TW");
    history.replaceState(null, "", "/?lang=ja");
    await open(model({ uiLocale: "ko" }));
    expect(document.documentElement.lang).toBe("ja");
    cleanup();
    history.replaceState(null, "", "/");
    await open(model({ uiLocale: "ko" }));
    expect(document.documentElement.lang).toBe("zh-TW");
  });

  it("falls back to uiLocale, then the browser language", async () => {
    await open(model({ uiLocale: "ja" }));
    expect(document.documentElement.lang).toBe("ja");
    cleanup();
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["ko-KR"]);
    await open(model({ uiLocale: "auto" }));
    expect(document.documentElement.lang).toBe("ko");
  });

  it("switcher off: no select, and the remembered choice is ignored (?lang= still works)", async () => {
    remember("ko");
    await open(model({ uiLocale: "ja", languageSwitcher: false }));
    expect(picker()).toBeNull();
    expect(document.documentElement.lang).toBe("ja");
    cleanup();
    history.replaceState(null, "", "/?lang=zh-TW");
    await open(model({ uiLocale: "ja", languageSwitcher: false }));
    expect(document.documentElement.lang).toBe("zh-TW");
  });

  it("still switches for the session when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await open(model({ uiLocale: "en" }));
    await choose(picker(), "ja");
    expect(document.documentElement.lang).toBe("ja");
    cleanup();
    await open(model({ uiLocale: "en" })); // same page session: remembered in memory
    expect(document.documentElement.lang).toBe("ja");
  });
});

describe("page text follows the language", () => {
  it("translates the visible strings, with raw names for unknown states", async () => {
    await open(
      model({
        uiLocale: "ko",
        storedStates: [
          "ai-draft",
          "in-review",
          "approved",
          "archived",
          "legal-ok",
        ],
        rows: [
          {
            group: "a",
            key: "k",
            status: "legal-ok",
            cells: [{ text: "x" }, { text: "y" }],
          },
        ],
      })
    );
    expect(q("aside h1")?.textContent).toBe("번역 현황");
    expect(q(".badge")?.textContent).toBe("legal-ok");
    expect(q('input[type="search"]')?.getAttribute("placeholder")).toBe(
      "키 또는 텍스트 검색"
    );
  });
});
