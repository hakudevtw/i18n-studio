import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/catalog.js";
import { draft, exportRows, init, report, status } from "../src/commands.js";
import type { Config } from "../src/config.js";
import { apply, importFile, type Proposal } from "../src/proposal.js";
import { getRows } from "../src/status.js";
import { readTable, serializeDelimited } from "../src/table.js";
import {
  copyFixture,
  FIXTURE_MISSING,
  readJson,
  readText,
  syntheticConfig,
} from "./helpers.js";

const readProposal = (file: string): Proposal =>
  JSON.parse(readFileSync(file, "utf8"));
const DATA_BLOCK =
  /<script type="application\/json" id="data">([\s\S]*?)<\/script>/;
const reportModel = (file: string) =>
  JSON.parse(
    (readFileSync(file, "utf8").match(DATA_BLOCK) as RegExpMatchArray)[1]
  ) as {
    banners: { kind: string }[];
    rows: {
      group: string;
      key: string;
      status: string;
      cells: { text: string; old?: string }[];
    }[];
  };
const stateOf = (cfg: Config, address: string) =>
  getRows(cfg, loadCatalog(cfg)).find((r) => r.address === address)?.state;

/** Export to TSV, let `edit` play the PM (cells by column name), write the sheet back. */
const roundTrip = async (
  cfg: Config,
  edit: (row: Record<string, string>) => Record<string, string> | null,
  all = false
) => {
  const out = join(cfg.reportDir, "review.tsv");
  await exportRows(cfg, { all, format: "tsv", out });
  const [header, ...rows] = (await readTable(out))[0].rows;
  const returned = rows
    .map((r) => edit(Object.fromEntries(header.map((h, i) => [h, r[i]]))))
    .filter((r): r is Record<string, string> => r !== null)
    .map((r) => header.map((h) => r[h] ?? ""));
  writeFileSync(out, serializeDelimited([header, ...returned], "\t"));
  return out;
};

