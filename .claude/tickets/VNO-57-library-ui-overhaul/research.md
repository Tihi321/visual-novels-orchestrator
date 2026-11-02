# VNO-57 research: Library UI overhaul and book-type filter

Paths are relative to `C:\projects\Personal\visual-novels-orchestrator` unless stated. Not reproduced visually (no screenshot taken); everything is read from code or counted from the user's real data folders.

## Question
How is the Library built (components, state, types, image loading), which "book type" values exist (code and real data), how is styling organised, how do tests/build/launch work, and how are books shared with Scriptorium, so a card redesign and a type filter can be planned.

## Answer
- The Library is one 232-line file, `src/renderer/ui/LibraryPage.tsx`, fed by `ProjectSummary` (src/shared/protocol.ts:244) and `SourceBook` (protocol.ts:182). A card has no image field today, but 19 of the 21 real projects have an `assets/cover/vN.webp`, and the renderer already loads project images through `vnstudio-file://` (`projectAssetUrl`). A cover on the card needs one small engine change (put the cover path into `ProjectSummary`) or an extra `listAssets` call per project.
- Type filtering can run fully in the renderer: `format`, `kind`, `genre`, `editions`, `theme` are already on every summary, and `format`/`hasChoices` on every Scriptorium book. Picture book vs visual novel (`presentation`) is NOT in the summary; derive it with `isPictureBook(format)` (src/shared/vn.ts:54), exact for the real data, or add the field.
- The layout is cluttered because of `maxWidth: 1100` on the Library root (LibraryPage.tsx:43; the same pattern on every page), a 300px-min auto-fill grid, and up to 8 pills per card. All CSS is one 490-line file with 11 colour variables and no responsive rules.
- The Scriptorium Books tab hides `kids-picture-book` books (not in `VN_FORMATS`, src/engine/vn/reader.ts:6); 12 of 32 Scriptorium books show.

## Path through the code

### 1. Library code (confirmed unless marked)
- Page shell `src/renderer/App.tsx:8-45`: top bar, `warnbar` (the orange banner = last `warnings[]` entry, App.tsx:23), `<main className="page">` (padding 16, overflow auto). `PAGES` list at `src/renderer/store/store.ts:10`.
- `src/renderer/ui/LibraryPage.tsx`:
  - State: `activeTab` 'projects' | 'books' (:24), `projectFilter` 'all'|'in_progress'|'finished' (:25); projects sorted by `updatedAt` desc (:33); finished = `pipeline.steps.build.status === 'done'` (`isProjectFinished`, src/renderer/lib/pipeline.ts:110).
  - Tabs :56-75; status filter :81-109 (beside a redundant "Projects" `section-title` at :80); grid `<div className="grid">` :112; empty states :116-129.
  - Books tab :134-164: `SourceRow` (:170-188, a full-width `.card row`: title, slug, format pill, choice/linear pill, stage pill, "imported", Import button) plus an "Import a book folder" `PathField` card. No filter or search on either tab.
  - `ProjectCard` :190-232: `<button className="card project-card">`; live progress from `s.progress[slug]` merged by `mergeSteps`; click calls `vnStore.getState().openProject(slug)`.
- Chip sources in `ProjectCard` (:202-222): Built/running/failed = pipeline; format pill = `project.format` (vn.json `format`); choice/linear = `project.kind` (vn.json `kind`); genre = `project.genre` (vn.json free text); one green pill per `project.editions[]` (project.md `editions`, uppercased, title = `langName`); theme = `project.theme ?? 'auto theme'` (project.md `theme`); voice = `settings.voice.enabled`; "N warnings" = `book.warnings.length`; counts = chapters/characters/places array lengths; progress = `assets.ready/total`. All assembled in `VnService.summary` (src/engine/vn/service.ts:515-565).
- Store: `src/renderer/store/vn.ts:62` `projects: Record<string, ProjectSummary>`; `projects.listed` (:152) replaces the map, `project.updated` (:171) merges one; `sourceBooks`/`scriptoriumData` come from `books.listed` (protocol.ts:460). Commands `listProjects`, `listSourceBooks` (protocol.ts:605-610) are sent on connect and on Refresh (LibraryPage.tsx:27-31). Engine: `listProjects` service.ts:498; source books `listBooks` reader.ts:62-98.
- Shared components `src/renderer/ui/common.tsx` (88 lines): `Pill` (tones good/bad/warn/dim/accent), `Modal`, `PathField`, `useRecentError`, `ProgressBar`. No Card, Tabs, EmptyState or Icon component; tabs are plain `<button className="on">`.

