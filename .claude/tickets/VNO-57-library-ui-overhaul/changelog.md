# VNO-57 changelog

## 2026-11-02: Library overhaul (VN Studio)

Cover-first Library grid with type filtering shared with Scriptorium, picture books on the Books tab, design tokens and a new header.

### Repository `visual-novels-orchestrator`, branch `master` (user's choice, no ticket branch)
- `src/shared/protocol.ts`: `ProjectSummary.coverRel?` (selected cover, else first ready background, project-relative POSIX path) and `presentation?`.
- `src/engine/vn/service.ts`: `summary()` fills both fields from the resolved manifest assets.
- `src/engine/vn/reader.ts`: `kids-picture-book` in `VN_FORMATS`, so the Scriptorium books tab lists picture books.
- `docs/protocol.md`: the two fields described.
- `src/renderer/lib/bookTypes.ts` (new): format table, groups, pattern fallback, `typeGroupOf`, `hasChoices`, `typeBadge`; twin of Scriptorium's `src/renderer/store/bookTypes.ts` (checked identical apart from the `picture` label).
- `src/renderer/lib/libraryFilter.ts` (new): project and source-book filters, counts and sorts.
- `tests/ui-library.test.ts` (new): 2 cases (format grouping; filter, counts, sorts).
- `src/renderer/store/store.ts`: `library: { tab, query }` and `setLibrary`; survives page switches, resets on restart.
- `src/renderer/ui/LibraryPage.tsx`, `ui/library/{ProjectCard,LibraryToolbar,SourceRow}.tsx`, `styles/library.css`: full-width grid of cover cards (badge, title, up to 3 language codes then +N, one status line, progress line, detail row on hover or focus, gradient initials tile when no picture), toolbar with search, sort, type chips with counts, With choices toggle, status filter; compact book rows with a type badge; empty states.
- `src/renderer/styles/tokens.css`, `styles/shell.css`, `main.tsx`, `App.tsx`, `ui/WarnStrip.tsx`, `styles.css`: tokens and aliases, Bricolage Grotesque display face, masthead header (engine dot, spend), dismissable one-line warning strip, every page centred at 1600 px; dead rules and hard-coded purples removed.
- `package.json`, `yarn.lock`: `@fontsource-variable/bricolage-grotesque` (devDependency, bundled into the renderer).
- `README.md`: Library line. `scripts/shot-game.mjs`: empty catch commented (pre-existing lint error).

### Deviations
- Shell uses new class names (`masthead-*`, `warn-strip-*`); `.app` became a flex column.
- "Spend today" shows only while the engine is connected; under 900 px only the engine dot shows (label in its tooltip).
- "Nothing matches these filters." with `library-clear` also shows on the Books tab.
- A `presentation: picture-book` project gets a "Picture book" badge; a choice project with no format badge gets "Choices".
- Lint fix in `scripts/shot-game.mjs` (outside the plan) so `yarn lint` is green.
- Screenshots came from the built `out/` run by electron with its own userData, not from `release/win-unpacked/VN Studio.exe`, because the user's running VN Studio holds the single-instance lock.

### Verification
- `yarn typecheck`: pass. `yarn lint`: pass.
- `yarn test`: 88 files, 1143 tests passed. One full run had 2 failures under load (seen by a worker in `tests/assets-generate.test.ts`); the rerun was green.
- `yarn dist`: NSIS installer and portable exe in `release/`, `verify-package passed`.
- App against a data copy (`VNO_AUTOSTART=0`, MCP 7469, queued jobs removed from the copy): 21 cards, 19 covers, 2 gradient tiles, 0 broken images, no console errors; 5 columns at 1440, 2 at 760; Visual novels + With choices gives 3 projects; Books tab 14 books (2 picture books); warning strip dismisses; spend $0.00 throughout. Screenshots in `.claude/temp/vno57/` (S1 to S6). Data copy deleted.
- Not run: the packaged exe itself; a manual picture-book import.

### Commit status
Committed on `master` (not pushed).
