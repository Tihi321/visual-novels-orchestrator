# VNO-19: SFX and ambience with Chiptune Studio

Hub ticket HUB-13 (hub plan `.claude/tickets/HUB-02-13-roadmap-tasks/plan.md`, "HUB-13"; midi-generator `ROADMAP.md` "Open"). Branch `VNO-10-19_hub-roadmap`.

## Design

- `sound.sfxEngine: "chiptune"`: `sfx_` assets are made by Chiptune Studio's `compose_sfx` (MDI-05) with `path`, through the existing Chiptune client. `compose_sfx` has a fixed list of sound names per kind, so the sound is picked from the key and description by word stems (`src/engine/studios/chip-sound.ts`); no match uses `blip` (sfx) or `drone` (ambience) and the version gets a warning.
- Ambience: the settings key already exists (`sound.ambienceEngine`, a ComfyUI engine, default `ace-step-v1-instrumental`). `"chiptune"` routes `amb_` assets to `compose_sfx` kind `ambience` (seamless loop, `loopStartSec` 0). Smallest design: no new setting.
- Not defaulted for pixel books: a default would send jobs to a studio that may not run and would change existing projects. Both stay explicit.
- Imported and locked files are never overwritten (generateAsset already skips `custom` and `locked`); a new version is `v<n+1>`; an asset with versions keeps its engine (reconcile).
- `vno_update_settings` gets the `sound` part (the description already named it, the schema did not have it).

## Steps

- [x] `ChiptuneClient.composeSfx`, fake client, `makeChiptuneSound` (shares the file/song handling with `makeChiptuneTrack`).
- [x] `generateAsset`: `chiptune` engine for `sfx` and `ambience`.
- [x] `vno_update_settings {sound}`, tool and schema descriptions, `docs/mcp-guide.md`.
- [x] Tests `tests/chiptune-sfx.test.ts`; ROADMAP row.

## Out of scope

UI picker (the app has none for `sfxEngine`); stingers (`kind: stinger`).
