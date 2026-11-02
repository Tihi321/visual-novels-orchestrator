# VNO-54 plan: PDF export (A5, pdfkit, Lora)

From hub HUB-25 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-25-book-export-kindle-pdf\plan.md`, approved 2026-11-01). Branch `VNO-54_pdf-export`, uncommitted, stacked on `VNO-53_epub-export` and `VNO-52_export-model` (also uncommitted). Nothing here spends money, calls a model or starts a service.

## Task block (copied from the hub plan)

### VNO-54 PDF export (spike first)
- Step 0, spike: pdfkit vs pdf-lib (+ `@pdf-lib/fontkit`) with an embedded OFL TTF; Croatian string and one internal link, checked in PdfCraft. Decision rule: (a) diacritics intact, (b) internal link annotations to a page/named destination, (c) headless in plain node. Electron `printToPDF` rejected up front.
- NEW `src/engine/export/pdf.ts` (same `ExportBook`, no second reading of `vn.json`): A5 page, one section per page (gamebook) or one page per picture (picture book/linear), big section number at the top, picture, "turn to section 56" with a link to that section's page; footer with the section number (the text says "section", never "page"); outline: only "Start: section 1" (no spoilers); document title/language metadata.
- Wire `format: 'pdf'`; add the library to `package.json`; bundle/licence note for the font in `docs/`.
- Tests: NEW `tests/export-pdf.test.ts` (hub plan test 4).
- Done: spike recorded; tests pass; PdfCraft opens a real exported PDF, `link_list` shows a link per choice, `text_extract` shows Croatian intact; the user opens it (live check step 3).
- User answers: Croatian jump text "idi na odlomak N"; colour JPEG; no cover asset: first scene's background with the title over it; the section picture is the chapter's first scene.

## Spike record (step 0, done by the orchestrator 2026-11-02)

# VNO-54 PDF spike result (2026-11-02)

Script: visual-novels-orchestrator/.claude/temp/pdf-spike/spike.mjs (throwaway). Font: themes/parchment/fonts/Lora-Regular.ttf (SIL OFL, already in the VN Studio repo; OFL.txt next to it).
Libraries: pdfkit 0.20.2, pdf-lib 1.17.1 + @pdf-lib/fontkit. Plain node, headless: both run.

PdfCraft (doc_open / text_extract / link_list / bookmark_list):
- pdfkit: text_extract "Čovjek šapće: žaba, đak, ćevap, ŠĐŽČĆ" intact on both pages; link_list: link on "idi na odlomak 2" -> named destination, to_page 2. Outline "Start: section 1" present.
  Gotcha: with `continued: true`, the goTo option leaks to the next fragment ("." became a second link) -> pass `goTo: null`/end the link explicitly on the fragment after it. outline.addItem targets the CURRENT page -> add it while on section 1's page.
- pdf-lib: text intact; manual Link annotation with Dest [page XYZ] -> to_page 2.

Choice: **pdfkit**. Both pass (a) diacritics, (b) internal links, (c) headless node. pdfkit wins on what the writer needs beyond the spike: automatic line wrapping and page flow (a section can be 1841 words, several pages), named destinations via `goTo`/`addNamedDestination`, built-in outline, JPEG embedding, font subsetting, document Title/Lang metadata. pdf-lib would need hand-written wrapping, pagination and annotation dictionaries. pdfkit has no re-parse: tests check raw bytes (compress:false: /Link annots with /Dest names, embedded FontFile2, ToUnicode CMap containing the Croatian code points), or use pdf-lib as a devDependency only for re-parse.

## Checklist

- [x] `pdfkit` ^0.20.2 and dev `@types/pdfkit` in `package.json` / `yarn.lock` (`yarn add`).
- [x] `src/engine/export/pdf.ts`: `buildPdf(book: ExportBook, { grayscale?, fontDir?, compress? }) -> { bytes, sizeBytes, pages, pictures, warnings }`; `writePdfFile(store, slug, opts) -> { path, bytes, pages, pictures, book, map?, warnings }` (persists the numbering, refuses a stale map, warns above 40 MB); `pdfFontDir(env?)`, `PDF_WARN_BYTES`.
- [x] Font resolution: `pdfFontDir()` = `findAppDirs().themes/parchment/fonts` (so `VNO_THEMES` first, which the packaged app sets to `resources/themes`; else walking up from the code to the repo's `themes/`); a clear error naming the folder when Lora-Regular.ttf / Lora-Bold.ttf are missing. Packaging needs no change (`themes` is already an `extraResources`/file entry in `electron-builder.config.cjs`).
- [x] `src/engine/mcp/tools-export.ts`: `format: 'pdf'` via `writePdfFile`, same result shape as the EPUB (`path`, `bytes`, `sections`, `pictures`, `warnings`, `sectionMap`).
- [x] `tests/export-pdf.test.ts`: 1 test (plan test 4).
- [x] `docs/mcp-guide.md` "Export a book": PDF paragraph and the font/licence note (Lora, SIL OFL, `themes/parchment/fonts/OFL.txt`); ROADMAP row.

## Layout

A5 (419.53 x 595.28 pt), margins 42/42/48/56. Page 1: the cover JPEG (`toCoverJpeg`, title over the first scene's background) fitted to the page, or a title page. Then one page start per section/page-entry, named destination `s<no>` at its top. Gamebook: number 46 pt bold centred, picture fitted to width (max 210 pt high), text 11.5 pt Lora, choices `{before}{label}{after}` with only the label underlined and linked (`goTo: s<N>`, ended by `goTo: null` on the next fragment), ending: story text, "The End." bold, restart link to s1. Footer "section N" / "odlomak N" (gamebook) or the number (others), none on the cover. Outline: gamebook only "Start: section 1" (added while on section 1's page); linear and picture book: chapter titles. Picture book: picture (max 300 pt high) with the caption centred below. Linear: chapter title, picture, text.

## Real exports (copies under `.claude/temp/export-data`, the user's projects were not written)

Script: `.claude/temp/real-pdf.mts` (`npx tsx`). Copies of the clockless-god and snail PDFs are also in `C:\Users\Infplane\AppData\Local\Temp\hub25-spike\`.

| Project | Lang | Mode | Size | Pages | Pictures |
| --- | --- | --- | --- | --- | --- |
| the-clockless-god-2 | en | gamebook (16 sections) | 2,079,545 B (2031 KB) | 120 | 17 |
| the-snail-and-the-salad | hr | picture-book (12 pages) | 1,130,617 B (1104 KB) | 13 | 13 |
| the-salt-line-2 | en | linear (9 chapters) | 744 KB | 91 | 10 |

V1 (same numbers for EPUB and PDF): `the-clockless-god-2/export.json` was not changed by the PDF export (compared byte for byte before and after; the warning "section numbers reused from export.json" appeared); the PDF's 16 destinations `s1..s16` are the values of that map (a bijection onto 1..16), the same file the VNO-53 EPUB was written from; 21 link annotations in the clockless PDF.

## Deviations

- Footer in a gamebook reads "section N" / "odlomak N" (word plus number), where Scriptorium's twin prints the bare number; the orchestrator asked for the word.
- No re-parse library: the test reads raw bytes (`compress: false`), as the spike advised.
- The visual look of the PDFs was not opened by the session in a viewer (see UNTESTED).

## Results (2026-11-02)

- `yarn typecheck`: clean. `yarn lint`: one error, the known `scripts/shot-game.mjs:111` no-empty (not touched); nothing in a file of this ticket. `yarn test`: 86 files, 1140 tests passed (1 new in `tests/export-pdf.test.ts`).
- DONE: spike record, pdfkit writer, font resolution, tool wiring, test, docs, ROADMAP, real PDFs of a choice, a picture-book and a linear copy, V1 check.
- NOT DONE: nothing assigned.
- UNTESTED: opening the PDFs in a reader app or PdfCraft by the session (handed to the orchestrator), the user reading it, the tool through a running MCP server (the file writer was called directly), the packaged app finding the font (relies on `VNO_THEMES` set by main, as for themes).

## Orchestrator corrections (2026-11-02, after a PdfCraft check of the real PDFs)

- Footers were off by one page: pdfkit opens page 1 (the cover) in its constructor, before the `pageAdded` listener exists, so every page carried the previous page's footer (the cover showed "section 1"). Fixed: `footers` starts as `['']`.
- A centred line with `continued` fragments overprints in pdfkit ("Turnse tcot ion 1 to start again."). Fixed in `jump`: a centred one-line jump is placed by hand (x from `widthOfString`), the link stays on the label only.
- Re-checked in PdfCraft: clockless-god-2 en (120 pages, 21 links, bookmark "Start: section 1", cover without footer, restart text clean), snail hr (13 pages, footers 1..12, cover without footer, Croatian text intact). Full suite: 86 files / 1140 tests pass (two earlier full runs each had one unrelated 15 s timeout, `vn-pipeline` and `puzzles`, both pass alone and on the third run).
