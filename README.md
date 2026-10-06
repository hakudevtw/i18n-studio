# i18n-studio

Review-status layer and export/import loop for translation JSON (`<dir>/<lang>/<namespace>.json`). The JSON files stay the single source of truth; reviewers work in Google Sheets/xlsx and their answers come back through a reviewable proposal. Status is tracked **per row** (one key across all languages), because rows are confirmed as a whole. Values are plain text (newlines allowed); no ICU/rich-text parsing. Zero runtime dependencies. Requires Node >= 22.

## Quick start

```bash
# not published yet: see "Develop with yarn link" below
yarn add -D i18n-studio
# package.json scripts: "i18n": "i18n-studio --dir src/i18n/messages"
yarn i18n init            # one-time baseline: existing complete rows become approved
yarn i18n studio --open   # browse every row, language and status in the browser
yarn i18n check           # warnings for missing/empty keys, order, stale rows
```

## Usage

```bash
i18n-studio --dir src/i18n/messages <command> [options]    # add --json for machine output
i18n-studio --help                                         # or: i18n-studio <command> --help
```

| Command | What it does |
| --- | --- |
| `status [--ns x]` | Row counts per state, overall and per namespace. Hints to run `init` when there are no records. |
| `check [--fail-on a,b] [--format text\|github\|json]` | Reports problems as **warnings** and exits 0. Only `status-file` problems (malformed status file, unreadable catalog) and the kinds in `failOn` exit 1. Kinds: `status-file`, `missing-key`, `orphan-key`, `empty`, `order`, `stale`, `edited`, `new`, `ai-draft`, `in-review`. `--format github` prints GitHub Actions annotations (`::warning file=...,title=i18n-studio::...`, `::error` for failing kinds) so a CI step can annotate PRs without failing. Whether CI fails is the consuming repo's workflow decision; the package only provides exit codes and annotations. |
| `report [--open]` | One self-contained `report.html` in the report dir: status first, then key and one column per language; namespace sidebar, search, status/language filters, copy visible rows as TSV. Cells changed since the recorded state are highlighted. |
| `studio [--port n] [--open]` | Serve the report at `http://127.0.0.1:<port>/` (read-only; refresh to see current data; Ctrl+C stops it). The page is a small Preact app served as static `app.js`/`app.css` plus `GET /api/model`. It can save through `POST /api/save` unless `readOnly` (see "Saving from the studio"). |
| `init [--force]` | One-time baseline: every row with all languages non-empty becomes `approved`. Rows with any empty value get no record (they show `missing`). Refuses to overwrite status files without `--force`. |
| `draft [keys...] [--ns y]` | Mark rows `ai-draft` (run after writing translations). |
| `export [--ns x] [--all] [--format tsv\|xlsx\|csv] [--out f]` | All languages in one file, one row per key. Default: rows needing review (ai-draft, edited, new, stale, missing); `--all`: everything. Exported rows become `in-review`. |
| `import <file\|-> [--lang x] [--out p.json]` | Parse the sheet the reviewer returned (tsv/csv/xlsx file, or `-` to read a pasted sheet from stdin) into `proposal.json` and refresh `report.html` with the proposal laid over it (changed cells: old value struck through, new below). Never writes messages. |
| `apply [proposal.json]` | Write accepted rows to the messages JSON and update status. |
| `approve [keys...] [--ns y] [--all-edited]` | Re-baseline hashes and mark rows `approved`. |
| `mark <state> [keys...] [--ns x]` | Set a stored state (`ai-draft`, `in-review`, `approved`, `archived`, or a `customStates` label) on rows. Needs keys or `--ns`. |
| `set <lang> <ns.key> "<text>"` | Manual single-cell edit; the row then shows as `edited` (not auto-approved). The key must exist. |

Keys are `<namespace>.<dotted.path>`; array indices are numeric segments (e.g. `faq-page.crj_support.faqs.0.question`).

## Configuration

Global flags work anywhere on the command line. A config file is optional. Precedence: **flags > config file > defaults**. Unknown config keys or wrong types are an error naming the key.

`i18n-studio.config.json` (in the cwd, or the file given with `--config`, which must exist). It is **JSON only, on purpose**: reading it never executes code.

