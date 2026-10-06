import { describe, expect, it } from "vitest";
import { renderReport, renderShell } from "../src/html.js";
import type { Model } from "../src/model.js";
import { EXTERNAL_URL, withoutXmlNamespaces } from "./helpers.js";

const NASTY = [
  "<contact-link>Contact</contact-link> & <b>bold</b>",
  '</script><script>alert("x")</script>',
  "<!-- comment --> &amp; &lt; &#39;    ",
  "line1\nline2\ttab \"quoted\" 'single' \\backslash",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional hostile value
  "{count, plural, one {# day} other {# days}} ${not} `tpl`",
];
const DATA_BLOCK =
  /<script type="application\/json" id="data">([\s\S]*?)<\/script>/;
const CLOSE_SCRIPT = /<\/script>/g;

describe("renderReport embedding", () => {
  const model: Model = {
    title: "T <&> title",
    columns: ["en", "ko"],
    rows: NASTY.map((text, i) => ({
      group: `g${i}</script>`,
      key: `k${i}`,
      status: "new",
      cells: [{ text }, { text, changed: true }],
    })),
    banners: [],
    copyHeader: true,
    uiLocale: "ko",
  };
  const html = renderReport(model);

  it("keeps the data block parseable and lossless", () => {
    const match = html.match(DATA_BLOCK);
    expect(match).not.toBeNull();
    expect(JSON.parse(match?.[1] ?? "")).toEqual(model);
  });

  it("never lets a value close the script or open a tag", () => {
    // Exactly two scripts: the data block and the inlined app.
    expect(html.match(CLOSE_SCRIPT)).toHaveLength(2);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("<title>T &lt;&amp;&gt; title</title>");
  });

  it("is self-contained: inlined assets, no external URLs", () => {
    expect(html).toContain("<style>");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("src=");
    expect(withoutXmlNamespaces(html)).not.toMatch(EXTERNAL_URL);
  });
});

describe("renderShell", () => {
  it("has no inline script or style and loads the two assets", () => {
    const html = renderShell();
    expect(html).toContain('<script src="/app.js"></script>');
    expect(html).toContain('<link rel="stylesheet" href="/app.css">');
    expect(html).not.toContain("<style");
    expect(html).not.toContain("style=");
    expect(html.match(CLOSE_SCRIPT)).toHaveLength(1);
  });
});
