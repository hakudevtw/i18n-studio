# Studio

`studio [--port n] [--open|--no-open]` serves the studio at `http://127.0.0.1:<port>/` (loopback only; refresh to see current data; Ctrl+C stops it). It browses and, unless `readOnly`, edits. `--open` / config `open` opens only the base URL (never the token).

## Editing

Unless `readOnly`, the studio edits like Prisma Studio: changes are **staged** and written only when you press **Save** (one unified batch, all or nothing).

- **Cells**: double-click, Enter or F2 opens a textarea (multi-line values are fine) at the height the value already takes; longer input scrolls inside it, and clicks inside it stay in the editor. Enter commits, Shift+Enter adds a line, Esc cancels, Tab / Shift+Tab commit and move on, leaving the editor commits. IME composition is respected. Typing the original value back removes the change, so the count is always truthful.
- **Staged state**: a staged cell shows a word diff with a dot: deleted words struck through in red, inserted words in green, words are segmented per language (`Intl.Segmenter`, so CJK works too). When more than half the text changed, the whole old value is struck through above the new one instead. The same diff marks changed and proposed cells. Groups with staged edits get a dot in the sidebar. The bottom bar shows "N pending changes". Click it to list exactly what will be written (language, row, and the change, wrapped to four lines); click an entry to jump to the cell (centred, clear of the list), or revert it individually. Discard asks for confirmation. A "leave this page?" guard is active while changes are pending.
- **Save** (button or Ctrl/Cmd+S) first commits any open editor, then sends one batch with the value you saw (`expectedOld`) for every cell and the status you saw for every row.
- **Conflicts**: if a value or status changed on disk since you loaded the page, nothing is saved; every staged edit is kept and each conflicted cell shows what is on disk with **Keep mine** (compare against the disk value from now on) or **Use theirs** (drop my edit).
- **Source language**: editing it is allowed but Save first asks, stating how many rows with existing translations will become stale; the toast afterwards reports the server's count.
- **Status**: the status badge opens a menu of the storable states (built in plus `customStates`, never derived ones); it is staged like any edit and applied after the cell edits of the same row, so approving re-baselines. A checkbox column and "Set status for N selected" stage a status for many rows.
- **Keyboard**: arrows, Home/End, Page Up/Down move the selected cell; Enter/F2 edit; Space selects the row; Ctrl/Cmd+S saves; `?` opens a cheat sheet. The grid is one focusable widget (`role="grid"`, `aria-activedescendant`) with a visible focus ring.
- **Copy as TSV** copies the *current* values, including staged ones.
- **Search** highlights every match in keys and values, ignoring case.
- **Theme**: the top bar's sun/moon button switches between light and dark. Until you pick one, the page follows the system setting; the choice is remembered in the browser.
- Menus and dialogs render in a top-level layer (never clipped by the scrolling table) and close on Esc, outside click, scroll or resize, returning focus to their trigger.
- The static `report` and `--read-only` studio render none of this.
- The page is designed for desktop widths: below about 960 px it scrolls horizontally instead of squeezing the table.

## Drafts

Staged edits and status changes are saved to the browser's `localStorage` (debounced about 300 ms, and flushed when the tab is hidden or closed) under `i18n-studio:draft:<projectId>`, where the project id is a short hash of the messages path (the path itself is never exposed). They are removed when you Save, confirm Discard, or the staged set becomes empty (including by reverting to the original values). Nothing is stored in `--read-only` mode, in the static report, or when `persistDrafts` is off; the API token is never stored.

On the next load a banner says "Restored N unsaved changes (saved 5 minutes ago)" with Discard and Dismiss. The draft is checked against the fresh data: an edit whose original value changed on disk comes back as a **conflict** (Keep mine / Use theirs, the same UI as a failed save), and edits for rows or languages that no longer exist are dropped and counted in the banner. If the browser cannot store drafts (private mode, quota, too large) you keep working in memory and get a non-blocking notice while changes are pending. If another tab changes the same draft, this tab warns (last write wins; drafts are never merged). The "leave this page?" guard stays.

