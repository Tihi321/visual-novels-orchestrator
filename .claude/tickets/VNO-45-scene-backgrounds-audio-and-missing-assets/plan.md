# VNO-45: Scene backgrounds & sound, audio regeneration, and finishing missing assets

## Goal

Fix the four visible gaps in VN Studio:

1. The **Scenes** stage preview shows only characters. It must show the scene's **background** (and the active CG/insert over it), matching what the build actually plays.
2. The Scenes tab must let the user **hear the scene**: the music, ambience and current-beat SFX that the build uses, with normal audio controls.
3. **Regenerate on an audio asset** (SFX/ambience/music) must offer audio engines, not image models, and produce audio. Opening an SFX/ambience in a studio must not offer Pixel Studio.
4. The **Pipeline** must show which assets still have no file and provide a one-click **Continue/Generate missing assets** path that actually finishes them, including SFX.

## Decisions and assumptions

- **Background truth**: the preview uses `scene.backgroundId` exactly as the game builder does (`emit.ts` / `imageName`), never the old `bg_<placeKey>` guess. This alone fixes `bg_track_to_combe_noire` vs `bg_track_to_combe_noire_afternoon`.
- **Scene sound truth**: the preview reads `cues.json` (stage cues) first, then the story fields, exactly like `src/engine/game/emit.ts`. The preview has manual play controls; it does not autoplay.
- **SFX generation**: with no `sound.sfxEngine`, an SFX is generated with the same audio path as ambience: Chiptune Studio for a pixel/music-provider project, else `sound.ambienceEngine` (ACE-Step by default). `sound.sfxEngine: "none"` preserves the old import-only behaviour. This is a deliberate behaviour change (VNO-19 previously required an explicit engine) because the user wants the pipeline to finish missing SFX.
- **No new pipeline step**: "finish missing assets" reuses `runPipeline { from: 'generate' }`, which already fans out only assets without files and tails into voice/stage/build/lint.
- **Locked/custom assets and voice references are never generated** by the pipeline; the UI reports them separately as files that need importing/uploading.
- Ticket/branch: `.claude/tickets/VNO-45-scene-backgrounds-audio-and-missing-assets/`, branch `VNO-45_scene-backgrounds-audio-and-missing-assets` from `master`. After approval, save this plan to `plan.md` before implementing.

## Public API / schema changes

### `src/shared/protocol.ts`

- Add `BeatCueView`:
  ```ts
  export interface BeatCueView { image?: string | null; sfx?: string; ambience?: string | null }
  ```
- Extend `SceneCuesView` with optional `music?: string | null`, `ambience?: string | null`, `beats?: Record<string, BeatCueView>`. `casts` stays required.
- Add `StageMusicView` and `ProjectDetail.stageMusic`:
  ```ts
  export interface StageMusicView { menu: string | null; chapters: Record<string, string | null> }
  // ProjectDetail
  stageMusic: StageMusicView
  ```
- No new command: the Pipeline button uses the existing `runPipeline` command.

### `src/shared/vn.ts`

- Add `export const SFX_IMPORT_ONLY = 'none'`.
- Add `resolveSfxEngine(settings)`:
  - `sound.sfxEngine === 'none'` → `SFX_IMPORT_ONLY`.
  - A set `sfxEngine` (including `custom:<workflow>` / `chiptune`) is used as-is.
  - Otherwise: `resolveMusicProvider(settings) === 'chiptune' ? CHIPTUNE_ENGINE : settings.sound.ambienceEngine`.
- Update the `sound` schema comment to describe the new default and `"none"`.

## Subsystem changes

### 1. Scene preview: background and CG overlay (`ScenesTab.tsx`, `stage-preview.ts`)

- `computeStageAtBeat(scene, casts, beatIdx, beatCues?)` gains an optional beat-cue map. For the picture cue, `beatCues[id].image !== undefined ? beatCues[id].image : beat.image`; it still resets per scene.
- `ScenesTab`:
  - `bgAssetId = scene.backgroundId` (fallback to nothing only when the field is empty); keep the `(no image yet)` label when the asset has no `fileRel`.
  - Render the CG as a separate overlay above the character slots:
    - `full` → inset 0, `object-fit: cover`.
    - `insert` → centred, max ~60% of the stage, `object-fit: contain`.
    - Missing CG asset → small "`cg_<key>` (no image yet)" label.
  - Keep the dialogue overlay at the bottom.

### 2. Scene audio preview (`service.ts`, `ScenesTab.tsx`, `stage-preview.ts`)

- `VnService.loadSceneCues` now carries scene `music` / `ambience` and per-beat cues into `SceneCuesView` (only fields actually present in `cues.json`; `null` is preserved as silence/stop).
- Add `VnService.loadStageMusic(slug)` returning `{ menu, chapters }` from the same cues file (chapter keys stringified). `detail()` includes it as `stageMusic`.
- Add a pure `resolveSceneAudio(book, cues, stageMusic, sceneId, beatIdx)` in `renderer/lib/stage-preview.ts`:
  - **Music**: scene cue (`null` = silence) → story `scene.music` → chapter cue; a scene with no music of its own falls back to the chapter track, and a chapter with no track leaves the previous track playing (mirroring `emit.ts`, which only stops on an explicit `null`).
  - **Ambience**: walk the book in order to the current beat: each scene cue/story value, then each beat cue/story value. Both audio channels keep playing across scene and chapter starts until an explicit `null` stops them, exactly as `emit.ts` does.
  - **SFX**: current beat's cue → beat `sfx` → null.
  - Normalise empty strings to null.
  - Return source labels (`cue` / `story` / `chapter`) for the UI.
