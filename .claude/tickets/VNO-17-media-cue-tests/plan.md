# VNO-17: Unit tests for media cues and expression sets

Part of `.claude/tickets/VNO-17-18-roadmap-tasks/plan.md` (task 1). Branch `VNO-17-18_roadmap-tasks`.

## Why

VNO-08 phase 6 (CG and insert images, SFX, ambience, scene music, expression sets) shipped with fewer unit tests than its plan listed. Story ops and Ren'Py output are covered only by `tests/vn-media-cues.test.ts` (5 cases on one beat) and one Ren'Py integration case. ROADMAP "Tests", first item.

## What

Tests only, in the files the VNO-08 plan named (`.claude/tickets/VNO-08-roadmap-fixes/plan.md`, "Phase 6 / Tests"):

1. **`tests/vn-story.test.ts`.** A story with `images`, `sounds`, beat cues, scene music and ambience, and a character expression (`smug` for Old Tom) builds. Refused: an unknown image, sfx or ambience key, sfx and ambience keys of the wrong kind, music that is not a track id, a cue-only beat, an expression outside the set, a book set without `neutral`. `image.remove` / `sound.remove` refuse a used entry and with `force` clear the cues. `image.set`, `sound.set`, `book.update {expressions}` and `character.set {expressions: null}` work.
2. **`tests/vn-import.test.ts`.** `CG:`, `INSERT:`, `SFX:`, `AMBIENCE:` become catalogue entries and cues on the next beat, not speakers. `CG: none`, `END CG`, `AMBIENCE: none`, the Croatian `SLIKA:` / `ZVUK:`, one entry for a reused description. A trailing cue is dropped with a warning.
3. **`tests/assets-derive-manifest.test.ts`.** `cg_` with the sheets of its characters as refs and the edit engine; an insert without characters on the generator, square; `sfx_` / `amb_` stubs (custom sfx engine kept); a `smug` sprite; an unused entry derives nothing. The fallback prompts of a full CG (looks, place, full-bleed), an insert and an ambience.
4. **`tests/assets-generate.test.ts`.** A CG with refs calls the edit engine with the sheet files and is fitted to the screen; an insert is asked square and kept at its size; a CG whose sheets have no file fails without ComfyUI; an sfx with no engine is skipped with the reason, and a `custom:` engine makes it; an ambience calls the audio engine for 60 s.
5. **`tests/renpy-emit.test.ts`.** New snapshots `media-ch01.rpy` and `media-ch02.rpy` (`show cg ... as vn_cg`, `at vn_insert`, `hide vn_cg`, `play sound`, `play` / `stop ambience`, scene music and silence). A new `scene` clears the picture, so a later hide is not emitted. Cues win over the story's fields.
6. **`tests/renpy-stage.test.ts`.** Cue precedence: the stage-director's sfx and ambience come from the catalogue only and never replace the story's cue; a new transition keeps scene music and ambience; the composer's scene music never overrides the story's or a cue set by hand, and skips unknown tracks.
7. **`tests/vn-plan-tools.test.ts`.** `vno_set_cues` scene music and ambience: errors, round trip, kept by a transition change and by the stage step, null clears. `vno_set_music {scenes}`: errors, round trip, reaches the cues through the stage step once the track has a file, `''` drops an entry.

Shared fixture: `mediaBook()` in `tests/assets-fixtures.ts`.

Not repeated: the Ren'Py lint of a media book (`tests/renpy-integration.test.ts` has it) and hand mode refusing a CG (`tests/vn-hand-art.test.ts`).

## Acceptance

All new tests pass with no source change, or a found bug is fixed and named in the changelog. `yarn test`, `yarn typecheck`, `yarn lint` exit 0. Old snapshots unchanged.