### Image for the card (confirmed)
- Cover: every project plans a `cover` asset (src/engine/assets/derive.ts:145; landscape "main menu picture"). Real data: `~/VisualNovels/projects/*/assets/cover/v1.webp` exists in 19 of 21 projects (`ls -d */assets/cover`). Other candidates: `assets/bg_<ch>_<scene>/vN.webp` backgrounds, CGs, `sheet_*` character sheets.
- The summary does not carry it. `AssetView` (protocol.ts:313) has `fileRel` (the selected version, e.g. `assets/cover/v2.webp`) but is sent only by `listAssets` (`assets.listed`) per project. `summary()` already loads the manifest and calls `store.resolveAsset(slug, a)` (service.ts:~525), so adding `coverRel?: string | null` to `ProjectSummary` is cheap.
- Scriptorium side: `~/Scriptorium/books/<slug>/out/cover.png` exists for the book checked (the-snail-and-the-salad; a count of 32 `out/cover.png` files was returned for all books). The `vnstudio-file://` handler serves only `projects/<slug>/assets|preview|voice/` and theme fonts (src/main/files.ts:103-129), so a Scriptorium cover needs a new narrowly scoped route (the Scriptorium dir is configurable) or a data URL in `SourceBook` (inferred, size not measured).
- Loading today: privileged custom scheme `vnstudio-file://data/<rel>` (registered src/main/index.ts:35; handler :175-200 with realpath containment, Range support, CSP `img-src vnstudio-file: data:`). The renderer builds URLs with `fileUrl` (src/renderer/hostApi.ts:25) / `projectAssetUrl(slug, rel, rev)` (src/renderer/lib/urls.ts:7). Used by AssetsTab.tsx:122 and ScenesTab.tsx:73 with `loading="lazy"`. No file:// or data URLs for project images.

## 2. Book types (confirmed)

Data folders:
- VN Studio data: `C:\Users\Infplane\VisualNovels` (`resolveDataDir`: `--data` arg, then `VNO_DATA`, then `~/VisualNovels`; src/engine/store/dataFolder.ts:40). Projects in `projects/<slug>/` (21 = "Projects (21)"). `%APPDATA%\vn-studio` is only Chromium cache/userData.
- Scriptorium data: `C:\Users\Infplane\Scriptorium` (`~/VisualNovels/config/settings.md:11 scriptoriumData: ~/Scriptorium`; default service.ts:212); books in `books/<slug>/` (32 folders).

Format ids in code and config:
- Scriptorium `~/Scriptorium/config/formats.md` (each entry has id, display `name`, `script`, `choices`, `picture_book`, `juvenile`, `age_band`): bedtime-toddler, bedtime-story, short-story, chapter-book, middle-grade, novella, novel, visual-novel ("Visual novel"), choice-visual-novel ("Visual novel with choices"), gamebook, kids-visual-story, kids-choice-visual-story, kids-choice-book, nonfiction-short, nonfiction-kids, article, feature-article, short-film, cartoon, kids-cartoon, mystery-puzzle-visual-novel, kids-picture-book ("Picture book for children").
- VN Studio importable: `VN_FORMATS` = visual-novel, choice-visual-novel, kids-visual-story, kids-choice-visual-story, mystery-puzzle-visual-novel (reader.ts:6), plus prose `PROSE_CHOICE_FORMATS` gamebook, kids-choice-book (:8); a book also needs `script: true` unless prose-choice (reader.ts:86-89). Pack folders (`vn/pack.json`) import regardless (`isPackFolder`, service.ts previewImport).
- Other type fields: `kind` 'linear'|'choice' (src/shared/vn.ts:181; source books use `hasChoices = /choice|gamebook/.test(format)`, reader.ts:96); `presentation` 'visual-novel'|'picture-book' (vn.ts:32, optional in vn.json; `presentationOf`/`isPictureBook` :49-56; `PICTURE_BOOK_FORMATS = ['kids-picture-book']` :38); puzzle = format `mystery-puzzle-visual-novel` (puzzle beats may also exist in other formats; no summary flag); `primaryLang` + `editions[]`; `theme` (null = auto); `genre` free text; `age_band`/`juvenile` exist only in Scriptorium config/book.md.

Real counts, 21 VN Studio projects (a node script over `vn.json` + `project.md`, run by me):
- format: visual-novel 14, choice-visual-novel 2, kids-picture-book 2, kids-choice-visual-story 1, mystery-puzzle-visual-novel 2.
- kind: linear 18, choice 3 (choice-visual-novel 2 + kids-choice-visual-story 1).
- presentation field: absent 12, visual-novel 7, picture-book 2 (old vn.json lack it; derive from format).
- primaryLang: en 21. Editions across projects: en 21, hr 6, ar 1, ja 1.
- theme: null (auto) 12, noir 6, storybook 2, pixel-retro 1.
- genre: about 15 distinct free-text values ("Action & Adventure", "mystery", "Children's picture book", "comic mystery adventure", "90s PlayStation survival horror, gothic, melancholy", "neon 80s synthwave retro-futuristic cyber noir" ...): unsuitable as a filter, fine as a truncated subtitle.