- In `ScenesTab`, below the stage, add a **Scene audio** card with three rows:
  - Music: effective track id, source label, looping `<audio controls>`.
  - Ambience: effective key, source label, looping `<audio controls>`.
  - SFX (this beat): key, one-shot `<audio controls>` keyed by scene/beat.
  - Missing file → text explaining it needs generating or importing; no broken player. All players use `projectAssetUrl(slug, fileRel, rev)` and `preload="none"`.
  - Show the chapter default track in the Music dropdown label (`(chapter default: music_02)`) so the user can tell what will play.
- Test ids: `scene-bg-missing`, `scene-cg`, `scene-audio`, `scene-audio-music`, `scene-audio-ambience`, `scene-audio-sfx`.

### 3. Audio regeneration and SFX generation

- `renderer/lib/engines.ts`: treat `AUDIO_KINDS` (music, sfx, ambience) as audio, not just `music`; filter out TTS workflows for every audio kind; keep the current engine (including `chiptune` / `none`).
- `AssetsTab.RegenerateDialog`: initialise the engine to `asset.engine` when it is in the choices, else the first choice; label `none` as "None (import a file)". This prevents an empty select and makes an old `engine: ''` SFX default to a real audio engine.
- `engineFor('sfx')` returns `resolveSfxEngine(settings) || null`; `deriveAssets` uses the same resolver for SFX stubs, so reconciliation of existing projects updates unlocked, ungenerated SFX to the audio engine.
- `generateAsset` SFX branch:
  - If the entry engine is empty, fall back to `resolveSfxEngine(ctx.settings)`.
  - `chiptune` → existing `compose_sfx` path.
  - `custom:<workflow>` / any audio engine (ACE-Step, YuE2, MiniMax, custom) → `ctx.comfy.generate({ engine, prompt, seed, seconds: sizes.sfxSeconds ?? 5, format })`.
  - `none` / empty → skip with a clear reason (`SFX generation is off … import a file`).
- `roundtrip.studioFor`: music, sfx and ambience → `chiptune`; voiceRef still refuses; images → `pixel`.
- `AssetsTab` studio button: audio kinds show "Open in Chiptune Studio"; it is enabled only when the selected version has a `songFile`; images keep Pixel Studio.

### 4. Pipeline: missing assets and continuation

- Add `missingAssets(assets, { handArt })` to `renderer/lib/assets.ts`:
  - `all`: non-orphaned assets with no `fileRel`, excluding missing hand-mode sheets (matches `ProjectSummary.assets.missing`).
  - `generatable`: `all` minus voice references, locked/custom assets, hand-mode images, and SFX whose engine is `none`.
- `suggestedStart(rows, { missingAssets })`:
  - Failed/running/queued step still wins.
  - Keep the normal "step after the last done" result when it is `analyse`/`art`/`music`/`generate`.
  - If the normal result is after `generate` (voice/stage/build/lint), or the pipeline is fully done, and `missingAssets > 0`, return `generate`.
  - This makes the existing button read "Continue from generate" for the screenshot case, without skipping unrun planning steps.
- `PipelineTab`:
  - Read the project assets from the store; compute `missing` and `generatable`.
  - Add an `assets missing` pill in the status row.
  - Add a **Missing assets** card when `summary.assets.missing > 0`:
    - count, first ~24 ids with kind and locked/custom/none markers, "and N more";
    - note that locked/custom/voice-reference files are never generated by the pipeline;
    - **Generate missing (N)** button → `runPipeline { from: 'generate' }` (disabled while running; disabled when nothing is generatable).
  - Use `suggestedStart(rows, { missingAssets: generatableCount })` for the existing Continue button.
  - When the asset list has not arrived yet, fall back to the summary count.

## Edge cases and failure modes

- A scene with no/empty `backgroundId` shows the existing gradient and `(no background)`.
- Missing background/CG/music/ambience/SFX files never render broken media; they show a reason.
- Cue `null` is honoured as silence/stop; an omitted cue falls through to the story field, then chapter/default.
- Music falls back to the chapter track in a scene with no music of its own; a chapter with no track leaves the previous track playing. Ambience carries across scenes and chapters until an explicit stop, as `emit.ts` does.
- SFX `engine: ''` from old projects is recovered by the resolver; `engine: 'none'` stays import-only.
- Locked/custom assets, voice references and hand-made images are reported as missing but never queued; the button count reflects only generatable assets.
- Orphaned assets (e.g. old `bg_*_any` stubs) are excluded from the missing list and from generation.
- Regenerate still works when the engine inventory has not loaded; an empty engine falls back at generation time.
- No autoplay: the user presses play, so browser autoplay policy is irrelevant.

