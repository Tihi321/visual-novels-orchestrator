# VNO-46 notes

Contract: `C:\projects\Personal\creative-hub\.claude\tickets\HUB-16-vn-pack\contract.md` (revised 2026-10-25; authoritative,
not edited). This file records the readings, the fixture coverage and the differences the canonical fixtures exposed.

## Pack reader

- `vn/pack.json` and `vn/text/<lang>.json` are validated with zod; `packHash` uses canonical JSON (recursively sorted
  object keys, array order, no whitespace, UTF-8) with `packHash` removed.
- A pack hash mismatch is a warning on import (the pack was edited after hashing); a catalogue whose `packHash` differs
  from the project pack is rejected at edition add. `sourceHash` covers the authored script files in contract order
  (`outline.md`, `bible/bible.md`, `bible/puzzles.md`, `cover-brief.md`, `chapters/*.md` by first number) and **excludes
  `book.md`** (revised §2), so publishing a cover does not make every pack stale. It is verified only when the authored
  files are next to the pack; a mismatch warns ("stale"), never silently used.
- IDs come from the template only: `backgroundId(placeKey, placeText, time)`, `cueKey(text)`/`slugKey(key)` for
  `cg_`/`sfx_`/`amb_`, scene/beat ids preserved exactly. No asset key is ever derived from a non-primary catalogue.
- **Place matching is VN Studio's**, because Scriptorium writes the SCENE text and may legitimately emit
  `placeKey: null` when it is not a bible name. When `placeKey` is null, the reader runs the same `matchPlace` rule as
  the legacy importer over the pack's places and `placeText`; the matched key is used in `VnScene.placeKey` and for the
  background id, so the live project's `bg_petra_s_house_*`, `bg_dragon_path_morning`, `bg_bubble_gum_volcano_any`,
  `bg_lost_things_office_any`, `bg_golden_cave_afternoon`, `bg_bouncing_mud_puddles_afternoon` and
  `bg_sky_over_dragon_land_afternoon` keep their 53 assets. If nothing matches, `placeKey` stays null and
  `backgroundId(null, placeText, time)` is used with a warning (the legacy behaviour).
- Real-project check: `tests/vn-pack-places.test.ts` reproduces all 15 `placeKey`/`backgroundId` pairs of the live
  `the-soother-that-fell-into-dragon-land/vn.json` (skipped on machines without it).
- `time` is passed through VNO's `detectTime` (`script.ts`) before the background id is made. Contract §4 says the pack
  carries a canonical time string, and this keeps a pack's `before dawn` on the same asset as the legacy importer's
  `dawn`; the canonical value is what `vn.json` stores, as it always did.
- `line` beats have no display label. `speakerLabel` comes from the primary catalogue's `characterNames[speakerKey]`; a
  line with `aliasKey` (`petra#1`) uses `characterNames[aliasKey]`, so `aliasIndex` still finds the alias reveal. An
  aliasKey that does not start with `<speakerKey>#` is a warning.
- Pack puzzles carry the core/logic only; `names`/`text` come from the primary catalogue for `VnBook` and from the
  target catalogue for the edition. `clueAt` beat references and character/place/image links are checked with warnings.
- Unknown cast/speaker/place keys synthesize `speaker_N`/`place_N` (with a warning), as the contract says; scene and
  beat ids are otherwise untouched.
- `VnBook.chapters[].summary` has no field in the contract/catalogue, so a pack import has no chapter summaries (legacy
  folder import keeps them). Recorded for the hub: if summaries are wanted in the game, the catalog needs a field.
- The catalogue's `blurb` is validated (single line, non-empty when present) but not stored: `Edition` has no blurb
  field and the scope only adds optional `sceneTitles`.
- `sceneTitles` is optional in `Edition`; when present its keys must be existing scene ids (unknown ids are errors). The
  build puts them in `CompiledEdition.sceneTitles` and the runtime shows them in a location pill above the textbox.

## Editions