describe("export -> PM edit -> import -> apply (fixture copy)", () => {
  it("handles stale, edited-with-partial return and untouched files", async () => {
    const cfg = copyFixture();
    init(cfg, { force: false });
    const commonBefore = readText(cfg, "ko", "common");

    // Repo edits: en nav string changes (stale row); ko answer edited by an engineer.
    const nav = readJson(cfg, "en", "navigation");
    nav.link.faq = "Frequently Asked Questions";
    writeFileSync(
      join(cfg.i18nDir, "en", "navigation.json"),
      JSON.stringify(nav, null, 2)
    );
    const faq = readJson(cfg, "ko", "faq-page");
    faq.crj_support.faqs[0].answer += "\n(수정)";
    writeFileSync(
      join(cfg.i18nDir, "ko", "faq-page.json"),
      JSON.stringify(faq, null, 2)
    );
    expect(stateOf(cfg, "navigation.link.faq")).toBe("stale");
    expect(stateOf(cfg, "faq-page.crj_support.faqs.0.answer")).toBe("edited");

    let seenMultiline = false;
    const file = await roundTrip(cfg, (row) => {
      if (row.key === "link.faq") {
        return {
          ...row,
          es: "Preguntas más frecuentes",
          ko: "자주 묻는 질문 (FAQ)",
        };
      }
      if (row.key === "crj_support.faqs.0.answer") {
        seenMultiline = row.ko.includes("\n");
        return { ...row, es: `${row.es} (revisado)`, ko: "" }; // ko not returned
      }
      return row.status === "missing" ? null : row;
    });
    expect(seenMultiline).toBe(true);
    expect(stateOf(cfg, "navigation.link.faq")).toBe("in-review"); // exported

    const imp = await importFile(cfg, file, {});
    expect(imp).toMatchObject({
      rows: 1,
      pending: 1,
      confirmed: 0,
      changedCells: 3,
    });
    const proposal = readProposal(imp.proposal);
    expect(Object.keys(proposal.rows[0].changes)).toEqual(["es", "ko"]);
    expect(proposal.pending[0]).toMatchObject({ missing: ["ko"] });
    expect(readText(cfg, "ko", "common")).toBe(commonBefore); // import never writes

    // One page: the pending proposal is laid over the report (old struck, new below).
    const overlaid = reportModel(imp.report);
    const link = overlaid.rows.find(
      (r) => r.group === "navigation" && r.key === "link.faq"
    );
    expect(link?.status).toBe("changed");
    expect(link?.cells.some((c) => c.old !== undefined)).toBe(true);
    expect(
      overlaid.rows.find(
        (r) => r.group === "faq-page" && r.key === "crj_support.faqs.0.answer"
      )?.status
    ).toBe("pending");
    expect(overlaid.banners).toContainEqual({
      kind: "proposal",
      changed: 1,
      pending: 1,
      confirmed: 0,
      manual: 0,
    });

    expect(apply(cfg, imp.proposal)).toMatchObject({
      approved: 1,
      inReview: 1,
    });
    expect(readJson(cfg, "ko", "navigation").link.faq).toBe(
      "자주 묻는 질문 (FAQ)"
    );
    expect(
      readJson(cfg, "es", "faq-page").crj_support.faqs[0].answer
    ).toContain("(revisado)");
    expect(
      readJson(cfg, "ko", "faq-page").crj_support.faqs[0].answer
    ).toContain("(수정)");
    expect(readText(cfg, "ko", "common")).toBe(commonBefore);
    expect(stateOf(cfg, "navigation.link.faq")).toBe("approved");
    expect(stateOf(cfg, "faq-page.crj_support.faqs.0.answer")).toBe(
      "in-review"
    );

    // Once applied, the repo already reflects the proposal: no overlay is left.
    const after = reportModel(report(cfg, { proposal: imp.proposal }).file);
    expect(after.banners.some((b) => b.kind === "proposal")).toBe(false);
    expect(
      after.rows.find((r) => r.group === "navigation" && r.key === "link.faq")
        ?.status
    ).toBe("approved");
  });

  it("lists only changed cells; unchanged complete rows are confirmed", async () => {
    const cfg = copyFixture();
    init(cfg, { force: false });
    const total = getRows(cfg, loadCatalog(cfg)).length;
    const file = await roundTrip(
      cfg,
      (row) =>
        row.key === "link.home"
          ? { ...row, status: "garbage", ko: "홈!" }
          : row,
      true
    );
    const imp = await importFile(cfg, file, {});
    expect(imp).toMatchObject({
      rows: 1,
      changedCells: 1,
      pending: 0,
      ambiguous: 0,
      unmatched: 0,
    });
    expect(imp.confirmed).toBe(total - FIXTURE_MISSING - 1); // minus the missing rows (skipped) and the changed row
    const proposal = readProposal(imp.proposal);
    expect(proposal.rows[0].changes).toEqual({
      ko: { old: expect.any(String), new: "홈!" },
    });
    expect(apply(cfg, imp.proposal).approved).toBe(total - FIXTURE_MISSING);
    expect(readJson(cfg, "ko", "navigation").link.home).toBe("홈!");
  });
});

