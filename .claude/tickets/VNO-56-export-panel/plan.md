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

## Not done
Not run in the real app (no screenshot of the panel).