```json
{
  "dir": "src/i18n/messages",
  "ignoreKeys": ["*.meta.*"],
  "failOn": ["empty"],
  "customStates": ["legal-ok"]
}
```

| Config key | Flag | Default | Meaning |
| --- | --- | --- | --- |
| `dir` | `--dir <dir>` | none (required) | Folder with `<lang>/<namespace>.json`. |
| `source` | `--source <locale>` | `en` | Source locale: defines keys, key order, namespaces. Always the first column. |
| `statusDir` | `--status-dir <dir>` | `<dir>-status` | Review-status files (commit them). |
| `reportDir` | `--report-dir <dir>` | `<cwd>/node_modules/.cache/i18n-studio` | Generated reports/exports/proposals. |
| `copyHeader` | `--no-copy-header` | `true` | Studio "Copy as TSV" starts with a header row. `export` always writes one (import needs it). |
| `port` | `--port <n>` | unset | Studio port. Explicit (flag or config) = used as given, error if taken; unset = start at 4321 and walk up. |
| `failOn` | `--fail-on a,b` | `["status-file"]` | Problem kinds that make `check` exit 1 (`status-file` always does). |
| `ignoreKeys` | none | `[]` | Globs over `<namespace>.<dotted.path>` (`*` = any characters, dots included) for keys that may stay empty/untranslated. |
| `exportStates` | none | `ai-draft, edited, new, stale, missing` | States `export` includes by default. |
| `customStates` | none | `[]` | Extra stored states: kebab-case labels that must not collide with built-in ones. |
| `localeOrder` | none | `[]` | These locales first (in this order), the rest alphabetically; the source locale is always first. |
| `excludeLocales` | none | `[]` | Locales ignored everywhere. Cannot contain the source locale. |
| `namespaceOrder` | none | `[]` | These namespaces first, the rest alphabetically. |
| `excludeNamespaces` | none | `[]` | Namespaces ignored everywhere. |
| `readOnly` | `--read-only` | `false` | The studio server refuses `POST /api/save` (403) and the model carries `readOnly: true`. The static `report` is always read-only. |
| `uiLocale` | `--ui-lang <auto\|en\|ko\|zh-TW\|ja>` | `auto` | Language of the studio/report page. `auto` follows the browser; `?lang=ko` in the URL overrides everything. |
| `indent` | `--indent n\|tab\|auto` | `auto` | JSON indent when writing: `auto` keeps each file's indent (2 if it has none); a number 1-8 or `tab` forces one. Each file's trailing-newline convention is always kept. |
| none | `--config <file>` | `./i18n-studio.config.json` if present | Config file path. |

Relative paths in the file resolve against the file's own folder; relative paths from flags resolve against the cwd. Locales are auto-detected (sub-folders of `--dir` that contain `*.json`; the status and report folders are never treated as locales), and namespaces come from the source locale's `*.json` files.

Semantics worth knowing:

- **`ignoreKeys`**: a matching row is never derived as `missing` (empty or absent values are fine), is not reported by `check` as `empty`/`missing-key`, is left out of the default `export` (still in `export --all`), and is baselined `approved` by `init` (also when its values are empty).
- **Custom states** are plain labels: they round-trip through the status files and the report (neutral gray badge), but have no transitions and no effect on `init`; `export` marks rows `in-review` as usual. Change a cell and the row still derives `edited`.
- **Order and exclusion** affect report columns/sidebar, export columns/sheets, `status`, `check` and `import`.

### Not supported yet

Alternative directory layouts (for example flat `<lang>.json` files) are not supported; the layout is always `<dir>/<lang>/<namespace>.json`.

### Page language

The page (studio and static report) ships in `en`, `ko`, `zh-TW` and `ja`. Resolution order: `?lang=` query > `uiLocale` / `--ui-lang` > browser language (`zh-TW`/`zh-Hant`/`zh-HK` map to `zh-TW`, `ko*`, `ja*`, anything else to `en`). The CLI output, `status`/`check` JSON and the TSV header row stay English. Custom states have no translation and show their raw name. The dictionaries are flat JSON files in `src/ui/locales/`. **The ko / zh-TW / ja translations were AI-drafted; reviews and corrections are welcome.**

## Layout and conventions

