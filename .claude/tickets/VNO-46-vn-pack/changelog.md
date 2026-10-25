# VNO-46 changelog — VN pack import and editions

## 2026-10-25 — VN Studio imports packs and adds editions by ID

Branch `VNO-46_vn-pack` (from `master`), uncommitted. Cross-repo plan/contract: `C:\projects\Personal\creative-hub\.claude\tickets\HUB-16-vn-pack\`.

### What changed

- **New `src/engine/vn/pack.ts`**: validates `vn/pack.json` + `vn/text/<primaryLang>.json` (format/version/lang/`packHash`/`sourceHash`, key sets, values, aliases), builds `VnBook` + primary `Edition`; derives `backgroundId`/`cueKey` asset IDs from the template (never catalog text); `matchPlace` fallback for `placeKey: null`; `aliasKey` name tags; `links`/`onFail`/`hints`/`verified` passthrough; synthetic-reference warnings; `sourceHash` excludes `book.md`.
- **Service** `src/engine/vn/service.ts`: pack detection in preview/import; `packHash`/`packVersion`/`sourceHash`/`packDir` in settings; `importPackEdition` (catalog JSON or bundle; no aligner/model/asset job); `syncEditions`; stale-edition reporting; edition-source resolver; edition job branch.
- **`vno_add_edition`** accepts a catalog file or bundle and validates every key; `force` allows missing keys only; `vno_sync_editions` scans `vn/text/*.json`. **`vno_import`** reads the pack directly (no markdown re-parse).
- **Build/lint** `src/engine/vn/handlers.ts`, `game/tl.ts`: primary-edition consistency and stale-pack checks; `sceneTitles` flow through `Edition` → compiled editions → runtime; edition languages included in the build voice source.
- **UI** `src/shared/ui-strings.ts`: Croatian `Clues`/`Accuse`/`Submit`/`Hint`/`Give Up`; `player-runtime.ts` English fallbacks and scene-title pill.
- **`src/engine/vn/project.ts`**: `editionLangs` accepts any `langSchema` code (3-letter/hyphenated).
- **Voice** `src/engine/voice/catalog.ts`: edition languages included in planning/generation; docs state voices are per language, art/music/SFX shared.
- **MCP/server/docs** README, `docs/mcp-guide.md`, `docs/protocol.md`, `src/engine/mcp/server.ts` instructions (HTML5 web engine, packs).
- **Tests** `tests/vn-pack-{import,editions,canonical,places,tools}.test.ts`; canonical fixtures `tests/fixtures/books/canonical-*`, hand-written `soother-pack`, bundles `tests/fixtures/packs/*`; `tests/renpy-template.test.ts`/`voice-vibetts-jobs.test.ts` updated. `tests/vn-align.test.ts` and legacy folder alignment stay green.

### Verification

- `vitest run` → 78 files / 1071 tests (final idle rerun; one scheduler concurrency test flaked once under load and passed on the rerun).
- `tsc --noEmit` node + web; `eslint .` — clean.
- Canonical fixtures: pack vs legacy `VnBook` parity after the documented description/speakerLabel differences; identical derived asset IDs; canonical hr catalog `missing []`, `extra []`, no asset change.
- Live soother: import 7 chapters/15 scenes/9 characters/8 places, no warnings; all 15 scenes reproduce the existing `backgroundId`s; hr edition `matched 381, missing [], extra []`, keyCount 424; assets 53 → 53 IDs/versions/files; build `ok` no placeholders; lint `ok` 381 English + 381 Croatian blocks; `game-data` en+hr with 15 scene titles, `Skip: Preskoči`, `Clues: Tragovi`, 10 backgrounds present.

### Deviations

- The live project's old `editions/hr.json` was empty; the Croatian catalog came from the Croatian EPUB Book Translator produced earlier, not a fresh BT run.
- Two live scenes whose SCENE text changed since the old import were hand-patched in the pack (`dragon_path`, `singing_dragons_chorus`); the pack reader itself uses `matchPlace` for the rest.
- Chapter summaries are not in the pack template, so a pack import has none (accepted; not shown by the game).
- The scheduler flake is unrelated to the pack code; rerun on an idle machine before merge.

### Follow-ups

- Full live Croatian translation through Book Translator on a pack.
- Rerun the full suite idle; commit/PR after the user’s play.
