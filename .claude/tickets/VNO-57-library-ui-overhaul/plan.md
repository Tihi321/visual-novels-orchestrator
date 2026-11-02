# VNO-57: Library overhaul (plan)

Request (user): "make ui far better for both scriptorium and vn studio, add to library filter as well so i can filter then by choices book or other types ... in vn studio, projects are clutered, make these apps far more userfriendly and nicer to look at".
Companion plan: `C:\projects\Personal\scriptorium\.claude\tickets\SCP-51-library-ui-overhaul\plan.md` (same taxonomy, group ids, labels and badge hues).
Research: `research.md` in this folder. Reading: the full one (cover-first grid, type filter, search, sort, picture books on the Books tab, tokens on the shell), not a CSS-only refresh.

## Scope
1. **Projects grid:** responsive, full width, no 1100 px cap; the page is centred at 1600 px at most. Cover-first cards with a title, one type badge, language codes and one status line. Genre, theme, voice and counts go to a detail row that shows on hover or focus, and into the card's `title`.
2. **Toolbar:** a search box, a sort select (Recent, Title), type chips with counts, a "With choices" toggle, and the existing status filter (All / In progress / Finished) with counts that follow the other filters.
3. **Scriptorium Books tab:** picture-book formats are listed (`kids-picture-book` added to `VN_FORMATS`); the same type chips, toggle and search; compact rows with a type badge.
4. **Engine:** optional `coverRel` and `presentation` on `ProjectSummary`.
5. **Tokens and shell:** colour, type scale, spacing, radius and focus tokens; a header restyle; a warning strip you can dismiss. Other pages pick up the tokens through aliased variables and are centred.

## Out of scope
- Redesigning the Book page tabs, Models, Agents, Generators or Settings (tokens and centring only).
- **Scriptorium cover PNGs on the Books tab.** Main serves only `<dataDir>/projects/<slug>/assets|preview|voice/` and theme fonts (`src/main/files.ts:103-129`). The Scriptorium folder is an engine setting (`config/settings.md` `scriptoriumData`) that main does not know, so serving it would mean a second, configurable root across the `vnstudio-file://` security boundary. That is not small and safe. Books stay as rows without covers.
- Component tests (the repo has no jsdom; only pure helpers are tested).
- Any change to the import, the pipeline or the game build.

## Design direction: "after-hours stage"
VN Studio is where stories become games, so its Library should look like a shelf of title screens. The memorable element is the **cover**: each card opens with the project's main-menu picture, full bleed at 16:9, and a 3 px progress line along its bottom edge (lavender while building, verdigris when built). Everything else stays quiet: one badge, small language codes, one status line. It keeps the existing plum-dark and lavender identity, and shares the body face, the spacing and radius scales and the type-badge hues with Scriptorium. Scriptorium's display face is a literary serif (Alegreya); VN Studio's is a lively grotesque (Bricolage Grotesque).

Palette tokens (`styles/tokens.css`, `:root`):
| token | hex | use |
|---|---|---|
| `--night-0` | `#110f18` | app background |
| `--night-1` | `#18151f` | header, panels |
| `--night-2` | `#221e2d` | cards, chips, inputs |
| `--night-3` | `#0c0a12` | cover backdrop, warning strip |
| `--rule` | `#342e44` | borders |
| `--ink` | `#ece7f6` | text |
| `--ink-dim` | `#9c95b2` | secondary text |
| `--lavender` | `#c9a0ff` | primary accent: active tab, selected chip, focus, building progress |
| `--lavender-wash` | `#2c2240` | selected backgrounds (replaces `#35264d` and `#3b2a5a`) |
| `--verdigris` | `#5fcf9f` | Built, ok |
| `--amber` | `#f4b955` | warnings |
| `--rose-red` | `#f0606e` | failed, errors |
Type-badge hues, the same as in Scriptorium: `--t-vn #b49cff`, `--t-choices #ff8fb3`, `--t-picture #7fd0e6`, `--t-scripts #6fd3b0`, `--t-puzzle #f0c06a`, `--t-nonfiction #9fb4cc`, `--t-stories #c9b791`.
Old variables are aliased: `--bg: var(--night-0)`, `--panel: var(--night-1)`, `--panel2: var(--night-2)`, `--line: var(--rule)`, `--text: var(--ink)`, `--dim: var(--ink-dim)`, `--accent: var(--lavender)`, `--warn: var(--amber)`, `--bad: var(--rose-red)`, `--good: var(--verdigris)`.