describe("synthetic loop", () => {
  it("keeps un-returned exported rows in-review and honours reject", async () => {
    const cfg = syntheticConfig();
    init(cfg, { force: false });
    draft(cfg, { keys: ["a.title", "b.title"] });
    const file = await roundTrip(cfg, (row) => ({
      ...row,
      ko: `${row.ko}!`,
      es: `${row.es}!`,
    }));
    expect(status(cfg, {}).counts).toEqual({ approved: 4, "in-review": 2 });
    const imp = await importFile(cfg, file, {});
    const proposal = readProposal(imp.proposal);
    (
      proposal.rows.find((r) => r.id === "b.title") as Proposal["rows"][0]
    ).reject = true;
    writeFileSync(imp.proposal, JSON.stringify(proposal));
    expect(apply(cfg, imp.proposal)).toMatchObject({
      approved: 1,
      rejected: 1,
    });
    expect(readJson(cfg, "ko", "a").title).toBe("안녕!");
    expect(readJson(cfg, "ko", "b").title).toBe("잘가");
    expect(status(cfg, {}).counts).toEqual({ approved: 5, "in-review": 1 });
  });

  it("exports tsv/csv as one table and xlsx as one sheet per namespace", async () => {
    const cfg = syntheticConfig();
    const tsv = join(cfg.reportDir, "all.tsv");
    await exportRows(cfg, { all: true, format: "tsv", out: tsv });
    const [[sheet]] = [await readTable(tsv)];
    // status, namespace, key, languages, comment; namespace only because rows span several.
    expect(sheet.rows[0]).toEqual([
      "status",
      "namespace",
      "key",
      "en",
      "es",
      "ko",
      "comment",
    ]);
    expect(sheet.rows).toHaveLength(7);
    expect(sheet.rows.find((r) => r[2] === "note")?.slice(3, 6)).toEqual([
      "Line one\nLine two",
      "Línea uno\nLínea dos",
      "한 줄\n두 줄",
    ]);
    const xlsx = join(cfg.reportDir, "all.xlsx");
    await exportRows(cfg, { all: true, format: "xlsx", out: xlsx });
    const sheets = await readTable(xlsx);
    expect(sheets.map((s) => s.name)).toEqual(["a", "b"]);
    expect(sheets[0].rows[0]).toEqual([
      "status",
      "key",
      "en",
      "es",
      "ko",
      "comment",
    ]);
    const fresh = syntheticConfig();
    const csv = join(fresh.reportDir, "b.csv");
    await exportRows(fresh, { all: false, ns: "b", format: "csv", out: csv });
    const [single] = (await readTable(csv))[0].rows;
    expect(single).toEqual(["status", "key", "en", "es", "ko", "comment"]);
    expect((await readTable(csv))[0].rows).toHaveLength(3);
  });
});

