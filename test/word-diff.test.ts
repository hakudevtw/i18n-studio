import { describe, expect, it } from "vitest";
import { diffWords } from "../src/ui/word-diff.js";

const render = (parts: ReturnType<typeof diffWords>) =>
  parts
    ?.map((p) => {
      if (p.kind === "del") {
        return `[-${p.text}-]`;
      }
      return p.kind === "ins" ? `{+${p.text}+}` : p.text;
    })
    .join("");

describe("diffWords", () => {
  it("marks only the changed word in a spaced language", () => {
    expect(
      render(
        diffWords(
          "Please wear a seatbelt at all times.",
          "Please wear a seat belt at all times.",
          "en"
        )
      )
    ).toBe("Please wear a [-seatbelt-]{+seat belt+} at all times.");
  });

  it("marks an insertion and a deletion separately", () => {
    expect(
      render(diffWords("Be on time for boarding.", "Be on time.", "en"))
    ).toBe("Be on time[- for boarding-].");
    expect(render(diffWords("Be on time.", "Please be on time.", "en"))).toBe(
      "[-Be-]{+Please be+} on time."
    );
  });

  it("splits CJK text into words or characters, not the whole sentence", () => {
    const parts = diffWords(
      "請務必繫好安全帶。",
      "請務必全程繫好安全帶。",
      "zh-TW"
    );
    expect(parts).not.toBeNull();
    expect(parts?.filter((p) => p.kind === "ins").map((p) => p.text)).toEqual([
      "全程",
    ]);
    expect(parts?.some((p) => p.kind === "del")).toBe(false);
  });

  it("returns null for a rewrite, so the caller shows both values whole", () => {
    expect(
      diffWords("Take your trash with you.", "Keep the bus clean.", "en")
    ).toBeNull();
  });

  it("returns a single same run when nothing changed", () => {
    expect(diffWords("Same text", "Same text", "en")).toEqual([
      { kind: "same", text: "Same text" },
    ]);
  });

  it("falls back to the default segmenter for an unknown locale", () => {
    expect(render(diffWords("Hello there", "Hello here", "ph"))).toBe(
      "Hello [-there-]{+here+}"
    );
  });
});