Scriptorium Books tab (12 shown of 32): `listBooks` reads `books/*/book.md`; fields `slug,title,format,script,stage,hasChoices,path` (reader.ts:11-19). Formats of all 32 (counted from book.md): novella 13, visual-novel 8, choice-visual-novel 1, kids-choice-visual-story 1, kids-picture-book 2, mystery-puzzle-visual-novel 2, short-film 2, short-story 2, article 1, bedtime-story 1. Shown (12) = visual-novel 8 + choice 1 + kids-choice 1 + mystery 2. The 2 kids-picture-book books are hidden (not in `VN_FORMATS`; they were imported as packs, 8 books have `vn/pack.json`). SourceBook has no presentation, language, genre or cover; format and `hasChoices` are its only type data.

Can the filter run entirely in the renderer? Yes: projects via `ProjectSummary` fields (picture book via `isPictureBook(p.format)`), source books via `format`/`hasChoices`. No engine change is needed for the filter itself.

## 3. Styling (confirmed)
- One global `src/renderer/styles.css`, 490 lines. Colour variables only (:1-14): `--bg #14121c --panel #1c1a27 --panel2 #252233 --line #36324a --text #e2def0 --dim #9490ad --accent #c9a0ff --warn --bad --good`. Font `'Segoe UI', system-ui`, 13px base; no web fonts, no spacing/radius/type-scale variables; several hardcoded colours (`#100e17`, `#3b2a5a`, `#35264d`). Dark only; no `@media` or `prefers-color-scheme` rules (grep). `html, body, #root { overflow: hidden }`; only `.page` scrolls.
- Generic classes: `.card` (padding 8, radius 6), `.row`, `.stack`, `.grid` (:251, `repeat(auto-fill, minmax(300px,1fr))`, gap 10), `.pill` (:260), `.project-card` (:290), `.subtabs`, `.bar`, `.form-grid`, `.modal*`, `.warnbar`.
- Inline styles are used heavily instead of classes (`grep -c "style={{"`): ScenesTab 61, ModelsPage 34, VoiceTab 25, BuildTab 14, LookTab 13.
- Width cap: each page root has an inline `maxWidth`: Library 1100 (LibraryPage.tsx:43), Agents 980 (AgentsPage.tsx:23), Generators 960 (ComfyPage.tsx:62), Settings 640 (SettingsPage.tsx:33), Book 1200 (BookPage.tsx:72; 720 when no project :56). `.page` does not centre, so content hugs the left and a wide window is empty on the right. The grid already auto-fills, so removing the cap is a one-line change per page.
- Other pages (**inferred** from file size and inline-style counts, no screenshots): ModelsPage 581 lines is likely the worst; Book tabs ScenesTab 956, VoiceTab 417, LookTab 363, AssetsTab 303 are dense forms/tables; AgentsPage 167 and ComfyPage 229 are forms in a ~960px column; SettingsPage 104 (640px) is sparse.
- The orange banner: the single latest `warnings[]` entry from the engine, shown above every page (App.tsx:23-30).

## 4. Tests and build (confirmed)
- `yarn test` = `vitest run` (vitest.config.ts: `environment: 'node'`, `tests/**/*.test.ts`, VNO_AUTOSTART=0). There is no jsdom, no React Testing Library and no Playwright in this repo, so components cannot be rendered in tests. Renderer-related tests are logic only: `tests/ui-store.test.ts`, `ui-pipeline.test.ts`, `ui-assets.test.ts`, `ui-mcp.test.ts`, `ui-voice-local.test.ts`, `ui-voice-urls.test.ts`, `main-files.test.ts`. Nothing covers LibraryPage or the summary builder. A filter as a pure function in `src/renderer/lib/` (like `lib/pipeline.ts`) can be unit-tested in this setup.
- `yarn typecheck` = `tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json`; `yarn lint` = `eslint .` (package.json scripts).
- Windows exe: `yarn dist` (build, NSIS installer + portable into `release/`, then `verify:package`); `dist:installer`, `dist:portable`, `dist:dir` (`release/win-unpacked`). `release/` currently holds `VN-Studio-Portable-0.0.1-x64.exe` and `win-unpacked`. Node via `fnm exec --using default <cmd>` on this machine (`node` is not on the Bash PATH).
- Launch for screenshots: `yarn dev` (`build:engine` then `electron-vite dev`) or `release/win-unpacked`. Window width 1440 (src/main/index.ts:54). The data folder is chosen by `--data <dir>` (index.ts:39-41, forwarded to the engine) or `VNO_DATA`. Only one engine may use a data folder (`engine.lock`, README.md:91), so close the user's running app or point at a copy of `~/VisualNovels` (skip big `game/` folders) with `--data`. `yarn dev -- --data <copy>` passing the arg through electron-vite is **inferred, not tested**. The copy's `config/settings.md` still points at `~/Scriptorium` (read-only listing). `scripts/shot-game.mjs` screenshots built games only (headless Chrome), not the app window; there is no app-window screenshot script (open question).

