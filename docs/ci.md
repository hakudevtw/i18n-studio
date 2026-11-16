# CI

`check --format github` prints GitHub Actions annotations, so a pull request shows missing or stale translations inline. It exits 0 for warnings; list kinds in `--fail-on` to fail the job.

```yaml
name: i18n
on: pull_request
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec i18n-studio --dir src/i18n/messages check --format github --fail-on status-file,missing-key
```

Pin third-party actions to a commit SHA in your own repository.
