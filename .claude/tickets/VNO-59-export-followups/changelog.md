# VNO-59 changelog (uncommitted, not merged)

- `src/engine/export/run.ts`, `src/shared/protocol.ts`: `unpairedIds?` (first 50) next to `unpaired`, set only with lang2, on the plan and file paths. MCP passes it through (`runBookExport`).
- `src/renderer/ui/book/BuildTab.tsx`: the `export-pairing` row appends the first 5 ids when `unpaired > 0` ("without translation 3: id, id, id").
- `tests/export-panel.test.ts`: the existing assertion also checks `unpairedIds`.
- `docs/mcp-guide.md`, `src/engine/mcp/tools-export.ts`: return shape and bilingual bullet.
- `src/engine/export/epub.ts`: `p.caption.tr { font-style: normal; }` (EPUB picture book only). This amends VNO-58 D5: the main caption stays italic, its translation is upright + smaller + grey.
- Flaky test: the test generates every asset of the book with real `sharp` images (about 4 s alone), so under full-suite CPU load it could pass the 15 s default. `tests/vn-pipeline.test.ts`: that one test gets a 30 s timeout. `tests/vn-helpers.ts` `waitIdle` polls every 25 ms instead of 300 ms (it only ever used the first sleep of the engine's wait). Real work dominates, so no larger fixture change.
- Not run: the Export panel in the real app, a Kindle.