describe("import of messy sheets (synthetic)", () => {
  const importText = async (rows: string[][], opts: { lang?: string } = {}) => {
    const cfg = syntheticConfig();
    const imp = await importFile(cfg, "-", {
      ...opts,
      text: serializeDelimited(rows, "\t"),
    });
    return { cfg, imp, proposal: readProposal(imp.proposal) };
  };

  it("accepts a pasted sheet (stdin) with namespace column and ignores status", async () => {
    const { proposal, imp } = await importText([
      ["namespace", "status", "key", "en", "es", "ko", "comment"],
      ["a", "approved", "title", "Hello", "Hola", "안녕", ""],
      [
        "a",
        "new",
        "faqs.0.q",
        "Question one",
        "Pregunta 1",
        "질문 하나",
        "es changed",
      ],
      [
        "b",
        "",
        "note",
        "Line one\nLine two",
        "Línea uno\nLínea dos",
        "한 줄\n두 줄",
        "",
      ],
    ]);
    expect(imp).toMatchObject({ rows: 1, confirmed: 2, changedCells: 1 });
    expect(proposal.rows[0]).toMatchObject({
      id: "a.faqs.0.q",
      comment: "es changed",
      changes: { es: { old: "Pregunta uno", new: "Pregunta 1" } },
    });
  });

  it("finds a header in an odd row and matches by source text without a key column", async () => {
    const { proposal } = await importText([
      ["Translation review - Q3", "", "", ""],
      ["", "", "", ""],
      ["#", "English", "Spanish", "Korean"],
      ["1", "Hello", "Hola!", "안녕하세요"],
      ["2", "Goodbye", "Adiós", "잘가"],
      ["3", "Not in the catalog", "?", "?"],
      ["4", "Question one", "", ""],
    ]);
    expect(
      proposal.rows.map((r) => [r.id, r.matchedBy, Object.keys(r.changes)])
    ).toEqual([["a.title", "source", ["es", "ko"]]]);
    expect(proposal.confirmed.map((r) => r.id)).toEqual(["b.title"]);
    expect(proposal.unmatched.map((r) => r.source)).toEqual([
      "Not in the catalog",
    ]);
    expect(proposal.skipped).toEqual(["7: no translation"]);
  });

  it("matches by full address, namespace + bare path and unique bare path", async () => {
    const { proposal } = await importText([
      ["namespace", "key", "es", "ko"],
      ["a", "faqs.0.q", "Pregunta nueva", "질문 새로"],
      ["", "b.note", "Línea uno\nLínea dos", "한 줄\n두 줄"],
      ["", "same1", "Igual", "같은"],
      ["", "nope.key", "x", "y"],
    ]);
    expect([...proposal.rows, ...proposal.confirmed].map((r) => r.id)).toEqual([
      "a.faqs.0.q",
      "b.note",
      "a.same1",
    ]);
    expect(proposal.unmatched).toHaveLength(1);
  });

  it("lists duplicated source texts as ambiguous and applies resolve lists", async () => {
    const { cfg, imp, proposal } = await importText([
      ["en", "es", "ko"],
      ["Same text", "Idéntico", "똑같은"],
    ]);
    expect(proposal.rows).toHaveLength(0);
    expect(proposal.ambiguous[0].candidates).toEqual(["a.same1", "a.same2"]);
    proposal.ambiguous[0].resolve = ["a.same1", "a.same2"];
    writeFileSync(imp.proposal, JSON.stringify(proposal));
    expect(apply(cfg, imp.proposal).approved).toBe(2);
    expect(readJson(cfg, "ko", "a")).toMatchObject({
      same1: "똑같은",
      same2: "똑같은",
    });
    expect(readJson(cfg, "es", "a")).toMatchObject({ same1: "Idéntico" });
  });

  it("detects columns without any header", async () => {
    const { proposal } = await importText([
      ["Hello", "Hola", "여보세요"],
      ["Goodbye", "Adiós", "잘가"],
      ["Line one\nLine two", "Línea uno\nLínea dos", "한 줄\n두 줄 (수정)"],
    ]);
    expect(proposal.rows.map((r) => r.id)).toEqual(["a.title", "b.note"]);
    expect(proposal.confirmed.map((r) => r.id)).toEqual(["b.title"]);
  });

  it("reads csv with a BOM, extra columns and CRLF from a file", async () => {
    const cfg = syntheticConfig();
    mkdirSync(cfg.reportDir, { recursive: true });
    const file = join(cfg.reportDir, "in.csv");
    writeFileSync(
      file,
      '﻿string id,en,es,ko,extra,reviewer\r\nb.note,"Line one\nLine two","Línea uno\nLínea dos","한 줄\n둘째 줄",1,fine\r\n'
    );
    const proposal = readProposal((await importFile(cfg, file, {})).proposal);
    expect(proposal.rows[0]).toMatchObject({
      id: "b.note",
      comment: "fine",
      changes: { ko: { new: "한 줄\n둘째 줄" } },
    });
  });

  it("reads xlsx with merged cells (fill-down) and sheet-per-namespace", async () => {
    const cfg = syntheticConfig();
    mkdirSync(cfg.reportDir, { recursive: true });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("sheet1");
    ws.addRows([
      ["namespace", "key", "es", "ko"],
      ["a", "title", "Uno", "하나"],
      ["", "same1", "Dos", "둘"],
      ["b", "title", "Tres", "셋"],
    ]);
    ws.mergeCells("A2:A3");
    wb.addWorksheet("b").addRows([
      ["en", "es", "ko"],
      ["Line one\nLine two", "Cuatro", "넷"],
    ]);
    const file = join(cfg.reportDir, "in.xlsx");
    await wb.xlsx.writeFile(file);
    const proposal = readProposal((await importFile(cfg, file, {})).proposal);
    expect(proposal.rows.map((r) => [r.id, r.changes.ko?.new])).toEqual([
      ["a.title", "하나"],
      ["a.same1", "둘"],
      ["b.title", "셋"],
      ["b.note", "넷"],
    ]);
  });

  it("errors clearly when nothing can be detected", async () => {
    await expect(
      importText([
        ["foo", "bar"],
        ["baz", "qux"],
      ])
    ).rejects.toThrow("Cannot detect");
  });
});
