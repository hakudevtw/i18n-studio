// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

describe("DOM test environment", () => {
  it("never runs page scripts (jsdom runScripts is not 'dangerously')", () => {
    const script = document.createElement("script");
    script.textContent = "window.__pwned = true";
    document.body.appendChild(script);
    const inline = document.createElement("div");
    inline.innerHTML = '<img src="x" onerror="window.__pwned = true">';
    document.body.appendChild(inline);
    expect(
      (window as unknown as { __pwned?: boolean }).__pwned
    ).toBeUndefined();
    script.remove();
    inline.remove();
  });
});
