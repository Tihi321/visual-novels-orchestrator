# VNO-59 export follow-ups (to VNO-58)

Scope (VN Studio only), three small items:
1. The dry run (and the file paths) report `unpairedIds?: string[]` (first 50 of `book.pairing.unpaired`) next to `unpaired`, only with lang2. `ExportRunResult`, `ExportResultView`, MCP passes through. The Export panel's `export-pairing` row shows the first 5 ids. Extend the existing assertion in `tests/export-panel.test.ts`; no new test. Update `docs/mcp-guide.md` and the `tools-export.ts` Returns sentence.
2. Flaky `tests/vn-pipeline.test.ts` "one job per asset, ..." (timed out at 15000 ms under full-suite load): find the cause, make it lighter or give that one test a longer timeout.
3. EPUB picture-book caption translation (`p.caption.tr`) is upright (`font-style: normal`); PDF unchanged. Update D5 note and the mcp-guide bilingual bullet.

Done when: typecheck, lint and the full test suite pass twice in a row; nothing committed.
