# Agents

- Translating: edit `<dir>/<lang>/<ns>.json` in source key order, then run `i18n-studio --dir <dir> draft --ns <ns>` (or pass explicit `<ns>.<key>` arguments) so the rows show `ai-draft`. Use `set <lang> <ns.key> "<text>"` for one-off fixes. Never edit status files by hand. Run `check` afterwards.
- Completing an import: pipe the pasted sheet in (`import -`), open `proposal.json` in the report dir, and for each entry in `ambiguous` / `unmatched` set `resolve` to the correct id(s) from `candidates` (or look the id up in the source files). Set `"reject": true` on rows that look wrong and fix `changes.<lang>.new` if needed. Then `apply`. Do not edit `old` or `id`.
- Removing a key: **never delete JSON keys yourself and never run `prune --yes` without explicit user approval.** Run `mark archived <ns.key>`, run `prune` (dry run) to list what would be deleted, check that no code references the keys, show the list to the user and ask. Only after they approve run `prune --yes`.

The same rules ship in `skills/i18n-studio/SKILL.md`. See the README for how to print or install that skill.
