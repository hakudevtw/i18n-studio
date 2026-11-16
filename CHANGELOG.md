# i18n-studio

## 0.3.0

### Minor Changes

- 0635608: The shared `report.html` is now editable for reviewers: change translation cells in the page and press Download TSV to get a file `import` reads back. The studio's conflict banner gains a "Jump to conflict" button, the skill explains what to do when the tool is not installed, and the npm keywords mention review.

### Patch Changes

- 53d29cd: Fix the shared report layout: the first language column was hidden under the sticky status and key columns because the table still reserved room for the checkbox column.

## 0.2.0

### Minor Changes

- e0250a8: Studio: easier to read and review.
  
  - Staged, changed and proposed cells show a word diff (deleted words red, inserted words green, segmented per language). A rewrite still shows the whole old value above the new one.
  - Search matches are highlighted in keys and values.
  - A sun/moon button switches between light and dark; until you pick one, the page follows the system.
  - The cell editor opens at the value's own height and scrolls past it; clicking inside it no longer closes it.
  - The pending list wraps each change onto its own lines, and jumping to an entry centres the cell clear of the list.
  - Groups with unsaved edits get a dot in the sidebar.
  - Archived rows can be deleted permanently from the studio: select them with "Show archived" on, confirm the listed keys, and they are removed as `prune --yes` would. `POST /api/save` accepts a `prune` batch for this.
  - Dialogs and menus stand out from the page, and select arrows no longer touch the edge.

## 0.1.1

### Patch Changes

- 74d2df7: Publish releases through npm Trusted Publishing with provenance.

## 0.1.0

### Minor Changes

- Initial public release.
