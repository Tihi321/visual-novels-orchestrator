# VNO-52 plan: export model, section numbering, `vno_export_book` (dry run)

From hub HUB-25 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-25-book-export-kindle-pdf\plan.md`, approved 2026-11-01). Branch `VNO-52_export-model`, uncommitted. Nothing here spends money, calls a model or starts a service.

## Task block (copied from the hub plan)

### VNO-52 Export model, section numbering, `vno_export_book` (dry run)
- NEW `src/engine/export/model.ts` (reads `VnBook` + one `Edition` + asset resolver into an ordered `ExportBook`: `{ title, lang, mode: 'gamebook'|'linear'|'picture-book', cover, sections[] | pages[], warnings[] }`; a section/page = `{ no, title?, paragraphs[], picture?, choices?: [{ text, toNo }], ending? }`).
- NEW `src/engine/export/sections.ts` (the shared algorithm above, verbatim, plus load/save of the stored map).
- NEW `src/engine/export/validate.ts` (every `choice.to` exists, every chapter reached from chapter 1, an ending has no choices, no duplicate numbers, every chapter has text in the edition; failures throw one clear message naming chapter and choice).
- NEW `src/engine/mcp/tools-export.ts` registering `vno_export_book {slug, lang?, format: 'epub'|'pdf'|'plan', order?: 'shuffled'|'in-order', seed?, renumber?, out?}`; `format: 'plan'` is the dry run (returns mode, section map, picture count, warnings, no file). Wire it in `src/engine/mcp/tools.ts` next to the other `tools-*.ts`; add one sentence to `INSTRUCTIONS` (`server.ts:21`) and an "Export a book" section to `docs/mcp-guide.md`. Optional `vncli export` in `src/engine/vncli.ts` only if a sibling command pattern exists.
- Reads: `src/shared/vn.ts` (`presentationOf`, chapters, scenes, beats), `src/engine/game/build.ts:24-35` (`resolveAsset` pattern), the edition type in `src/shared/vn.ts`.
- Tests: NEW `tests/export-model.test.ts` (hub plan tests 1, 2, 5, 7).
- Done: tests pass; `vno_export_book {format:'plan'}` on a choice project returns a section map where start = 1 and numbers are a bijection, and the same map twice; typecheck/lint green; ROADMAP row.

Assignment details from the orchestrator: sibling `export.json` for the stored map (not per language); `epub`/`pdf` accepted by the schema but answer "not built yet"; hr jump phrase "idi na odlomak N", en "{choice text} - turn to section N."; ending en "The End." / "Turn to section 1 to start again."; no cover asset (cover = first scene background, the writers draw the title); section picture = chapter's first scene background, colour; RTL refused; longest section's word count in the warnings.

## Checklist

- [x] `src/engine/export/sections.ts`: the canonical core (header and three functions), then the stored map: `SectionMap`, `chapterSectionMap`, `sectionOf`, `loadSectionMap`, `saveSectionMap`, `staleReasons`, `resolveSectionMap`.
- [x] `src/engine/export/phrases.ts`: the phrase table (en, hr), one place.
- [x] `src/engine/export/validate.ts`, `src/engine/export/model.ts`.
- [x] `src/engine/mcp/tools-export.ts`, wired in `tools.ts`; sentence in `INSTRUCTIONS`; "Export a book" in `docs/mcp-guide.md` (and a row in its tool table).
- [x] `tests/export-model.test.ts`: golden vector, section map + stored map, broken-story table, puzzle/missing-picture (6 tests).
- [ ] `vncli export`: not done (see deviations).
- [x] ROADMAP row.

## Public contract (the next tickets use these)

See the report of the run; the types are in `src/engine/export/model.ts` (`ExportBook`, `ExportSection`, `ExportChoice`, `ExportPicture`, `ExportCover`, `ExportMode`, `loadExportBook`, `buildExportBook`, `pictureCount`) and `src/engine/export/sections.ts`. The phrase table is `src/engine/export/phrases.ts` (`jumpParts`, `endText`, `restartParts`, `sectionWord`, `joinParts`).

## Decisions and deviations

- The core in `sections.ts` is verbatim except `[nums[i], nums[j]] = [nums[j]!, nums[i]!]` (two `!`): the repo's `noUncheckedIndexedAccess` fails the typecheck without them. Same algorithm and same values. The shared core in Scriptorium may not need the `!`.
- Stored map: `projects/<slug>/export.json`, one map for every language (numbers depend on the chapters, which every edition shares). Seed default: the stored seed, else the slug. A stored map is stale when chapters were added or removed, its numbers are not a bijection, or another `seed` or `order` than the stored one is asked for; `renumber: true` recomputes (seed: asked, else the stored one, else the slug).
- Stale handling: `format: 'plan'` reports it in `warnings` and shows what a renumber would give (writes nothing); the file formats (VNO-53/54, calling `loadExportBook({ persist: true })`) must refuse when `PreparedExport.stale` is not empty. `plan` never writes `export.json`; the first file export does.
- Hr ending wording ("Kraj." / "Idi na odlomak 1 za novi početak.") is inferred; the user only gave the jump phrase. The hr jump uses a comma ("Ako ..., idi na odlomak 56.") as in the user's example; en uses " - " as in the hub plan.
- `vn/branches.ts` was read: `checkBranches` drops back-links and only warns, which is the opposite of what the exporter needs, so validation is in `validate.ts`; `MAX_CHOICES` is reused for a warning. `vn.json` and `shared/vn.ts` are untouched.
- A `kind: choice` book is always a `gamebook`, also when its presentation is `picture-book` (the choices would be lost otherwise).
- A picture-book page prints spoken lines as "Name: text" in the caption (with a warning) instead of dropping text.
- The gamebook sections carry no title (a title could spoil); linear sections carry the chapter title; picture-book pages carry it on a chapter's first page. `ending` is set (possibly '') on an ending section: test it with `!== undefined`.
- `pictures` counts the section/page pictures plus the cover.
- `vncli export`: not added (no sibling read-only command pattern worth copying for a tool that will write files in VNO-53/54); the MCP tool is enough per the hub plan.
- The `grayscale` and `out` arguments are accepted by the tool and ignored until VNO-53/54.

## Verification

Filled in after the run: see the end of this file.

### Results (2026-11-02)

- `yarn typecheck`: clean. `yarn lint`: one error, `scripts/shot-game.mjs:111` no-empty, in a file this ticket does not touch (committed in 81b1ffc); no finding in any file of this ticket. `yarn test`: 84 files, 1137 tests passed (6 new in `tests/export-model.test.ts`).
- Real-project dry run (read-only COPY of `the-clockless-god-2` under `.claude/temp/export-data`, `export.json` never written): choice book, 16 chapters, `mode: gamebook`, 16 sections, 17 pictures; start chapter 1 -> section 1; the 16 numbers are a bijection onto 1..16; the same map twice; seed defaulted to the slug. Warnings: sprites not exported (18 characters, 219 cast beats), longest section 1841 words (section 13, chapter 6). `epub` and `pdf` answer "not built yet".
- UNTESTED: the tool through a running MCP server (called the handler directly); nothing was run in the real app.