## 5. Shared data with Scriptorium (confirmed)
- The Books tab reads `<scriptoriumData>/books/<slug>/book.md` (frontmatter `format`, `script`, `stage`, `slug`, `title`; `brief.md` `title_fixed`) via `listBooks` (reader.ts:62). Format ids come from Scriptorium's `config/formats.md` (id + display `name`). A project remembers `source:` (and for packs `packDir`/`packHash`) in project.md (e.g. `~/VisualNovels/projects/the-snail-and-the-salad/project.md`).
- A pack = `vn/pack.json` + `vn/text/<lang>.json` in the book folder (README.md).
- Canonical type key: the Scriptorium format id; display names from formats.md (e.g. "Picture book for children", "Visual novel with choices"). Possible grouping (**inferred**, owner to confirm): Visual novel (visual-novel, kids-visual-story), With choices (choice-visual-novel, kids-choice-visual-story, gamebook, kids-choice-book), Picture book (kids-picture-book), Puzzle (mystery-puzzle-visual-novel), plus a Kids flag from `kids-*`/`juvenile`. Scriptorium references `kids-picture-book` as `PICTURE_BOOK_FORMAT_IDS` (C:\projects\Personal\scriptorium\src\engine\store\migrations.ts:176); I found no format filter UI in Scriptorium's renderer (grep for formatFilter etc.), so there is no existing name set to mirror beyond formats.md. VN Studio does not read formats.md today (**inferred** from grep), so display names would be a shared hard-coded table or read from the Scriptorium config.

## What the plan needs
- Files: `src/renderer/ui/LibraryPage.tsx` (split into ProjectCard, SourceRow, filter bar), `src/renderer/styles.css` (variables, card/cover/grid/toolbar styles), `src/renderer/ui/common.tsx` (shared Card/Badge components), `src/renderer/lib/` (pure type/filter/search/sort helpers), `src/shared/protocol.ts` + `src/engine/vn/service.ts:515` (optional `coverRel`, `presentation`), `src/renderer/App.tsx` and page roots (width), `src/main/files.ts` only for Scriptorium covers.
- Interfaces: `ProjectSummary` is also `ProjectDetail.summary` (protocol.ts:294) and the `project.updated` event payload; optional new fields are backward compatible. Engine changes need `yarn build:engine`.
- Card design inputs: cover + title; at most 3 visible chips (type, languages collapsed like "EN +2", status); theme, voice, genre, counts, warnings behind a tooltip or a small detail line. Keep the `data-testid`s (`project-<slug>`, `project-filter-*`, `library-tab-*`, `source-<slug>`, `import-<slug>`); none are used in tests/ (no matches), but external tooling may use them.
- Filter: type chips/dropdown with counts, plus language and text search, applied to both tabs, kept beside the status filter. Filter state is local `useState` today and resets when leaving the page (consider the store or localStorage).
- Tests: pure-helper tests in `tests/` (node env); component tests are not possible without adding jsdom.

## Risks
- Changing `ProjectSummary` touches every client (MCP tools may serialise it; not checked), so keep new fields optional.
- The `vnstudio-file://` handler is a security boundary (realpath containment, CSP); widening it for Scriptorium covers must stay inside one named root.
- Use `resolveAsset` for the cover, not a hard-coded `v1.webp` (circuit-breaker-2 has v1 and v2).
- 2 of 21 projects have no cover: need a fallback (title initial/gradient, or first background).
- Global CSS: changing `.card`, `.pill`, `.grid` affects every page; scope new rules to `.library-*` classes.
- Inline-style-heavy pages (ScenesTab, ModelsPage) will not follow a token change without TSX edits.
- Screenshots need the data folder not locked by the user's running app (`engine.lock`); use a copy.

## Open questions
- Should kids-picture-book Scriptorium books appear in the Books tab (hidden today by `VN_FORMATS`)?
- Which taxonomy does the user want: raw format ids, or grouped (VN / Choice / Picture book / Puzzle / Kids)?
- Scriptorium covers on the Books tab: add a file route or skip images there?
- Scope of "nicer": Library only first, or a token pass across Models and Book tabs?
- Dev launch against a data copy and app-window screenshots: untested.
