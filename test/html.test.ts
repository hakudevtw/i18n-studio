import { describe, expect, it } from "vitest";
import { type HtmlModel, renderHtml } from "../src/html.js";

const NASTY = [
  "<contact-link>Contact</contact-link> & <b>bold</b>",
  '</script><script>alert("x")</script>',
  "<!-- comment --> &amp; &lt; &#39;    ",
  "line1\nline2\ttab \"quoted\" 'single' \\backslash",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional hostile value
  "{count, plural, one {# day} other {# days}} ${not} `tpl`",
];

describe("renderHtml embedding", () => {
  const model: HtmlModel = {
    title: "T <&> title",
    columns: ["en", "ko"],
    rows: NASTY.map((text, i) => ({
      group: `g${i}</script>`,
      key: `k${i}`,
      status: "new",
      cells: [{ text }, { text, changed: true }],
    })),
  };
  const html = renderHtml(model);

  it("keeps the data block parseable and lossless", () => {
    const match = html.match(
      // biome-ignore lint/performance/useTopLevelRegex: single use
      /<script type="application\/json" id="data">([\s\S]*?)<\/script>/
    );
    expect(match).not.toBeNull();
    expect(JSON.parse(match?.[1] ?? "")).toEqual(model);
  });

  it("never lets a value close the script or open a tag", () => {
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("<title>T &lt;&amp;&gt; title</title>");
  });
});