## Tests and verification

Update/add:

- `tests/ui-assets.test.ts`: `engineChoices('sfx' | 'ambience')` return audio engines/workflows and never image/TTS; `missingAssets` includes/excludes locked, custom, voiceRef, hand sheets/images, `sfx: none`, orphans; `studioFor` audio mapping.
- `tests/ui-pipeline.test.ts`: `suggestedStart` stays on music/art when missing assets exist, and switches to generate when the normal next step is after generate or the pipeline is done.
- New `tests/scene-preview-audio.test.ts`: cue image precedence/null in `computeStageAtBeat`; `resolveSceneAudio` music precedence/silence and chapter fallback, ambience inheritance/stop/carry across chapters, SFX cue/story.
- `tests/pipeline-stop-and-scenes.test.ts`: `detail()` exposes scene music/ambience/beat cues and `stageMusic` from a written `cues.json`.
- `tests/assets-generate.test.ts`: default SFX uses `ace-step-v1-instrumental` with `seconds: 5`; explicit custom engine still works; `none` skips; an old empty engine falls back.
- `tests/assets-derive-manifest.test.ts`: SFX stub engines for default, pixel/chiptune, `none`, and custom.
- `tests/chiptune-sfx.test.ts`: `engineFor`/default expectations updated; chiptune path unchanged; `none` skips.
- Keep the existing fake ComfyUI tests working (it already classifies `ace-step` as audio).

Commands (Node 24 + Yarn 4 are available after putting `C:\Users\Infplane\AppData\Roaming\fnm\node-versions\v24.14.0\installation` on PATH):

```
yarn test
yarn typecheck
yarn lint
```

Manual check: open `the-clockless-god-3` → Scenes → ch05.s01: the background now shows; audio cards play music/ambience; `the-trap-room-at-the-lanterna` → Pipeline shows the 8 missing SFX and "Continue from generate" generates them, then stages/builds.

## Docs and ticket

- `docs/protocol.md`: `ProjectDetail` now includes `stageMusic`; `SceneCuesView` includes music/ambience/beat cues; generate step description mentions SFX generation and missing-asset continuation.
- `docs/mcp-guide.md`: sound effects now default to the audio engine; `sound.sfxEngine: "none"` is import-only; engine choices for audio.
- `ROADMAP.md`: add the VNO-45 done row and next free number VNO-46; note it supersedes VNO-19's "no default".
- Save `plan.md`, and write `changelog.md` after implementation, in the ticket folder.

## Acceptance criteria

- A scene with an existing background asset shows it in the Scenes tab; the screenshot's `bg_track_to_combe_noire (no image yet)` becomes the actual afternoon background, and an active CG/insert appears over the background.
- The Scenes tab plays the scene's effective music, ambience and current-beat SFX, with cue precedence matching the built game.
- Regenerating an SFX or ambience offers only audio engines/custom audio workflows, and the new version is an audio file.
- "Open in … Studio" on SFX/ambience targets Chiptune Studio (when the version has a song file), never Pixel Studio.
- The Pipeline tab reports missing assets, "Continue from …" selects generate when appropriate, and "Generate missing" finishes the SFX without regenerating existing assets or touching locked/custom assets.
- `yarn test`, `yarn typecheck` and `yarn lint` are clean; the final diff is reviewed by the Lead against this plan.

## Implementation status (2026-10-25)

- [x] Shared contract: `BeatCueView`, extended `SceneCuesView`, `StageMusicView`, `ProjectDetail.stageMusic`, `resolveSfxEngine`, `SFX_IMPORT_ONLY`.
- [x] Engine: `engineFor('sfx')`, SFX stubs, SFX generation with an audio engine / custom workflow / chiptune, `"none"` import-only, old empty-engine entries, `studioFor` audio mapping.
- [x] Renderer: background by `scene.backgroundId`, CG/insert overlay, cue-aware stage picture, Scene audio card, chapter default label, audio-only engine choices, regenerate default, missing-assets card and missing-aware Continue.
- [x] Tests: new `tests/scene-preview-audio.test.ts`, `tests/roundtrip-studio.test.ts`; updated assets, Flow, chiptune, pipeline and UI tests.
- [x] Docs: `docs/protocol.md`, `docs/mcp-guide.md`, `ROADMAP.md`.
- Verification: `yarn test` — 73 files, 1032 tests passed; `yarn typecheck` — clean; `yarn lint` — clean.
- Deviations: the duplicate `tests/studio-for.test.ts` created during delegation was removed in favour of the exhaustive `tests/roundtrip-studio.test.ts`. The preview was refined to mirror `emit.ts` exactly: a scene without its own music falls back to the chapter track in every scene, a chapter with no track leaves the previous track playing, and ambience carries across chapters until an explicit stop (the initial plan text said ambience resets at a chapter start; emit.ts does not stop it there). No Electron GUI run was performed; the stage/audio and pipeline UI are covered by pure helper tests and the full engine suite. Commit status: uncommitted on `VNO-45_scene-backgrounds-audio-and-missing-assets`.
