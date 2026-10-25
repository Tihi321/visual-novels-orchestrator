# VNO-46 — VN Studio: language-independent VN book packs

Repo: `C:\projects\Personal\visual-novels-orchestrator`, branch `VNO-46_vn-pack` (already checked out; never switched).
Source plan: `C:\projects\Personal\creative-hub\.claude\tickets\HUB-16-vn-pack\plan.md` (`VN Studio — VNO-46`), contract
`C:\projects\Personal\creative-hub\.claude\tickets\HUB-16-vn-pack\contract.md` (authoritative, revised 2026-10-25; not edited).

## Scope checklist

- [x] `src/engine/vn/pack.ts`: validate `vn/pack.json` (format/version/packHash/sourceHash) and `vn/text/<primary>.json`
      (format/vn-text/version/lang/packHash/key set); build `VnBook` + primary `Edition` per contract.
      Derive `backgroundId` and `cg_`/`sfx_`/`amb_` keys with existing `ids.ts`/`script.ts` rules from the untranslated
      template only (including the legacy time canonicalization, so background ids match). When Scriptorium writes
      `placeKey: null` for a SCENE text that is not a bible name, resolve it with `matchPlace` (VN Studio's rule) so the
      live project's background ids are reused; no match keeps `null` + the text-based id and warns. Build
      `images`/`sounds` catalogues. Preserve scene/beat ids. Warnings for stale hashes, missing/extra keys, unknown
      refs, synthetic speakers/places. Never derive structure/assets from translated text. `sourceHash` excludes
      `book.md` (revised contract §2); `aliasKey` on a line sets the name tag from the catalogue (revised §4).
- [x] Import: `VnService.importProject` and `previewImport` detect `vn/pack.json`, use the pack reader; legacy
      reader/import untouched. Re-import keeps settings, other editions and assets.
- [x] Optional `packHash`/`packVersion`/`sourceHash`/`packDir` in `ProjectSettings` (backward compatible).
- [x] Editions: `vno_add_edition` accepts a catalog JSON file or a bundle folder (`edition.json` + `vn/text/<lang>.json`);
      validate `lang != primary`, `packHash` match, every key against the book (beats, chapterTitles, choiceTexts,
      endings, characterNames incl. `key#n`, sceneTitles, puzzle ids); save `editions/<lang>.json` + report; no
      `alignEdition`, no `edition-aligner` job, no asset/voice job. Key mismatch rejected by default; `force` may allow
      missing keys only (unknown keys always rejected).
- [x] `vno_sync_editions {slug, source?}` scans `vn/text/*.json` and adds every non-primary catalogue. Also on the CLI
      (`edition sync`).
- [x] Legacy folder alignment path unchanged.
- [x] Primary consistency: primary edition written from the same catalogue; lint checks that `vn.json` primary text and
      `editions/<primary>.json` agree; stale pack editions are reported by build and fail lint.
- [x] `ProjectStore.editionLangs` accepts `langSchema` codes (3-letter / hyphenated) and ignores report files.
- [x] Asset reuse regression: `assets.json` ids/versions/files unchanged after `vno_add_edition`; no generation queued;
      no prompt from catalogue text. Re-import keeps ids/versions/files and queues no job.
- [x] UI: `Clues`, `Accuse`, `Submit`, `Hint`, `Give Up` in Croatian `ui-strings.ts`; explicit English fallbacks in
      `player-runtime.ts`; 37-language / 49-core-key tests green. Optional `sceneTitles` in
      `Edition`/`CompiledEdition`/game-data; the runtime's scene title pill uses
      `edition.sceneTitles[scene.id] ?? scene.title`.
- [x] Full en<->hr switch test (menu, dialogue, names/aliases, history, choices, ending, puzzle text, scene titles) and
      identical image/audio path sets.
- [x] Voice: edition languages in the build voice source and in planning/generation (not only `voice.langs`); voices are
      per language, art/music/sfx shared.
- [x] `vno_puzzle_check_text` `lang` edition read-back (it already had `lang`; pack editions now carry the puzzle words,
      and the core stays language-free). Tested.
- [x] MCP `INSTRUCTIONS` ("Ren'Py" -> web engine), `docs/mcp-guide.md`, `docs/protocol.md`, `README.md`.
- [x] Tests: `tests/vn-pack-import.test.ts` (hand-written `tests/fixtures/books/soother-pack`), plus the canonical hub
      fixtures copied to `tests/fixtures/books/canonical-{soother,choice,mystery-puzzle}` and
      `tests/fixtures/packs/canonical-soother-hr` in `tests/vn-pack-canonical.test.ts`; `tests/vn-pack-editions.test.ts`
      (project integration/build/lint/stale/voice); `tests/vn-pack-tools.test.ts` (MCP/docs/Croatian strings/puzzle
      words). Pack-vs-legacy parity and asset ids on all fixtures; template hash identity; edition mapping/rejections;
      assets unchanged; en+hr build/UI/scene titles; legacy align tests still pass.
- [x] `yarn test`, `yarn typecheck`, `yarn lint` (run as the equivalent Node binaries; `yarn` is not on PATH in this
      session): see the verification log.

## Verification log

- `node node_modules/vitest/vitest.mjs run` — 78 files, 1071 tests passed (including the 5 new pack test files, one of
  which also checks the live soother project when it is on this machine).
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json` — passed.
- `node node_modules/eslint/bin/eslint.js .` — passed.
- Canonical fixture parity (`tests/vn-pack-canonical.test.ts`): deep equal after the contract's documented differences
  (`scene.description`, synthesized `speakerLabel`, plus the Scriptorium-vs-legacy differences recorded in `notes.md`);
  derived asset ids identical for soother, choice and mystery-puzzle.
- Canonical hr bundle added: `missing: []`, `extra: []`, keyCount 34, asset ids/versions/files unchanged.
- Scriptorium fixtures were not compiled by this branch; the hub copies in `.claude/temp/hub16-fixtures` were used
  verbatim.
- Place regression (`tests/vn-pack-places.test.ts`): all eight live SCENE texts resolve through `matchPlace` to the
  live place keys and background ids (`bg_petra_s_house_morning`, `bg_dragon_path_morning`, `bg_bubble_gum_volcano_any`,
  `bg_lost_things_office_any`, `bg_golden_cave_afternoon`, `bg_bouncing_mud_puddles_afternoon`,
  `bg_sky_over_dragon_land_afternoon`); the live project's 15 scenes reproduce their existing `placeKey`/`backgroundId`
  with 0 mismatches.
