# VNO-08 changelog

## 2026-10-22: VNO-08, the hub roadmap fixes for VN Studio

Branch `VNO-08_roadmap-fixes`, from master 414b743. Plan: `plan.md` in this folder. The per-phase notes there list every file and deviation.

### Commits (in phase order 1, 4, 2, 3, 5, 6, 7)

| Phase | Commit | What |
|---|---|---|
| 1 | 7b626db | Client task shape, client seed and migration, model warnings, studio tokens |
| 4 | 385dfc9 | UI strings for all built-in languages, per-language fonts, RTL layout |
| 2 | 5935d85 | Scheduler: client jobs free agents, no-op jobs skip the slot, priority, queue drop, sheet-first regen, restyle |
| 3 | bea24a5 | Transliterated slugs and keys, cast and alias detection at import, analysis keeps existing art |
| 5 | c472197 | Asset and voice import with post-processing, landscape cover, grid draw mode |
| 6 | 18cb3ac | CG and insert images, SFX and ambience, scene music, expression sets |
| 7 | 1127143 | Docs, hand-mode CG test and final verification |

### What changed, by roadmap item

- **X1, prompt sent twice:** `vno_get_task` (`src/engine/mcp/tools-client.ts`) sends every text once.
  - `turns: single` returns `system` + `user`.
  - `turns: multi` (a repair round, the draw loop) returns `system` + `messages`.
- **X2 and X3, seed and migration:**
  - The seed's client model has `context: 200000`.
  - `store/seedMigrations.ts` adds missing seed entries to data folders the user has edited, once, without touching their edits.
- **V12, project models:**
  - The real cause was a missing DeepSeek key in VN Studio's credential store. The engine now reads the keys Scriptorium and Book Translator have saved too (`models/keys.ts`; turn that off with `VNO_SHARED_KEYS=0`).
  - `router.whyUnusable` writes a warning, and a line in the job log, when a project model is skipped.
- **V5, studio tokens:** bearer tokens are sent to Pixel Studio and Chiptune Studio.
- **V0, languages:**
  - UI strings for 36 languages.
  - A font per language: `font`/`fontBold` in `config/languages.md`, `<data>/fonts/<script>.*`, else an installed system font (with a licence warning), else DejaVu.
  - `vno_fonts_fetch` downloads a Noto font. All 5 URLs were checked.
  - Right-to-left layout through `vno_rtl.rpy`.
- **V6, V18, V10, V11, scheduler:**
  - A job parked for the client no longer holds an agent.
  - Jobs that need no model skip the model slot.
  - Jobs have a priority.
  - `vno_stop_now {drop}` and `vno_clear_queue`.
  - A regenerated sheet runs before its sprites, and its sprites are marked stale.
  - `restylePrompts` applies an `art.stylePrompt` change to jobs already in the queue.
- **V4, non-Latin titles:** slugs are transliterated to ASCII. Han and Thai titles get a short hash.
- **V7, cast:** a character who is only named is not put on screen, and casts are checked against who is in the scene.
- **V8, aliases:** aliases are found at import and merged, and there is an `aliases` field.
- **V17, existing art:** the analysis is told which times and expressions already have art.
- **V2, outside files:** `vno_asset_import` brings in an outside image with background removal, trim and scale. `vno_voice_import` brings in a voice clip, and later voice generation keeps it.
- **V9 and V15, cover:** new covers are planned landscape. A portrait cover is composed into the menu image, not cropped.
- **V13, client drawing:** Pixel Studio drawing has `auto|loop|grid` modes. `grid` draws in one call, so it works with the client provider with no time limit per turn.
- **V1, asset kinds:**
  - Expression sets, per book and per character.
  - `cg_` and insert images.
  - `sfx_` and `amb_` sounds. Ambience uses the music engine. A sound effect needs an imported file unless `sound.sfxEngine` is set.
  - Scene music.
  - Cue fields on beats and scenes, with story ops and tools `vno_image_set/remove` and `vno_sound_set/remove`.
  - Ren'Py output: `show cg`, `play sound`, `play ambience`, and a new `vno_media.rpy` file.
  - New groups in the UI gallery.
- **V3, V14, V16:** checked only, with no code change. V14 (art without ComfyUI) and V16 (lossless WebP) were already fixed by VNO-07. V3 needs a rebuild and restart after the merge.

### Deviations

- Cue fields and the `images` and `sounds` catalogues are optional rather than defaulting to `[]`.
- Stored data uses `null` to hide or silence something. Edit ops also accept the string `"none"`.
- The media integration book is built inline, not from a fixture file.
- The script-analyst prompt does not choose an expression set. It uses the book's set.
- Phase 6 has fewer unit tests than planned. Story ops and Ren'Py output are covered by `tests/vn-media-cues.test.ts` and a Ren'Py integration case. The hand-mode test does not cover `key` background removal.
- Three vn test files got longer timeouts (phase notes in the plan).
- The commits for phases 6 and 7 end with a "Claude Sonnet 5.5" co-author line, the others with "Claude Opus 5.5".

### Verification

- `yarn test`: 56 files and 717 tests pass. The baseline was 568. The orchestrator re-ran it twice, and both runs were green.
- `tests/renpy-integration.test.ts`: all 9 cases ran against the real Ren'Py 8.5.3 SDK, and `renpy lint` was clean.
- `yarn typecheck` and `yarn lint`: clean.
- Not run:
  - `yarn build:engine` and `yarn build`. The hub runs from `out/`, so this waits until after the merge.
  - The live engine on port 7459.
  - A real game played with CGs, SFX or a CJK edition.

### Follow-ups

- **After the merge:** run `hub.ps1 build vn-studio`, then `hub.ps1 stop vn-studio` and `hub.ps1 start vn-studio`, then reconnect `/mcp`.
- **Scriptorium:** teach the VN script prompts the new lines (`CG:`, `INSERT:`, `SFX:`, `AMBIENCE:`), an `Aliases:` sentence in the bible, and not to use `ON SCREEN:` for props.
- **Pending your check:** native-speaker review of the model-written UI strings.

Pushed to `origin/VNO-08_roadmap-fixes`, not merged.
