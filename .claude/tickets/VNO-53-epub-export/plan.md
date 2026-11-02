# VNO-53 plan: EPUB export (reflowable EPUB 3)

From hub HUB-25 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-25-book-export-kindle-pdf\plan.md`, approved 2026-11-01). Branch `VNO-53_epub-export`, uncommitted, stacked on `VNO-52_export-model` (also uncommitted). Nothing here spends money, calls a model or starts a service.

## Task block (copied from the hub plan)

### VNO-53 EPUB export (reflowable EPUB 3)
- NEW `src/engine/export/epub.ts` (JSZip): `mimetype` first and stored, `META-INF/container.xml`, `content.opf` (manifest, spine, `dc:language` = edition language, cover-image property), `nav.xhtml` (TOC), one xhtml per section/chapter/page with `id="s<no>"`, `style.css`, `images/*.jpg`.
- NEW `src/engine/export/images.ts` (sharp: to JPEG, ~1000 px wide, quality ~80, colour kept, mild contrast lift; `grayscale: true` for an optional grey variant).
- Gamebook layout: each section a separate xhtml file starting with a big bold number, picture, text, then "turn to section N" where only "section N" is a link; the ending shows "The End" and a link to section 1. Linear and picture-book: sequential files, one picture per page, caption below it; nav lists chapters. Gamebook files in number order, nav lists numbers only plus "Start: section 1".
- Wire `format: 'epub'` in `tools-export.ts`; output `projects/<slug>/export/<slug>-<lang>.epub` (or `out`).
- Tests: NEW `tests/export-epub.test.ts` (hub plan test 3). Probe: a tiny 3-section gamebook EPUB for the Kindle link check.
- Done: tests pass; epubcheck if available (else "not available"); every link and image resolves; the probe EPUB is what the user sends to the Kindle first; a real project exports (choice, picture book, linear VN) with warnings listed.
- User answers: colour JPEG; no cover asset: the first scene's background with the title over it; the section picture is the chapter's first scene.

## Checklist

- [x] `src/engine/export/images.ts`: `toBookJpeg(input, { width?, quality?, grayscale? }) -> { data, width, height }`, `toCoverJpeg(input, title, author?, opts)` (SVG overlay: dark band, XML-escaped title wrapped to the width, author below), `coverOverlaySvg`, `wrapTitle`.
- [x] `src/engine/export/epub.ts`: `buildEpub(book: ExportBook, { grayscale?, modified? }) -> { bytes, sizeBytes, pictures, warnings }`; `writeEpubFile(store, slug, opts) -> { path, bytes, pictures, book, map?, warnings }` (persists the numbering, refuses a stale map, warns above 40 MB); `sectionFileOf`, `EPUB_CSS`, `EPUB_WARN_BYTES`.
- [x] `src/engine/export/phrases.ts`: `startText(lang, no)` ("Start: section 1" / "Početak: odlomak 1"), `navWords(lang)` (Contents/Sadržaj, Cover/Naslovnica); it also has `startLabel`, added by the earlier duplicate run of this ticket.
- [x] `src/engine/mcp/tools-export.ts`: `format: 'epub'` via `writeEpubFile`; `pdf` still answers "not built yet"; the result adds `path` and `bytes`.
- [x] `scripts/export-probe.ts`: the probe EPUB without the engine.
- [x] `tests/export-epub.test.ts`: 2 tests (plan test 3).
- [x] `docs/mcp-guide.md` "Export a book", ROADMAP row.
- [x] `jszip` ^3.10.2 in `package.json` / `yarn.lock` (kept from the earlier run).

## Probe

`yarn tsx scripts/export-probe.ts [out.epub] [en|hr]` writes `C:\projects\Personal\visual-novels-orchestrator\.claude\temp\kindle-probe\probe-gamebook.epub` (21,651 bytes): a cover with the title drawn over the picture, section 1 (one picture, links to sections 3 and 2), section 2 (link back to section 1), section 3 (an ending). Unzipped and checked: `mimetype` first, cover.jpg and s001.jpg present, every link resolves, the nav lists 1, 2, 3 and "Start: section 1".

## Real exports (copies under `.claude/temp/export-data`, the user's projects were not written)

Script: `.claude/temp/real-export.mts` (`npx tsx`). Output in `.claude/temp/export-data/projects/<slug>/export/`.

| Project | Lang | Mode | Size | Pictures |
| --- | --- | --- | --- | --- |
| the-clockless-god-2 | en | gamebook (16 sections) | 1886 KB | 17 |
| the-clockless-god-2 | hr | not exported: the project has no hr edition | | |
| the-snail-and-the-salad | en | picture-book (12 pages) | 1088 KB | 13 |
| the-snail-and-the-salad | hr | picture-book | 1090 KB | 13 |
| the-salt-line-2 | en | linear (9 chapters) | 626 KB | 10 |

Warnings: clockless-god: sprites not exported (18 characters, 219 cast beats), longest section 1841 words (section 13, chapter 6). Snail: 12 cast beats dropped, voice clips not exported, longest page 22 (en) / 20 (hr) words. Salt line: sprites (22 characters, 89 cast beats), 21 CG/insert cues dropped, sound cues not exported (22 sfx, 66 ambience), longest section 2511 words (chapter 4). The hr cover (Puž i salata) was looked at: diacritics render.

## Deviations

- The hr gamebook export was not made: the real choice project has only an `en` edition (the hr wording of the links is covered by the test and by the snail picture book).
- epubcheck is not available (Java 21 is installed, no epubcheck jar or command; nothing was downloaded). Structure is checked only by the test.
- The earlier duplicate run left `startLabel` in `phrases.ts` and an inline epub branch in `tools-export.ts`; the tool now uses `writeEpubFile`. `epub.ts` uses a nav landmark "bodymatter" pointing at the first section.
- Picture-book and linear sections use a 3-digit file number (`page-002.xhtml`, `chapter-004.xhtml`); the gamebook uses `section-056.xhtml`, as in the plan.

## Results (2026-11-02)

- `yarn typecheck`: clean. `yarn lint`: one error, the known `scripts/shot-game.mjs:111` no-empty (not touched); no finding in a file of this ticket. `yarn test`: 85 files, 1139 tests passed (2 new in `tests/export-epub.test.ts`).
- DONE: EPUB writer, images, tool wiring, probe, tests, docs, ROADMAP, real exports of a choice, a picture-book and a linear copy.
- NOT DONE: hr gamebook of the real choice project (no hr edition); epubcheck (not available).
- UNTESTED: opening any EPUB in a reader or on the Kindle (links, pictures on e-ink), the tool through a running MCP server (the file writer was called directly), anything in the real app.
