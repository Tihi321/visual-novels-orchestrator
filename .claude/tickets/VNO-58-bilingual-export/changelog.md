# VNO-58 changelog

## 2026-11-03: parallel-text (bilingual) book export, uncommitted

Branch `VNO-58_bilingual-export` (from master 84b72ce). Status: **uncommitted**.

### Files changed

- `src/engine/export/model.ts`: contract fields (`ExportChoice.text2`, `ExportSection.paragraphs2/title2/ending2`, `ExportBook.lang2/pairing`, `BuildInput.edition2/lang2`, `ExportOptions.lang2`). `buildExportBook` refuses `lang2 === lang` and RTL `lang2`, pairs paragraphs by beat id, titles and endings by chapter, choices by `<chapter>:<idx>`, counts `pairing` and adds one capped warning for unpaired lines. Speaker names come from the lang2 edition. `loadExportBook` loads `edition2` and turns a missing edition into `project "<slug>" has no <x> edition (editions: <primary>, ...)` for both languages. Without lang2 the book has no new keys.
- `src/engine/export/validate.ts`: `titleTextOf()`.
- `src/engine/export/phrases.ts`: German phrase table, `phraseLang` returns `'de'`, `navWords('de')`.
- `src/engine/export/epub.ts`: `div.pair` + `p.tr` markup with its own `lang`/`xml:lang` for paragraphs, captions, titles, choices and endings; `EPUB_TR_CSS` appended only with lang2; `bookId` and file name include lang2.
- `src/engine/export/pdf.ts`: translation in Lora Italic, `#555`, smaller sizes; falls back to regular with a warning when the italic is missing; keep-together before each pair; file name includes lang2.
- `themes/parchment/fonts/Lora-Italic.ttf`: new, Lora 3.008 static (OFL, already covered by `OFL.txt`).
- `src/engine/export/run.ts`: `lang2` in; `lang2`, `paired`, `unpaired` out on file and dry-run paths.
- `src/engine/mcp/tools-export.ts`: `lang2` parameter and description sentence.
- `src/shared/protocol.ts`: `exportBook.lang2`; `ExportResultView.lang2/paired/unpaired`.
- `src/engine/vn/service.ts`: passes `lang2` (so `export-last.json` keeps it).
- `src/renderer/ui/book/BuildTab.tsx`: "Second language (under each paragraph)" select, initial lang/lang2 from the last export, reset when the main language takes the second one's value, result pill and pairing counts.
- Tests: one new `it` in `tests/export-model.test.ts` plus an `it.each` (2 rows); one `it` each in `tests/export-epub.test.ts` and `tests/export-pdf.test.ts`; lines added to the existing `it` in `tests/export-panel.test.ts`.
- `docs/mcp-guide.md`, `ROADMAP.md`: bilingual bullet, signature, de phrases, font, table row, Done line.

### Deviations

- No GitHub release ships Lora 3.008 (releases: 3.006, 3.011, 3.021). The Italic was taken from the repo at commit 47e3780 ("v 3.008 fixes #64"). The file reports "Version 3.008". The existing Regular/Bold in the repo are not byte-identical to that commit's files, though they also report 3.008.
- Panel test fixture: the `de` edition also has titles, choices and endings so that `unpaired` is exactly 1.
- Titles pair only where a title is non-empty (orchestrator tweak, matches the contract "only where title is set").
- `yarn` is not installed on this machine; all checks ran as `fnm exec --using default node node_modules/...`.

### Verification

- typecheck (tsconfig.node.json, tsconfig.web.json): clean.
- `eslint .`: clean.
- The four export test files: 15/15 passed.
- Full `vitest run`: 1147 passed, 1 failed. The failure was a 15 s timeout in `tests/vn-pipeline.test.ts` "generate jobs" under full-suite load. That file passes alone (14/14), and this ticket does not touch it.
- Font: fontkit check passed (postscriptName `Lora-Italic`, no variation axes, all de/hr glyphs present).

Not run: the real `plan` dry run on a picture book with de and hr editions (no service started); the panel in the real app; the Kindle/PDF live check (A7).

### Follow-ups

- T6 (hub `make-visual-novel` SKILL.md) is a separate HUB task, after merge.
- A native speaker should review the German phrases (D8).

### Polish (checker findings)

- A translated title identical to the main title (it fell back to the vn.json title when lang is not the primary) is no longer printed twice: `title2` is not set and the title counts as unpaired (`model.ts`, `sameAs`).
- EPUB: the 0.2em top gap on the translation now applies (`div.pair p.tr`, specificity above `div.pair p`).
- Docs: `vno_export_book` return shape lists `lang2?`, `paired?`, `unpaired?` (`docs/mcp-guide.md`, `tools-export.ts`); `out` default names the `<slug>-<lang>-<lang2>.<ext>` case.
- ROADMAP VNO-58 line says uncommitted, not merged.
