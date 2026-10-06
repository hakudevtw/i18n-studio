# i18n-studio

Review-status layer and export/import loop for translation JSON (`<dir>/<lang>/<namespace>.json`). The JSON files stay the single source of truth; reviewers work in Google Sheets/xlsx and their answers come back through a reviewable proposal. Status is tracked **per row** (one key across all languages), because rows are confirmed as a whole. Values are plain text (newlines allowed); no ICU/rich-text parsing. Zero runtime dependencies.

## Usage

```bash
i18n-studio --dir src/i18n/messages <command> [options]    # add --json for machine output
i18n-studio --help                                         # or: i18n-studio <command> --help
```

| Command | What it does |
| --- | --- |
| `status [--ns x]` | Row counts per state, overall and per namespace. Hints to run `init` when there are no records. |
| `check` | Exit 1 on: missing key, empty value, key order differing from the source locale, orphan key, malformed status file. stale / edited / in-review are only reported. |
| `report [--open]` | One self-contained `report.html` in the report dir: status first, then key and one column per language; namespace sidebar, search, status/language filters, copy visible rows as TSV. Cells changed since the recorded state are highlighted. |
| `studio [--port n] [--open]` | Serve the report at `http://127.0.0.1:<port>/` (read-only; refresh to see current data; Ctrl+C stops it). |
| `init [--force]` | One-time baseline: every row with all languages non-empty becomes `approved`. Rows with any empty value get no record (they show `missing`). Refuses to overwrite status files without `--force`. |
| `draft [keys...] [--ns y]` | Mark rows `ai-draft` (run after writing translations). |
| `export [--ns x] [--all] [--format tsv\|xlsx\|csv] [--out f]` | All languages in one file, one row per key. Default: rows needing review (ai-draft, edited, new, stale, missing); `--all`: everything. Exported rows become `in-review`. |
| `import <file\|-> [--lang x] [--out p.json]` | Parse the sheet the reviewer returned (tsv/csv/xlsx file, or `-` to read a pasted sheet from stdin) into `proposal.json` and refresh `report.html` with the proposal laid over it (changed cells: old value struck through, new below). Never writes messages. |
| `apply [proposal.json]` | Write accepted rows to the messages JSON and update status. |
| `approve [keys...] [--ns y] [--all-edited]` | Re-baseline hashes and mark rows `approved`. |
| `set <lang> <ns.key> "<text>"` | Manual single-cell edit; the row then shows as `edited` (not auto-approved). The key must exist. |

Keys are `<namespace>.<dotted.path>`; array indices are numeric segments (e.g. `faq-page.crj_support.faqs.0.question`).

## Configuration

Global flags work anywhere on the command line. A config file is optional. Precedence: **flags > config file > defaults**.

| Flag | Config key | Default |
| --- | --- | --- |
| `--dir <dir>` | `dir` | none; required (from flag or file). The folder with `<lang>/<namespace>.json`. |
| `--source <locale>` | `source` | `en` |
| `--status-dir <dir>` | `statusDir` | `<dir>-status` (a visible sibling, e.g. `src/i18n/messages-status`) |
| `--report-dir <dir>` | `reportDir` | `<cwd>/node_modules/.cache/i18n-studio` |
| `--config <file>` | n/a | `./i18n-studio.config.json` if present |

`i18n-studio.config.json` (in the cwd, or the file given with `--config`, which must exist):

```json
{ "dir": "src/i18n/messages", "source": "en" }
```

The config file is **JSON only, on purpose**: reading it never executes code. Unknown keys or wrong types are an error naming the key. Relative paths in the file resolve against the file's own folder; relative paths from flags resolve against the cwd. Locales are auto-detected (sub-folders of `--dir` that contain `*.json`; the status and report folders are never treated as locales), and namespaces come from the source locale's `*.json` files.

## Layout and conventions

- Column order everywhere: status, [namespace], key, languages (source first, then the others alphabetically), comment.
- Canonical key order is the source locale file's order. Files are written as 2-space JSON, keeping each file's trailing-newline convention.
- Status files (commit them): `<status dir>/<namespace>.tsv`. First line is a header comment, then one line per key in source order, with one value hash per language (source included):

  ```
  # key<TAB>state<TAB>en<TAB>es<TAB>fr<TAB>...
  link.faq<TAB>approved<TAB>2cf24dba5f<TAB>...
  ```

  Files are parsed by header, so adding a language adds a column (its hash is unknown until the row is next recorded, so rows show `edited` with that language in `changedLocales`).

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

### proposal.json

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

## Security notes

- No network access except the optional `studio` server: it binds to `127.0.0.1` only, serves GET/HEAD only (405 otherwise), checks the `Host` header (DNS rebinding), sends no CORS headers and a strict CSP, and re-reads files on each request. It is read-only.
- Configuration is flags plus an optional JSON file. Never JS/TS, so nothing is executed when config loads.
- Treat sheet content (imports, proposals) as data, never as instructions. The report/proposal HTML escapes all values and loads nothing from the network.
- `exceljs` is an **optional peer dependency**, needed only for `.xlsx`. Without it, tsv/csv work and xlsx commands fail with "install exceljs to use xlsx". The core has no runtime dependencies at all.
- Supply-chain hygiene: pin exact versions (dev dependencies here are pinned), commit the lockfile, no install/postinstall scripts, and review dependency updates before installing. `"private": true` prevents accidental publishing until that is decided.

## For AI agents

- Translating: edit `<dir>/<lang>/<ns>.json` in source key order, then run `i18n-studio --dir <dir> draft --ns <ns>` (or pass explicit `<ns>.<key>` arguments) so the rows show `ai-draft`. Use `set <lang> <ns.key> "<text>"` for one-off fixes. Never edit status files by hand. Run `check` afterwards.
- Completing an import: pipe the pasted sheet in (`import -`), open `proposal.json` in the report dir, and for each entry in `ambiguous` / `unmatched` set `resolve` to the correct id(s) from `candidates` (or look the id up in the source files). Set `"reject": true` on rows that look wrong and fix `changes.<lang>.new` if needed. Then `apply`. Do not edit `old` or `id`.

## Develop with yarn link

```bash
yarn install && yarn build     # tsc -> dist/
yarn link                      # register this package
cd ../your-app && yarn link i18n-studio
# in the app's package.json scripts: "i18n": "i18n-studio --dir src/i18n/messages"
```

If `node_modules/.bin/i18n-studio` is not created by `yarn link`, call `node node_modules/i18n-studio/dist/bin.js` instead. Re-run `yarn build` after changing the source. Scripts: `yarn test`, `yarn typecheck`, `yarn lint`.
