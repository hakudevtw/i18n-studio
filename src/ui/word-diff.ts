export type DiffPart = { kind: "same" | "del" | "ins"; text: string };

/** Above this share of changed text, a word diff is noise: show the whole old and new values instead. */
const MAX_CHANGED = 0.5;
/** Cap on the LCS table, so a pathological pair of long values cannot stall the page. */
const MAX_CELLS = 250_000;

const segmenters = new Map<string, Intl.Segmenter | null>();

const segmenter = (locale: string | undefined): Intl.Segmenter | null => {
  const id = locale ?? "";
  if (!segmenters.has(id)) {
    let s: Intl.Segmenter | null = null;
    try {
      s = new Intl.Segmenter(locale || undefined, { granularity: "word" });
    } catch {
      try {
        s = new Intl.Segmenter(undefined, { granularity: "word" });
      } catch {
        s = null;
      }
    }
    segmenters.set(id, s);
  }
  return segmenters.get(id) ?? null;
};

const WHITESPACE = /(\s+)/;

/**
 * Words, spaces and punctuation as separate tokens. `Intl.Segmenter` splits
 * spaced languages into words and CJK into words or single characters, so one
 * changed word never marks its whole sentence.
 */
export const tokenize = (text: string, locale?: string): string[] => {
  const s = segmenter(locale);
  if (s) {
    return Array.from(s.segment(text), (seg) => seg.segment);
  }
  return text.split(WHITESPACE).filter(Boolean);
};

const push = (parts: DiffPart[], kind: DiffPart["kind"], text: string) => {
  const last = parts.at(-1);
  if (last?.kind === kind) {
    last.text += text;
  } else {
    parts.push({ kind, text });
  }
};

/** lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..]. */
const lcsTable = (a: string[], b: string[]): number[][] => {
  const lcs = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  return lcs;
};

/** Walk the table into runs; within one changed stretch, deletions come before insertions. */
const walk = (a: string[], b: string[], lcs: number[][]): DiffPart[] => {
  const parts: DiffPart[] = [];
  let dels = "";
  let inss = "";
  const flush = () => {
    if (dels) {
      push(parts, "del", dels);
    }
    if (inss) {
      push(parts, "ins", inss);
    }
    dels = "";
    inss = "";
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const same = i < a.length && j < b.length && a[i] === b[j];
    const insert =
      !same &&
      j < b.length &&
      (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j]);
    if (same) {
      flush();
      push(parts, "same", a[i]);
      i += 1;
      j += 1;
    } else if (insert) {
      inss += b[j];
      j += 1;
    } else {
      dels += a[i];
      i += 1;
    }
  }
  flush();
  return parts;
};

/**
 * The changes from `before` to `after` as same / deleted / inserted runs, or
 * null when so much changed that marking words would hide the sentence.
 */
export const diffWords = (
  before: string,
  after: string,
  locale?: string
): DiffPart[] | null => {
  const a = tokenize(before, locale);
  const b = tokenize(after, locale);
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    return null;
  }
  const parts = walk(a, b, lcsTable(a, b));
  const changed = parts
    .filter((p) => p.kind !== "same")
    .reduce((n, p) => n + p.text.length, 0);
  const total = before.length + after.length;
  return total > 0 && changed / total > MAX_CHANGED ? null : parts;
};