Type: display **Bricolage Grotesque** (bundled with `@fontsource-variable/bricolage-grotesque`) for the brand, the page title and the card titles. Body is `'Segoe UI Variable', 'Segoe UI', system-ui` (shared with Scriptorium). Scale `--fs-*`: 11, 12, 13 (base), 15, 18, 22, 28. Brand "VN Studio" at 18 / 650 weight in normal case (not the all-caps "VN STUDIO"). No all-caps labels; meta text uses commas. Spacing `--sp-1..6`: 4, 8, 12, 16, 24, 32. Radius: `--r-sm 4px` (chips, badges, inputs), `--r-md 10px` (cards; the cover is clipped by the card), `--r-lg 14px` (modals). Focus: `:focus-visible { outline: 2px solid var(--lavender); outline-offset: 2px }`. Motion: only the detail row on hover or focus (120 ms opacity and height), off under `prefers-reduced-motion`.

Header anatomy (one row, 44 px, `--night-1`):
```
VN Studio    Library  Book  Models  Agents  Generators  Settings                ● engine connected   Spend today $0.42
            ───────  <- 2px lavender underline under the active tab
⚠ ComfyUI is not reachable at 127.0.0.1:8188: images wait                                                     [×]
```
Library wireframe (the window is 1440 px wide, so about 5 columns at 240 px minimum):
```
Library                                         [Search titles…        ]  Sort [Recent ▾]   [Refresh]
[Projects 21] [Scriptorium books 14]
[All 21] [Visual novels 17] [Picture books 2] [Puzzle 2] | [◇ With choices 3]          [All 21|In progress 4|Finished 17]
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│   cover     │ │   cover     │ │  (no cover: │ │             │ │             │
│ [VN]  16:9  │ │ [Choice VN] │ │  gradient + │ │             │ │             │
│▔▔▔▔▔▔▔▔▔▔▔▔▔│ │▔▔▔▔▔▔ 60% ▔▔│ │  initials)  │ │             │ │             │
│ Circuit Breaker│ The Clockless God   ...                                       │
│ EN HR       │ │ EN +2       │                                                   │
│ ● Built     │ │ ● In progress, 42 of 60 assets                                  │
│ (hover: Action & Adventure, noir theme, voice, 6 chapters, 9 characters, 7 places)
└─────────────┘ └─────────────┘
```
Card anatomy: a `<button className="lib-card">` holding `.lib-cover` (16:9, `object-fit: cover`, `loading="lazy"`, `alt=""` because the title follows; with no cover, a gradient from a hue hashed from the slug plus the title's initials in Bricolage 28). The badge sits top-left on the cover, and the progress line runs along the cover's bottom edge. Then the title (Bricolage 15/600, one line, ellipsis), language codes (up to 3 uppercase codes in 11 px outlined boxes, then `+N`; the box `title` gives the full names via `langName`), and the status line (a dot plus text): `Running: <step>` lavender, `Failed at <step>` rose-red, `Built` verdigris, `In progress, R of T assets` dim; when `warnings > 0` it ends with `, N warnings` in amber. Detail row `.lib-detail`: genre (1 line), theme or "auto theme", "voice" when on, and "C chapters, K characters, P places".

## Files and modules to touch
- New: `src/renderer/styles/tokens.css`, `styles/shell.css`, `styles/library.css`; `src/renderer/lib/bookTypes.ts`; `src/renderer/lib/libraryFilter.ts`; `src/renderer/ui/WarnStrip.tsx`; `src/renderer/ui/library/ProjectCard.tsx`, `library/SourceRow.tsx`, `library/LibraryToolbar.tsx`; `tests/ui-library.test.ts`.
- Edited: `src/renderer/main.tsx`, `styles.css` (`:root` aliases; dead rules removed in Task 5), `App.tsx`, `ui/LibraryPage.tsx`, `store/store.ts`, `src/shared/protocol.ts`, `src/engine/vn/service.ts` (`summary`), `src/engine/vn/reader.ts` (`VN_FORMATS`), `docs/protocol.md`, `README.md` (Library line), `package.json` (font).

## Tasks for workers
Order: Task 1 and Task 2 in parallel, Task 3 in parallel with them (pure), Task 4 after Task 3's contract exists (it can start in parallel against the contract below), Task 5 last. Workers do not commit. Run Node as `fnm exec --using default yarn <script>`. Keep new CSS in your own new file with new class names; Task 5 deletes dead rules from `styles.css`.

### Task 1: Tokens, fonts and shell
- Files: `styles/tokens.css`, `styles/shell.css`, `main.tsx`, `styles.css` (`:root` block, lines 1-16, and the `.page` rule at ~97 only), `App.tsx`, new `ui/WarnStrip.tsx`, `package.json`.
- Do: `yarn add @fontsource-variable/bricolage-grotesque`. In `tokens.css`, add all the tokens, the font import, the global focus rule and the reduced-motion rule. In `main.tsx`, import order is tokens, styles, shell, library (create an empty `library.css` stub for Task 4). Alias the old variables in `styles.css` `:root`. Header: `<header className="masthead">` with the brand, the nav (keep `nav-<page>` testids) and on the right a status dot plus "engine connected" or "engine not connected" and "Spend today $x.xx". Replace the `warnbar` div with `<WarnStrip text={warning}/>` (one line with an ellipsis, a click expands it, × hides it until a different text arrives; `data-testid="warn-strip"`, `warn-dismiss`). `.page`: keep `overflow: auto` and the padding `var(--sp-4) var(--sp-5)`, and add `.page > * { margin-inline: auto; max-width: 1600px }` so every page root is centred. The pages' own inline `maxWidth`s (Agents 980, Comfy 960, Settings 640, Book 1200/720) stay and are now centred.
- CSP (`src/renderer/index.html`) already allows `font-src 'self'`; nothing changes.
- Result (Task 1): DONE. `@fontsource-variable/bricolage-grotesque` added to devDependencies (+ yarn.lock). New `styles/tokens.css` (font import, palette, badge hues, `--fs-*`, `--sp-*`, `--r-*`, focus and reduced-motion rules), `styles/shell.css` (`.masthead*`, `.warn-strip*`, `.page > *` centring, `.app` as a flex column so the layout holds with or without the strip), empty `styles/library.css` stub (did not exist), `main.tsx` imports tokens, styles, shell, library. `styles.css`: `:root` aliased, `.page` padding `var(--sp-4) var(--sp-5)`. `App.tsx`: masthead with brand, nav (`nav-<page>` kept), status dot, "engine connected / not connected", "Spend today $x.xx"; `<WarnStrip>` (`ui/WarnStrip.tsx`, `warn-strip`, `warn-dismiss`). Checks: `yarn typecheck` clean; `yarn build` ok (woff2 files emitted); `yarn lint` has 1 error in `scripts/shot-game.mjs:111` (no-empty), not touched by this task. Not run: the app (visual check is Task 5). Deviation: new class names (`masthead-nav`, not `.tabs`) so the old `.topbar/.brand/.warnbar/.tabs` rules are now dead for Task 5.

### Task 2: Engine summary fields and picture books on the Books tab
- Files: `src/shared/protocol.ts` (`ProjectSummary`), `src/engine/vn/service.ts` (`summary`, ~515-565), `src/engine/vn/reader.ts:6`, `docs/protocol.md`.
- Contract:
```ts
// ProjectSummary, both optional so old clients and MCP output keep working
/** The card picture, relative to the project folder with forward slashes (`assets/cover/v2.webp`): the selected cover version, else the first ready `bg_*` background, else null. */
coverRel?: string | null
/** `presentationOf(book)`: picture-book or visual-novel. Missing when there is no vn.json yet. */
presentation?: Presentation
```
- In `summary()`, the manifest loop already resolves each asset (`this.store.resolveAsset(slug, a)`). Record the resolved file of `a.id === 'cover'`, and the first resolved `a.id.startsWith('bg_')`. Convert to a project-relative POSIX path (check what `resolveAsset` returns; if absolute, make it relative to `this.store.file(slug)`). Never hard-code `v1.webp`: `circuit-breaker-2` has v1 and v2.
- `VN_FORMATS`: add `'kids-picture-book'` (Scriptorium writes picture books as scripts, `script: true`, with a VN pack). Check that `previewImport`/`import` of such a book still takes the pack path (`isPackFolder`); `tests/picture-book.test.ts` and `tests/fixtures/books/picture-book` cover the pack import. Run them.
- `docs/protocol.md`: describe the two fields where `ProjectSummary` is explained.
- Check: `yarn build:engine`, `yarn typecheck`, `yarn test`. Manual: `yarn engine -- books` against the data copy lists 14 books (8 VN + 1 choice VN + 1 kids choice + 2 puzzle + 2 picture books).
- Result (Task 2): DONE. `ProjectSummary.coverRel?` and `presentation?` added (`src/shared/protocol.ts`); `summary()` records the resolved file of `cover`, else the first resolved `bg_*`, and converts it with `path.relative(this.store.file(slug), file)` split on `path.sep` and joined with `/` (`resolveAsset` returns an absolute path); null when neither is ready. `presentation` is `presentationOf(book)`, omitted when there is no vn.json. `kids-picture-book` added to `VN_FORMATS`. `docs/protocol.md` describes both fields after the pipeline paragraph. Checks: `yarn build:engine` ok, `yarn typecheck` clean, `yarn test`: 1142 of 1143 pass (87 of 88 files, picture-book and pack tests included); the one failure was in `tests/assets-generate.test.ts` ("generate jobs") under full-suite load, and that file passes alone (26 of 26). Not run: `yarn engine -- books` (orchestrator's data-copy check), and the import path for a real picture-book folder beyond the fixture tests.

### Task 3: Taxonomy and filter helpers (pure, tested)
- Files: new `src/renderer/lib/bookTypes.ts`, new `src/renderer/lib/libraryFilter.ts`, new `tests/ui-library.test.ts`.
- `bookTypes.ts`: the **same table, group ids and labels as Scriptorium's `src/renderer/store/bookTypes.ts`** (see the SCP-51 plan, Task 3: the 22 format ids, the pattern fallback, `TypeGroup`, `TYPE_GROUPS`, `typeGroupOf`, `hasChoices`, `typeBadge`). Copy it, with a header comment naming the twin file and saying both must change together. The one difference is the label of `picture`: "Picture books" here (VN Studio never holds bedtime text formats); Scriptorium uses "Picture & bedtime".
- `libraryFilter.ts` contract:
```ts
export type StatusFilter = 'all' | 'in_progress' | 'finished'
export type SortKey = 'recent' | 'title'
export interface LibraryQuery { group: TypeGroup | 'all'; choices: boolean; query: string; status: StatusFilter; sort: SortKey }
export const DEFAULT_QUERY: LibraryQuery // { group:'all', choices:false, query:'', status:'all', sort:'recent' }
export function projectGroup(p: ProjectSummary): TypeGroup   // 'picture' when p.presentation === 'picture-book' or isPictureBook(p.format), else typeGroupOf(p.format)
export function projectChoices(p: ProjectSummary): boolean   // p.kind === 'choice'
export function filterProjects(list: ProjectSummary[], q: LibraryQuery): ProjectSummary[]   // group, choices, status (isProjectFinished), query words in title+genre+slug; then sort (recent: updatedAt desc; title: localeCompare)
export function projectCounts(list: ProjectSummary[], q: LibraryQuery): { groups: Record<TypeGroup | 'all', number>; choices: number; status: Record<StatusFilter, number> }
  // groups: after query, choices and status (ignoring group); choices: after query, group and status; status: after query, group and choices
export function filterSourceBooks(list: SourceBook[], q: LibraryQuery): SourceBook[]   // group from typeGroupOf(format), choices from hasChoices, query in title+slug; status ignored; sorted by title
export function sourceBookCounts(list: SourceBook[], q: LibraryQuery): { groups: Record<TypeGroup | 'all', number>; choices: number }
```
- Tests (test-discipline: 2 cases): (1) "groups the real formats": the 5 project formats, `kids-picture-book`, `gamebook` and an unknown id give the expected group and choices, and `presentation: 'picture-book'` on a `visual-novel` gives `picture`; (2) "filters, counts and sorts projects": 5 summaries, combining group plus choices plus status plus query, the three count kinds, and both sorts. Build the summaries with a small local factory.
- Result: DONE. `bookTypes.ts` (22 ids, pattern fallback, header names the twin), `libraryFilter.ts`, `tests/ui-library.test.ts` (2 cases). `isPictureBook` reused from `src/shared/vn.ts`. Typecheck, vitest (ui-library + ui-store 8 passed) and `yarn test` (1143 passed) green.

### Task 4: Library page
- Files: `ui/LibraryPage.tsx`, new `ui/library/ProjectCard.tsx`, `ui/library/SourceRow.tsx`, `ui/library/LibraryToolbar.tsx`, `styles/library.css`, `store/store.ts` (state and setter only; add the setter name to `ACTION_KEYS` at `store.ts:184`).
- Store: `library: { tab: 'projects' | 'books'; query: LibraryQuery }` (default tab projects, `DEFAULT_QUERY`), and `setLibrary(patch: Partial<{ tab; query: Partial<LibraryQuery> }>)`. It is UI-only and survives page switches (it resets on app restart).
- `LibraryPage`: remove `style={{ maxWidth: 1100 }}` (the page container centres it). Keep the data loading `useEffect` and the Refresh button. Layout per the wireframe. The grid is `.lib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--sp-4) }`. A media query below 760 px gives `minmax(200px, 1fr)`.
- `LibraryToolbar` props: `{ tab, query, counts, onQuery(patch), onTab(tab), onRefresh, projectTotal, bookTotal }`. Search `data-testid="library-search"`; sort `<select data-testid="library-sort">` shown only on the Projects tab; type chips `data-testid="type-chip-<group|all>"` with `aria-pressed` and text `<label> <count>`, a chip with count 0 hidden unless selected; `choices-toggle`; the status segmented control keeps `project-filter-all|in-progress|finished` and its "(n)" counts and is shown only on the Projects tab. Tabs keep `library-tab-projects|books` with their totals.
- `ProjectCard` (`data-testid="project-<slug>"`, opens the project as today): the anatomy above. Cover URL `projectAssetUrl(p.slug, p.coverRel, p.updatedAt)`; `onError` falls back to the gradient tile. Status from the existing helpers `mergeSteps`, `stepRows`, `isRunning`, `failedStep`, `isProjectFinished` (`lib/pipeline.ts`). The card's `title` attribute holds the full detail text.
- `SourceRow` (`source-<slug>`, `import-<slug>` kept): a compact row with the title, a type badge from `typeBadge(format)`, a dim slug, the stage, "imported" and Import / Import again. The "Import a book folder" card stays below the list.
- Empty states: no projects gives "No projects yet. Import a book from Scriptorium books." with the existing `library-go-books` button; filters with no match give "Nothing matches these filters." with `library-clear`, which resets the query to its defaults but keeps the sort.
- Result: DONE (UNTESTED in the running app; orchestrator takes the screenshots). Store `library` + `setLibrary` (+ `LibraryTab` type exported from store.ts), `LibraryPage`, `library/ProjectCard|SourceRow|LibraryToolbar`, `styles/library.css` (also holds the `.badge`/`.t-*` rules). Empty-state `library-clear` also shows on the Books tab. `yarn lint` has 1 pre-existing error in `scripts/shot-game.mjs:111` (no-empty), none in these files.

### Task 5: Integration, docs and verification
- Delete `styles.css` rules no longer used (`.project-card`, `.warnbar`, the old `.tabs button.on` background `#35264d` gets `var(--lavender-wash)`, and so on; grep each class in `src/renderer` first). Replace the remaining hard-coded `#35264d`, `#3b2a5a` and `#100e17` in `styles.css` with tokens.
- `README.md`: one line under the layout or data section saying that the Library filters by type (the same groups as Scriptorium) and that picture books are listed.
- Run every acceptance check and take the screenshots.

- Result (Task 5): DONE. Dead `.app` grid, `.topbar`, `.brand`, `.tabs button.on`, `.warnbar`, `.project-card` rules removed; `#35264d`/`#3b2a5a` now `var(--lavender-wash)`, `#100e17` `var(--night-3)`. README Library line added. `scripts/shot-game.mjs` empty catch commented (pre-existing lint error). Screenshot pass fixes: grid media query `max-width: 759px` (2 columns at 760), header hides the engine label under 900 px, singular "1 warning" and detail counts. Screenshots S1-S6 taken over CDP from the built `out/` (electron with a temp boot script giving its own userData, window off-screen and click-through), against a robocopy of the data folder with its queued jobs removed, `VNO_AUTOSTART=0`, MCP on 7469; spend stayed $0.00; copy deleted. The packaged exe itself was not started: the user's VN Studio holds the single-instance lock.

## Acceptance criteria
| # | Criterion | Proof |
|---|---|---|
| 1 | Grid uses the full width, centred at 1600 px at most; about 5 cards a row at 1440 px and 2 at 760 px | screenshots S1 (1440×900) and S3 (760×900) |
| 2 | 19 of 21 projects show their cover; 2 show a background or the gradient tile; no broken images | S1, and DevTools console free of `vnstudio-file` errors |
| 3 | Card shows only cover, badge, title, languages and status; details on hover or focus | S1 plus S2 (one card hovered, one focused by Tab) |
| 4 | Type chips, choices toggle, status, search and sort combine; counts update; 0-count chips hidden | `tests/ui-library.test.ts`; manual: `vn` chip plus choices gives the 3 choice projects; S4 |
| 5 | Books tab lists 14 Scriptorium books, picture books included, with the same filter | manual against the data copy; S5 |
| 6 | Other pages are centred, use the tokens and look unchanged otherwise | S6: Book, Models, Settings |
| 7 | Warning strip shows one line and dismisses | manual (with ComfyUI off the engine warns), S1 |
| 8 | Static checks and tests | `yarn typecheck`, `yarn lint`, `yarn test` green |
| 9 | Windows build | `yarn dist` succeeds (installer plus portable in `release/`, `verify:package` passes); start `release/win-unpacked/VN Studio.exe --data <copy>` with `VNO_AUTOSTART=0` and see S1's layout |

Screenshots, safely (save under `.claude/temp/vno57/`):
- **Never use `~/VisualNovels`.** Copy it: `robocopy %USERPROFILE%\VisualNovels <repo>\.claude\temp\vno57-data /E /XD game node_modules /XF engine.lock` (the game builds are large and not needed). The copy's `config/settings.md` still points at `~/Scriptorium`, which the Books tab only reads. Do not press Import during verification.
- Start: `$env:VNO_DATA='<copy>'; $env:VNO_AUTOSTART='0'; fnm exec --using default yarn dev` (env vars, because passing `--data` through `electron-vite dev` is untested). Or start the unpacked exe with `--data <copy>`.
- Capture the window with a PowerShell script in `.claude/temp/` (`System.Drawing` `CopyFromScreen` over the window rect from `Get-Process "VN Studio" | % MainWindowHandle` plus `GetWindowRect`); resize the window to 760 px for S3.
- Delete the copy afterwards.

## Open questions (with the recommended default)
1. Should a project without a cover fall back to its first background (default), or always to the gradient tile? **Default: first background, then the tile.**
2. Should the language codes show at most 3 codes and then "+N"? **Default: yes.**
3. Should the filter and sort survive an app restart (localStorage), not only page switches? **Default: page switches only.**
