# Configuration

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
| `languageSwitcher` | `--no-language-switcher` | `true` | Show a language select (en, ko, zh-TW, ja) in the page's top bar. When off, a remembered choice is ignored (`?lang=` still works). |
| `persistDrafts` | `--persist-drafts` / `--no-persist-drafts` | `true` | Keep staged (unsaved) studio edits in the browser so a refresh or crash does not lose them. When off, nothing is read or written and an existing draft is left untouched. |
| `showArchived` | `--show-archived` / `--no-show-archived` | `false` | Initial state of the page's "Show archived" toggle. Only the page changes; `check`, `export`, `status`, `init` and `prune` are unaffected. |
| `open` | `--open` / `--no-open` | `false` | `studio` opens the browser at the base URL when it starts (`--no-open` wins). `report --open` stays a plain flag. |
| `uiLocale` | `--ui-lang <auto\|en\|ko\|zh-TW\|ja>` | `auto` | Language of the studio/report page. `auto` follows the browser; `?lang=ko` in the URL overrides everything. |
| `indent` | `--indent n\|tab\|auto` | `auto` | JSON indent when writing: `auto` keeps each file's indent (2 if it has none); a number 1-8 or `tab` forces one. Each file's trailing-newline convention is always kept. |
| none | `--config <file>` | `./i18n-studio.config.json` if present | Config file path. |

Relative paths in the file resolve against the file's own folder; relative paths from flags resolve against the cwd. Locales are auto-detected (sub-folders of `--dir` that contain `*.json`; the status and report folders are never treated as locales), and namespaces come from the source locale's `*.json` files.

## Semantics

- **`ignoreKeys`**: a matching row is never derived as `missing` (empty or absent values are fine), is not reported by `check` as `empty`/`missing-key`, is left out of the default `export` (still in `export --all`), and is baselined `approved` by `init` (also when its values are empty).
- **Custom states** are plain labels: they round-trip through the status files and the report (neutral gray badge), but have no transitions and no effect on `init`; `export` marks rows `in-review` as usual. Change a cell and the row still derives `edited`.
- **Order and exclusion** affect report columns/sidebar, export columns/sheets, `status`, `check` and `import`.

Alternative directory layouts (for example flat `<lang>.json` files) are not supported; the layout is always `<dir>/<lang>/<namespace>.json`.

## Page language

The page (studio and static report) ships in `en`, `ko`, `zh-TW` and `ja`. Resolution order: `?lang=` query > the language you last picked in the top-bar switcher (remembered in `localStorage`, session-only if storage is blocked; ignored when `languageSwitcher` is off) > `uiLocale` / `--ui-lang` > browser language (`zh-TW`/`zh-Hant`/`zh-HK` map to `zh-TW`, `ko*`, `ja*`, anything else to `en`). The CLI output, `status`/`check` JSON and the TSV header row stay English. Custom states have no translation and show their raw name. The dictionaries are flat JSON files in `src/ui/locales/`. **The ko / zh-TW / ja translations were AI-drafted; reviews and corrections are welcome.**

## Layout and conventions

- Column order everywhere: status, [namespace], key, languages (source first, then `localeOrder`/alphabetical), comment.
- Canonical key order is the source locale file's order. Files are written with each file's own indent (see `indent`; 2 spaces if it has none) and trailing-newline convention.
- Status files (commit them): `<status dir>/<namespace>.tsv`. First line is a header comment, then one line per key in source order, with one value hash per language (source included):

  ```
  # key<TAB>state<TAB>en<TAB>es<TAB>fr<TAB>...
  link.faq<TAB>approved<TAB>2cf24dba5f<TAB>...
  ```

  Files are parsed by header, so adding a language adds a column (its hash is unknown until the row is next recorded, so rows show `edited` with that language in `changedLocales`).

Keys are `<namespace>.<dotted.path>`; array indices are numeric segments (e.g. `faq-page.crj_support.faqs.0.question`).
