// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
  model,
  mount,
  noop,
  pending,
  q,
  settle,
  type,
} from "./dom.js";

const show = () =>
  mount(
    <Report
      locale="en"
      model={model({ offline: true })}
      onLocale={noop}
      onModel={noop}
      tr={makeT("en")}
    />
  );

beforeAll(installDomStubs);
afterEach(async () => {
  cleanup();
  await settle(); // let preact run the unmount effects before jsdom goes away
});

describe("offline review page", () => {
  it("edits translations, never the source language or a status", async () => {
    await show();
    expect(q("#offline-note")?.textContent).toContain("download the TSV");
    expect(q(".badge-btn")).toBeNull();
    expect(q("th.check")).toBeNull();
    await dblclick(cell("home", "en"));
    expect(editor()).toBeNull();
    await dblclick(cell("home", "ko"));
    expect(editor()).not.toBeNull();
  });

  it("downloads a TSV with the edits instead of saving", async () => {
    const blobs: Blob[] = [];
    URL.createObjectURL = (b: Blob | MediaSource) => {
      blobs.push(b as Blob);
      return "blob:x";
    };
    URL.revokeObjectURL = vi.fn();
    const click_ = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    await show();
    await dblclick(cell("home", "ko"));
    await type(editor(), "집");
    await click(button("Download TSV"));
    expect(pending()).toBe("1 pending change");
    expect(click_).toHaveBeenCalled();
    expect(await blobs[0].text()).toContain("집");
    expect(await blobs[0].text()).toContain("status\tnamespace\tkey\ten\tko");
  });
});
