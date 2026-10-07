# Review workflow

## State model

Stored per row: `ai-draft`, `in-review`, `approved`, `archived`. Hash = first 10 hex chars of sha256 of the exact value.
Derived (never stored), with precedence **missing > stale > edited/new > stored state**:

- `missing`: any language's value (source included) is empty.
- `stale`: only the source value changed since the record, so translations are probably outdated.
- `edited`: any other hash difference. Each row also exposes `changedLocales`, the languages whose value differs from the record (used by the report).
- `new`: no record.

## Export / import flow

1. `i18n-studio export` writes `review.tsv` into the report dir (columns `status, key, en, es, ..., comment`; a `namespace` column goes between `status` and `key` when rows span several namespaces; xlsx has one sheet per namespace). Paste the TSV into a Google Sheet; newlines in cells are quoted.
2. The reviewer edits the sheet. The status column is for humans only and is ignored on import.
3. Copy the whole sheet and run `pbpaste | i18n-studio import -` (or save as tsv/csv/xlsx and pass the path). The header row, language columns (by code or name, e.g. `Korean`), and the key column (or `namespace` + `key`, or matching by source text) are detected; merged cells read as fill-down.
4. Open `report.html` (the proposal is laid over it; filter by status `changed` / `pending` / `confirmed`) or `proposal.json`. Only cells that differ from the repo are listed.
5. `i18n-studio apply`. Complete rows become `approved`; rows with only some languages returned get the filled cells written and stay `in-review`; exported rows that never came back stay `in-review`.

## proposal.json

```jsonc
{
  "version": 2,
  "file": "sheet.tsv",
  "rows": [        // complete rows (every non-source language returned) with changes; applied unless "reject": true
    { "id": "navigation.link.faq", "where": "Sheet1:12", "matchedBy": "key", "comment": "", "missing": [],
      "changes": { "ko": { "old": "...", "new": "..." } }, "reject": true }   // "reject" is optional
  ],
  "confirmed": [], // complete rows without changes: approved as they are (same shape, "changes": {})
  "pending": [],   // partial rows: changed cells are written, row stays in-review; "missing" lists absent languages
  "ambiguous": [   // several keys match (same source text, or a bare key in several namespaces)
    { "where": "5", "reason": "ambiguous match", "source": "Same text", "values": { "ko": "...", "es": "..." },
      "comment": "", "candidates": ["a.same1", "a.same2"],
      "resolve": null }  // set to one id, or a list of ids, to accept; null = ignore
  ],
  "unmatched": [], // same shape as ambiguous with "candidates": []; resolve works the same way
  "skipped": ["7: no translation"]   // informational
}
```

## Commands

| Command | What it does |
| --- | --- |
| `status [--ns x]` | Row counts per state, overall and per namespace. Hints to run `init` when there are no records. |
| `check [--fail-on a,b] [--format text\|github\|json]` | Reports problems as **warnings** and exits 0. Only `status-file` problems (malformed status file, unreadable catalog) and the kinds in `failOn` exit 1. Kinds: `status-file`, `missing-key`, `orphan-key`, `empty`, `order`, `stale`, `edited`, `new`, `ai-draft`, `in-review`. `--format github` prints GitHub Actions annotations (`::warning file=...,title=i18n-studio::...`, `::error` for failing kinds) so a CI step can annotate PRs without failing. Whether CI fails is the consuming repo's workflow decision; the package only provides exit codes and annotations. |
| `report [--open]` | One self-contained `report.html` in the report dir: status first, then key and one column per language; namespace sidebar, search, status/language filters, copy visible rows as TSV. Cells changed since the recorded state are highlighted. |
| `init [--force]` | One-time baseline: every row with all languages non-empty becomes `approved`. Rows with any empty value get no record (they show `missing`). Refuses to overwrite status files without `--force`. |
| `draft [keys...] [--ns y]` | Mark rows `ai-draft` (run after writing translations). |
| `export [--ns x] [--all] [--format tsv\|xlsx\|csv] [--out f]` | All languages in one file, one row per key. Default: rows needing review (`ai-draft`, `edited`, `new`, `stale`, `missing`); `--all`: everything. Exported rows become `in-review`. |
| `import <file\|-> [--lang x] [--out p.json]` | Parse the sheet the reviewer returned (tsv/csv/xlsx file, or `-` to read a pasted sheet from stdin) into `proposal.json` and refresh `report.html` with the proposal laid over it (changed cells: old value struck through, new below). Never writes messages. |
| `apply [proposal.json]` | Write accepted rows to the messages JSON and update status. |
| `approve [keys...] [--ns y] [--all-edited]` | Re-baseline hashes and mark rows `approved`. |
| `mark <state> [keys...] [--ns x]` | Set a stored state (`ai-draft`, `in-review`, `approved`, `archived`, or a `customStates` label) on rows. Needs keys or `--ns`. |
| `set <lang> <ns.key> "<text>"` | Manual single-cell edit; the row then shows as `edited` (not auto-approved). The key must exist. |

`xlsx` needs the optional `exceljs` peer dependency. Without it, tsv and csv still work.
