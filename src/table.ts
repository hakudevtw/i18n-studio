import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type ExcelJS from "exceljs";
import { atomicWriteAll } from "./fsx.js";

/** exceljs is an optional peer dependency, only needed for .xlsx. */
const loadExcel = async (): Promise<typeof ExcelJS> => {
  try {
    return (await import("exceljs")).default;
  } catch {
    throw new Error(
      "install exceljs to use xlsx (e.g. `yarn add -D exceljs`), or use tsv/csv"
    );
  }
};

export type Sheet = { name: string; rows: string[][] };

const SPECIAL = /[\n\r"]/;
const BOM = /^\uFEFF/;

/** RFC 4180 style; `"` only opens a quoted field at field start, so stray quotes stay literal. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: single-pass state machine
export const parseDelimited = (text: string, delimiter: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let atStart = true;
  const src = text.replace(BOM, "");
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"' && atStart) {
      quoted = true;
      atStart = false;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
      atStart = true;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      atStart = true;
    } else {
      field += c;
      atStart = false;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
};

export const serializeDelimited = (rows: string[][], delimiter: string) =>
  rows
    .map((row) =>
      row
        .map((cell) =>
          cell.includes(delimiter) || SPECIAL.test(cell)
            ? `"${cell.replaceAll('"', '""')}"`
            : cell
        )
        .join(delimiter)
    )
    .join("\n")
    .concat("\n");

/** Parse pasted/read text; tab-separated unless the first line has no tab (or ext is .csv). */
export const parseText = (text: string, ext = ""): Sheet[] => {
  const delimiter =
    ext === ".csv" || (ext !== ".tsv" && !text.split("\n")[0].includes("\t"))
      ? ","
      : "\t";
  return [{ name: "", rows: parseDelimited(text, delimiter) }];
};

export const readTable = async (file: string): Promise<Sheet[]> => {
  const ext = extname(file).toLowerCase();
  if (ext !== ".xlsx") {
    return parseText(readFileSync(file, "utf8"), ext);
  }
  const { Workbook } = await loadExcel();
  const workbook = new Workbook();
  await workbook.xlsx.readFile(file);
  return workbook.worksheets.map((ws) => {
    const rows: string[][] = [];
    // Merged cells read back the master cell's text, which acts as fill-down.
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c += 1) {
        cells.push(row.getCell(c).text ?? "");
      }
      rows[n - 1] = cells;
    });
    return { name: ws.name, rows: Array.from(rows, (r) => r ?? []) };
  });
};

/** xlsx: one worksheet per sheet; tsv/csv: the first sheet only. */
export const writeTable = async (
  file: string,
  format: "tsv" | "csv" | "xlsx",
  sheets: Sheet[]
) => {
  if (format === "xlsx") {
    const { Workbook } = await loadExcel();
    const workbook = new Workbook();
    for (const sheet of sheets) {
      const ws = workbook.addWorksheet(sheet.name || "review");
      ws.addRows(sheet.rows);
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: "frozen", ySplit: 1 }];
      for (const col of ws.columns) {
        col.width = 40;
        col.alignment = { wrapText: true, vertical: "top" };
      }
    }
    await workbook.xlsx.writeFile(file);
    return;
  }
  const body = serializeDelimited(
    sheets[0].rows,
    format === "csv" ? "," : "\t"
  );
  atomicWriteAll([
    { path: file, content: format === "csv" ? `\uFEFF${body}` : body },
  ]);
};
