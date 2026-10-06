import type { ModelRow } from "../model";

const quote = (s: string) =>
  s.includes('"') || s.includes("\t") || s.includes("\n")
    ? `"${s.split('"').join('""')}"`
    : s;

/**
 * Text for "Copy as TSV". Column order: status, [namespace when the rows span several],
 * key, languages. The header labels stay English on purpose: import detects them.
 */
export const tsvText = (
  rows: ModelRow[],
  columns: string[],
  cols: number[],
  copyHeader: boolean
): string => {
  const multiNs = new Set(rows.map((r) => r.group)).size > 1;
  const lines: string[][] = [];
  if (copyHeader) {
    lines.push([
      "status",
      ...(multiNs ? ["namespace"] : []),
      "key",
      ...cols.map((i) => columns[i]),
    ]);
  }
  for (const r of rows) {
    lines.push([
      r.status,
      ...(multiNs ? [r.group] : []),
      r.key,
      ...cols.map((i) => r.cells[i]?.text ?? ""),
    ]);
  }
  return lines.map((l) => l.map(quote).join("\t")).join("\n");
};
