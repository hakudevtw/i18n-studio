# Changesets

Add a changeset for every user-visible change:

```bash
pnpm changeset
```

Choose `patch`, `minor`, or `major`, then write a concise release note. CI turns
merged changesets into a release pull request that updates the package version
and `CHANGELOG.md`. Merging that pull request publishes the package to npm.

Changes that do not affect package users, such as documentation or CI-only
updates, do not need a changeset.