- `vno_add_edition` recognises (a) a `*.json` catalogue file, and (b) a bundle folder with `edition.json` +
  `vn/text/<lang>.json` (the bundle's `vn/pack.json` is checked against the project hash and byte-compared when the
  source pack is known). Other sources keep the legacy folder alignment path and the edition-aligner.
- Pack catalogue validation is key-set based. Missing keys are rejected, extra/unknown keys are rejected. `force: true`
  (MCP option) allows missing keys only (the build falls back to the primary text for them); unknown keys are always
  rejected because no structural slot exists for them.
- No asset or voice job is queued by an edition add; the align report doubles as the pack edition report and carries
  `packHash`/`packVersion`/`keyCount`/`source` (extra optional fields on `AlignReport`/`AlignReportView`, ignored by old
  readers).
- `vno_sync_editions` (MCP) / `edition sync` (CLI) reads the project's source folder (or `source`) `vn/text/*.json` and
  adds every non-primary catalogue synchronously through the same validator; it is idempotent and returns
  `added`/`skipped`/`failed`.
- `ProjectStore.editionLangs` now accepts any `langSchema` code (3-letter, hyphenated) and ignores `.report`/other files.

## Hash helper

`canonicalJson`, `packHashOf`, `sourceHashOf` live in `src/engine/vn/pack.ts`. Scriptorium implements the same
canonicalisation; shared test vectors are covered by the fixture hash tests. Hash strings are `sha256:<hex>`.

## Fixtures

- `tests/fixtures/books/soother-pack/`: a complete authored book folder **and** its hand-written v2 pack + en catalogue.
  The parity test imports the same folder both ways. It exercises choices, endings, cast looks, CG/INSERT/SFX/AMBIENCE
  cues and sceneTitles.
- `tests/fixtures/packs/soother-pack-hr/`: the hand-written hr bundle for it.
- `tests/fixtures/books/canonical-{soother,choice,mystery-puzzle}/`: verbatim copies of the canonical hub fixtures
  (source book + `vn/pack.json` + `vn/text/en.json`) written by Scriptorium SCP-45.
- `tests/fixtures/packs/canonical-soother-hr/`: an hr bundle for the canonical soother (every catalogue value prefixed
  `HR `, exact key set, byte-identical pack copy) used to prove that a canonical catalogue adds with `missing: []`,
  `extra: []` and no asset change.

## Canonical fixture differences (for the Lead)

Parity over the canonical fixtures requires ignoring more than the two differences named in contract §4/§8.4. The
implementation follows the contract; these are Scriptorium/legacy-parser differences the hub may want to settle:

1. `scene.description`: expected — the pack's is richer (contract).
2. `speakerLabel`: expected — the pack has no display label (contract).
3. `chapter.summary`: the pack template has no summary field, so a pack import loses chapter summaries.
4. `line.expression`: when a line has no bracket, Scriptorium writes `neutral`, while the legacy importer inherits the
   previous expression of the same speaker in the scene. Example (canonical soother `ch01.s01.b004`): legacy `angry`,
   pack `neutral`. The derived asset *set* still matched on all three fixtures, but a beat can select a different
   sprite. Contract wording ("raw bracket word or neutral") supports the pack; flagging for SCP-45.
5. Unused cue: canonical choice `ch-04.md` has `CG:` + `END CG` with no beat after it. The legacy importer kept the
   image in `book.images` even though the cue was dropped; the pack has no descriptor, so pack import has no
   `cg_lighthouse_beam_over_returning` entry (derived asset sets still matched because no beat uses it). A cue with no
   beat has no home in the contract template.
6. Puzzle metadata: the pack carries `onFail`, `hints`, place `links` and `verified` from Scriptorium; the legacy parser
   has fewer place links and proves the core itself (`verified.by: import`, often `unique: false`). The game uses the
   pack values.
7. `time`: pack values such as `before dawn`/`midnight` are canonicalised with `detectTime` (dawn/night) before the
   background id, so asset ids match the legacy import.

## Verification

- Full suite: 78 files / 1071 tests green; typecheck (node + web) green; eslint green (commands in `plan.md`).
- Canonical hr bundle: `missing: []`, `extra: []`, keyCount 34, no asset version/file change, no generation job.