- Column order everywhere: status, [namespace], key, languages (source first, then `localeOrder`/alphabetical), comment.
- Canonical key order is the source locale file's order. Files are written with each file's own indent (see `indent`; 2 spaces if it has none) and trailing-newline convention.
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

## Saving from the studio

The studio server has exactly one write endpoint, `POST /api/save` (the edit UI that uses it comes later; the client is `src/ui/api.ts`). The body is JSON with strict, string-only fields:

```json
{
  "edits": [{ "id": "navigation.link.faq", "lang": "ko", "expectedOld": "<value the client saw>", "new": "<new value>" }],
  "statuses": [{ "id": "navigation.link.faq", "state": "approved", "expectedState": "<derived state the client saw>" }]
}
```

- **All or nothing.** Everything is validated first (ids and languages must exist in the catalog, `state` must be a storable built-in or `customStates` label, never a derived one like `missing`/`stale`/`edited`/`new`, no duplicate `(id, lang)` in a batch, nothing outside the schema). Nothing is written on any failure.
- **Optimistic concurrency.** Disk is re-read; every `expectedOld` must equal the current value and every `expectedState` the current derived state, otherwise **409** with `conflicts: [{ id, lang?, kind: "value" | "state", current }]` and nothing is written.
- **Order.** Edits are written first, then status changes, so approving in the same batch re-baselines the hashes. Editing the source locale is allowed; the response reports `staleRows`. An empty `new` value is allowed and returned as a warning.
- **Response.** `{ ok, written: { files, cells }, staleRows, warnings, model }` where `model` is the fresh `/api/model` payload.
- **Status codes.** 200 saved; 400 malformed JSON or schema (short message, input is never echoed); 403 wrong Host, Origin, `Sec-Fetch-Site`, token, or `readOnly`; 405 any method other than POST on `/api/save` (and anything but GET/HEAD elsewhere, including OPTIONS); 409 conflict; 413 body over 1 MiB; 415 content type other than `application/json` (optionally `; charset=utf-8`).
- **Atomic writes.** Every file the tool writes (messages, status files, reports, proposals, exports) goes through one path: a temp file next to the target (`<file>.<pid>.<random>.tmp`), then a rename. A multi-file batch writes all temps first, then renames them all; if anything fails, temps are removed and files already renamed are restored from memory. Limit: renames are atomic per file but the set is not a transaction, so a crash or power loss between two renames can leave some files updated and others not (the next save then reports the mismatch as a conflict). Key order, indent and trailing-newline conventions of each file are preserved.

## Security notes

- **Write protection** (`POST /api/save`): exact `Host` allowlist, an exact `Origin` (`http://127.0.0.1:<port>`, `http://localhost:<port>` or `http://[::1]:<port>`; missing or any other value is refused), `Sec-Fetch-Site` must be `same-origin` when present, a per-start random token (256 bits, compared in constant time) sent as `X-Studio-Token`, `Content-Type: application/json`, a 1 MiB body limit. No CORS headers are ever sent, so other sites cannot read or write. The token is embedded only in the shell page (a `<meta>` tag, never a URL), is also required for `GET /api/model`, and is never logged or put in error bodies. Request bodies are not logged. Use `--read-only` to disable writing.
- The studio shell has no inline script or style (`script-src 'self'; style-src 'self'; connect-src 'self'`, `frame-ancestors 'none'`, plus `X-Frame-Options: DENY`). It serves a fixed allowlist of files (`/`, `/app.js`, `/app.css`) and `/api/model`; request paths are never mapped to file paths.
- The static `report` stays one self-contained file (JS/CSS inlined, model embedded as JSON with `<` escaped, no network). Its inline script is only used when you open that file yourself.

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
yarn install && yarn build     # tsc (node code) + esbuild (browser UI) -> dist/
yarn link                      # register this package
cd ../your-app && yarn link i18n-studio
# in the app's package.json scripts: "i18n": "i18n-studio --dir src/i18n/messages"
```

If `node_modules/.bin/i18n-studio` is not created by `yarn link`, call `node node_modules/i18n-studio/dist/bin.js` instead. Re-run `yarn build` after changing the source. Scripts: `yarn test` (builds the UI first), `yarn typecheck`, `yarn lint`, `yarn build:ui`. The UI lives in `src/ui/` (TSX, Preact); Preact and esbuild are dev dependencies only, so the published package keeps zero runtime dependencies.
