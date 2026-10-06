export type Flat = [key: string, value: string][];

const INDEX = /^\d+$/;

/** Nested JSON -> ordered `[dotted.path, value]` pairs. Numeric segments are array indices. */
export const flatten = (node: unknown, prefix = ""): Flat => {
  if (typeof node === "string") {
    return [[prefix, node]];
  }
  if (node === null || typeof node !== "object") {
    throw new Error(
      `Unsupported value at "${prefix}": only strings are allowed`
    );
  }
  const out: Flat = [];
  for (const [k, v] of Object.entries(node)) {
    out.push(...flatten(v, prefix ? `${prefix}.${k}` : k));
  }
  return out;
};

/** Inverse of `flatten`; insertion order of `pairs` becomes key order. */
export const unflatten = (pairs: Flat): Record<string, unknown> => {
  const root: Record<string, unknown> = {};
  for (const [path, value] of pairs) {
    const parts = path.split(".");
    let node: any = root;
    for (const [i, part] of parts.entries()) {
      if (i === parts.length - 1) {
        node[part] = value;
        break;
      }
      node[part] ??= INDEX.test(parts[i + 1]) ? [] : {};
      node = node[part];
    }
  }
  return root;
};

/** Same formatting as the generated files: 2-space indent; trailing newline only if asked. */
export const serialize = (obj: unknown, trailingNewline = false): string =>
  `${JSON.stringify(obj, null, 2)}${trailingNewline ? "\n" : ""}`;
