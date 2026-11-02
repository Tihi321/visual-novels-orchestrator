# VNO-56: export panel in the Build tab

Branch `VNO-56_export-panel`, from master at 525e7b2 (VNO-52/53/54). VNO-55 is reserved for fixed-layout picture books.

## Goal
The book export (`vno_export_book`) had no UI. The Build tab gets an Export section.

## Design
- `src/engine/export/run.ts`: `runBookExport(store, slug, input)` is the one entry point (plan dry run, EPUB, PDF). The MCP tool and the new UI command both call it; no logic is duplicated.
- Protocol: command `exportBook {slug, format, lang?, order?, renumber?}`; event `export.result {slug, format, result?, error?}` (`ExportResultView`: mode, sections, pictures, warnings, stale, path, bytes). The section map is not sent.
- `VnService.handle` runs it and turns a thrown error (broken story, RTL edition, stale map on a file export) into `export.result.error`, shown inline.
- Store: `exports[slug]` keeps the last answer. `BuildTab.tsx` `ExportSection`: language select (editions, primary first), EPUB (Kindle) / PDF / Preview plan buttons, choice projects only: shuffled / chapter order select and Renumber checkbox; result with mode, counts, a stale pill, the written path, warnings and Open folder (`openFolder` on the folder of the written file, as for the game folder).

## Tests
One test, `tests/export-panel.test.ts`, at the command level in a temp data folder: dry run counts, an EPUB written, an error answered as `export.result.error`.

## Extras (second commit, "export panel extras")
1. Section map: `ExportResultView.sectionMap` (seed, order, chapter -> section) is sent and shown in a collapsible list, sorted by section, with chapter titles.
2. Grayscale: a checkbox; `exportBook.grayscale` goes to `runBookExport`.
3. Output file: the app has only open dialogs (`pickFolder`, `pickFile`), no save dialog, so a "Save as" path field (absolute path; empty = default `export/`); `exportBook.out`.
4. Progress: `PdfOptions.onProgress` after each section; the service emits `export.progress` (throttled to 150 ms), the store keeps `exportProgress[slug]`, the pending pill shows `done/total`. PDF only (EPUB is not sectioned that way).
5. "Renumber and export": shown under a stale-map error of a file export; runs the same format again with `renumber: true`.
6. Persistence: a written epub/pdf result is saved to `projects/<slug>/export-last.json`; `ProjectDetail.lastExport` shows it after a restart until a new answer arrives. Plan results are not kept.
Test: two assertions added to `tests/export-panel.test.ts` (section map in the plan, `lastExport` after the EPUB).

## Not done
Not run in the real app (no screenshot of the panel); the grayscale, Save as and progress paths have no test of their own.