- **localStorage is per origin, and the origin includes the port.** By default the studio starts at 4321 and walks up when that port is busy, so a draft saved on one port will not appear on another. Set `port` in `i18n-studio.config.json` for a stable origin.
- Drafts are per browser profile (a different browser or profile will not see them).
- Privacy: the draft text sits in that browser's `localStorage` until it is saved or discarded. Use `--no-persist-drafts` on shared machines.

## Archived rows

`mark archived <keys>` (or the status menu) retires a key without touching the JSON, so application code and types keep working. Archived rows are never `missing`, `stale` or `edited`; `check` ignores their empty or missing values; the default `export` leaves them out (still in `--all`); `init` skips them (and `init --force` keeps their records); `status` counts them separately; the page hides them behind "Show archived" (read-only except for changing their status). With "Show archived" on, selecting only archived rows offers **Delete N permanently**: a confirmation lists every key, then the rows are removed exactly as `prune --yes` would (only while nothing else is pending, since a delete is written at once rather than staged).

`prune [keys...] [--ns x] [--yes]` is the command that deletes keys (the studio's permanent delete uses the same write): it removes archived keys from **every** language's JSON (source included) and from the status files, through the single atomic write path, preserving key order, indent and trailing newline. Without `--yes` it only prints what it would delete. It refuses to leave a gap in an array (prune the whole array or only trailing items). **The tool cannot know whether application code still references a key; check usage first.**

## Save API

The studio server has exactly one write endpoint, `POST /api/save`. The body is JSON with strict, string-only fields:

```json
{
  "edits": [{ "id": "navigation.link.faq", "lang": "ko", "expectedOld": "<value the client saw>", "new": "<new value>" }],
  "statuses": [{ "id": "navigation.link.faq", "state": "approved", "expectedState": "<derived state the client saw>" }]
}
```

A delete is a batch of its own: `{ "prune": [{ "id": "navigation.link.old" }] }`. It cannot be combined with `edits` or `statuses` (400); every row must still be `archived` on disk, otherwise **409** with `kind: "state"` conflicts. It writes what `prune --yes` writes, and refuses (400) to leave a gap in an array.

- **All or nothing.** Everything is validated first (ids and languages must exist in the catalog, `state` must be a storable built-in or `customStates` label, never a derived one like `missing`/`stale`/`edited`/`new`, no duplicate `(id, lang)` in a batch, nothing outside the schema). Nothing is written on any failure.
- **Optimistic concurrency.** Disk is re-read; every `expectedOld` must equal the current value and every `expectedState` the current derived state, otherwise **409** with `conflicts: [{ id, lang?, kind: "value" | "state", current }]` and nothing is written.
- **Order.** Edits are written first, then status changes, so approving in the same batch re-baselines the hashes. Editing the source locale is allowed; the response reports `staleRows`. An empty `new` value is allowed and returned as a warning.
- **Response.** `{ ok, written: { files, cells, deleted? }, staleRows, warnings, model }` (`deleted` only for a prune batch) where `model` is the fresh `/api/model` payload.
- **Status codes.** 200 saved; 400 malformed JSON or schema (short message, input is never echoed); 403 wrong Host, Origin, `Sec-Fetch-Site`, token, or `readOnly`; 405 any method other than POST on `/api/save` (and anything but GET/HEAD elsewhere, including OPTIONS); 409 conflict; 413 body over 1 MiB; 415 content type other than `application/json` (optionally `; charset=utf-8`).
- **Atomic writes.** Every file the tool writes (messages, status files, reports, proposals, exports) goes through one path: a temp file next to the target (`<file>.<pid>.<random>.tmp`), then a rename. A multi-file batch writes all temps first, then renames them all; if anything fails, temps are removed and files already renamed are restored from memory. Limit: renames are atomic per file but the set is not a transaction, so a crash or power loss between two renames can leave some files updated and others not (the next save then reports the mismatch as a conflict). Key order, indent and trailing-newline conventions of each file are preserved.
