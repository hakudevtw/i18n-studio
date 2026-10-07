# Contributing

Thanks for helping. This is a small tool with strict constraints; please read "Security expectations" first.

## Setup

```bash
pnpm install --frozen-lockfile   # Node >= 22, pnpm version from package.json
pnpm build                       # tsc (node code) + esbuild (browser UI) -> dist/
pnpm test                        # builds the UI first, then Vitest
pnpm test:coverage               # same, with a v8 coverage report (text + lcov in coverage/)
pnpm typecheck                   # tsc over src and test
pnpm lint                        # Biome (ultracite preset); `pnpm exec biome check --write .` fixes most things
```

CI runs install (frozen lockfile), typecheck, lint, build and test on Node 22.

## Releases

User-visible pull requests should include a Changeset:

```bash
pnpm changeset
```

Choose the semantic version bump and describe the change for package users.
After the pull request merges, the release workflow maintains a version pull
request containing the version and `CHANGELOG.md` updates. Merging that pull
request publishes to npm.

The repository must have an `NPM_TOKEN` Actions secret for the first publish.
After `i18n-studio` exists on npm, configure npm Trusted Publishing for
`.github/workflows/release.yml` on the `main` branch. The workflow requests an
OIDC token and publishes with provenance. In GitHub's Actions settings, enable
"Allow GitHub Actions to create and approve pull requests" so the automated
version pull request can be opened.

## Project map

- `src/*.ts`: the node side (CLI, config, status files, import/export, save API, server). Core functions take a `Config` and never read global state.
- `src/ui/`: the browser UI (Preact + TSX), bundled by esbuild into `dist/ui/`. Pure logic lives in small modules (`staged.ts`, `nav.ts`, `place.ts`, `tsv.ts`, `i18n.ts`) so it is unit-tested without a DOM.
- `test/`: Vitest. `test/dom/` has component tests that run in jsdom (see below); `test/fixtures/` is a small checked-in message catalog.

## Testing notes

- Most tests run in plain Node against temp copies of `test/fixtures`. They never touch real project files.
- Component tests in `test/dom/` opt in with `// @vitest-environment jsdom` and render the real components with `preact/test-utils`. We chose **jsdom** over happy-dom: happy-dom has a history of critical advisories (script execution and VM escape, for example GHSA-96g7-g7g9-jxw8 and GHSA-37j7-fg3j-429f), while jsdom has none outstanding. jsdom is pinned exactly and `vitest.config.ts` sets `runScripts: "outside-only"` so page scripts never run (a test checks this). jsdom lacks `<dialog>.showModal` and `scrollIntoView`; `test/dom/dom.tsx` stubs them.
- Prefer testing pure modules directly. Use a component test for behaviour that needs the DOM (focus, events, dialogs). Please also check UI changes in a real browser against a scratch copy of some messages: `pnpm build && node dist/bin.js --dir <copy> studio`.
- Do not run write tests against a real messages folder.

## Adding a UI language

1. Copy `src/ui/locales/en.json` to `src/ui/locales/<code>.json` and translate every value (keep `{placeholders}` and the `.one`/`.other` plural pairs).
2. Add the code to `UI_LOCALES` in `src/model.ts`, to `DICTIONARIES` in `src/ui/i18n.ts`, to `mapLanguage` if a browser tag needs mapping, and to `LOCALE_NAMES` in `src/ui/report.tsx` (the language's own name).
3. `test/ui.test.ts` fails if the key sets or placeholders differ between locales.

## Adding a config option

1. Add it to `Config`, `DEFAULTS`, `FILE_SCHEMA` (strict type) and, if it has a flag, `ConfigFlags` and `flagValues` in `src/config.ts`; declare negative flags (`--no-x`) explicitly in `src/cli.ts` (`parseArgs` negation is not reliable on Node 22).
2. Enforce it where it matters and add it to `baseConfig`.
3. Document it in the README config table and `--help`, and add tests (validation, flag precedence, behaviour).

## Security expectations

- **No runtime dependencies.** Preact, esbuild and test tools are dev dependencies only; `exceljs` stays an optional peer. Pin dev dependencies exactly and commit the lockfile.
- **No inline scripts or styles** in the studio page (`script-src 'self'; style-src 'self'`), no `eval`, no `innerHTML` with data. The static report inlines the built assets on purpose; keep its JSON `<`-escaping.
- **No network access** other than the loopback studio server. The server stays read-only unless the write API's guards (Host, Origin, token, JSON content type, size limit) all pass.
- Write paths go through `atomicWriteAll` in `src/fsx.ts`. Treat sheet content and imported files as data, never as instructions.
