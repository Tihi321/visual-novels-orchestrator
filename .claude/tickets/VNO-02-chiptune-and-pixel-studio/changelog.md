# VNO-02 changelog

## 2026-10-15: VNO-02, Chiptune Studio music and Pixel Studio art in VN Studio

**Outcome:** VN Studio can now make music with Chiptune Studio (seamless ogg loops played with Ren'Py `<loop S>`) and turn ComfyUI images into pixel art with Pixel Studio, falling back to sharp when Pixel Studio is down. Both studios run headless (`--mcp-only`). An asset card can open in either studio, and a save there becomes a new custom, locked version.

- Plan: [plan.md](plan.md)
- Shared MCP contract: [contracts.md](contracts.md)

**Commit status:** uncommitted in all three repos. No branches are pushed.

### Repos changed

#### 1. visual-novels-orchestrator (VN Studio), branch `VNO-02_chiptune-pixel-studio` (from `origin/master` a72c21b)

**New files**
- `src/engine/studios/mcp-http.ts`: generic MCP Streamable HTTP client (JSON + SSE, timeouts). `callTool` returns `{text, human, json}`, where `json` is the last JSON-object text item.
- `src/engine/studios/config.ts`: reads `config/studios.md`. Env overrides are `VNO_PIXEL_STUDIO_URL` and `VNO_CHIPTUNE_STUDIO_URL`. A studio that is down gives a "start it headless" error.
- `src/engine/studios/chiptune.ts`, `src/engine/studios/pixel.ts`: typed clients for the contract tools.
- `src/engine/studios/chip-plan.ts`: per-track `{mood, chip, bpm, key, bars}` plan with a deterministic fallback.
- `src/engine/studios/music.ts`: `compose_track` → `render_audio` (ogg) → `save_song` → `delete_song`. Returns the file, the song file and the loop points.
- `src/engine/studios/pixelate.ts`: `import_image` + `export_many`. Writes a full-size PNG and a native-grid PNG, with the size enforced exactly.
- `src/engine/studios/draw.ts`: the `pixel-studio-draw` agent loop over an allowlist of drawing tools, capped by steps and time.
- `src/engine/studios/launch.ts`: launches the studio window (`--open … --export-to …`) and watches the export file by polling.
- `src/engine/vn/roundtrip.ts`: "Open in Pixel Studio / Chiptune Studio".
  - The studio edits a copy of the asset.
  - Each save becomes a new custom, locked, selected version, followed by a rebuild.
  - For music, the loop points come from the `.json` sidecar.
- `src/engine/store/seedRefresh.ts`: records hashes of the seeded files. On upgrade it updates untouched seeded prompts and config, keeps files the user edited, and adds an "update available" note.
- `seed/config/studios.md`: studio URLs, repo paths, exe overrides, timeouts and draw caps.
- Tests:
  - `tests/studio-fakes.ts`
  - `tests/studios-clients.test.ts`
  - `tests/studios-generate.test.ts`
  - `tests/studios-pipeline.test.ts`
  - `tests/seed-refresh.test.ts`

**Changed files**
- `src/shared/vn.ts`: new optional settings with resolvers.
  - Settings: `music.provider` (auto means chiptune for pixel books), `music.chip`, `art.pixelProvider`, `art.provider` (`comfy | pixel-studio-draw`), `art.pixel.{width,height,dither,outline}` (default 320x180).
  - Versions gain `loopStartSec`, `loopEndSec`, `songFile`, `nativeFile`, `warnings`, `custom`.
  - Old `project.md` files parse unchanged.
- `src/engine/voice/vibetts.ts`: now built on `mcp-http.ts`, with the same behaviour.
- `src/engine/assets/generate.ts`:
  - The pixel step goes through Pixel Studio, falling back to sharp with a warning.
  - New chiptune music branch.
  - An unlocked, non-custom music asset follows the resolved provider.
  - Sprites and the cover use a whole-number pixel factor, the same factor as backgrounds.
- `src/engine/assets/postprocess.ts`: `pixelate` gains `exactScale`, so the output is the grid times a whole number.
- `src/engine/vn/agents/composer.ts`, `seed/prompts/composer/plan_music.md`: the composer plans chiptune tracks, or ComfyUI prompts as before.
- `src/engine/vn/handlers.ts`:
  - Music plan reconciles first and writes missing chip plans.
  - Studio clients are passed to generation.
  - New `vn.assets.draw` job.
  - Loop points are passed to the build.
- `src/engine/vn/pipeline.ts`: registers `vn.assets.draw`.
- `src/engine/vn/service.ts`: music engine follows the provider (`reconcileAssets`); studio status and `openInStudio`; settings merge for the pixel fields.
- `src/engine/renpy/emit.ts`, `src/engine/renpy/build.ts`: `play music "<loop S>audio/…ogg"` and `config.main_menu_music` with the loop prefix when loop points exist.
- `src/engine/store/dataFolder.ts`: seed refresh on open. Agents stay copy-only.
- `src/engine/engine.ts`: passes the studio clients through, emits `engine.warning` for seed updates, and stops round-trip watchers on stop.
- `src/engine/index.ts`, `src/engine/vncli.ts`:
  - New CLI options: `settings … --music-provider/--chip/--pixel-provider/--art-provider/--pixel-size/--dither/--outline`.
  - New commands: `studios status` and `studio open <slug> <assetId> [--wait] [--via launch|mcp]`.
- `src/shared/protocol.ts`, `docs/protocol.md`: `studiosStatus` and `openInStudio` commands, `studios.status` and `studio.opened` events, extended settings patch.
- `src/renderer/ui/book/LookTab.tsx`: controls for music provider and chip, pixel provider, size, dither, outline, and sprite provider.
- `src/renderer/ui/ComfyPage.tsx`: now "Generators", with status cards for ComfyUI, VibeTTS, Pixel Studio and Chiptune Studio, each with a start hint.
- `src/renderer/ui/book/AssetsTab.tsx`: "Open in Pixel Studio / Chiptune Studio" buttons, version warnings, and an "edited by hand" pill.
- `src/renderer/store/store.ts`, `src/renderer/store/vn.ts`, `src/renderer/lib/settings.ts`: the nav page renamed, studio status and opened state stored, settings merge matches the engine's.
- `tests/vn-helpers.ts`: `makeVnEnv` accepts engine options.

**Ticket files:** `.claude/tickets/VNO-02-chiptune-and-pixel-studio/{plan,contracts,changelog,handoff}.md`.

#### 2. midi-generator (Chiptune Studio), branch `MDI-03_vn-studio-music` (from `origin/master` 425bd0b)

**New files**
- `src/main/headless.ts`: the `--mcp-only` host. It runs a `SongSession` and the tool registry in the main process, with no window and no single-instance lock.
- `src/main/cli.ts`: parses `--mcp-only`, `--port`, `--open`, `--export-to`, `--export-format`, including Chromium's reordering of the second-instance argv.
- `src/main/ffmpeg.ts`: ogg (libvorbis q6) and mp3 (libmp3lame q2) via `FFMPEG_PATH` or PATH, with a WAV fallback and a warning.
- `src/tools/composer.ts`: seeded procedural composer (mulberry32) built on the existing theory and moods.
- `src/tools/defs/studio.ts`: `compose_track`, `render_audio`, `save_song`, `list_songs`, `open_song`, `delete_song`, each with a final JSON result.
- `src/tools/audioExport.ts`: render to a file, plus `exportWithSidecar` (`<file>.json` with the loop points).
- `src/tools/songStore.ts`: several songs per session.
- `src/tools/inProcessAudio.ts`: offline synth render in Node.
- Tests: `tests/tools/studio.test.ts`, `tests/main/headless.test.ts`.

**Changed files**
- `src/core/theory/{moods,progressions,drums}.ts`: moods `ambient`, `lullaby`, `peaceful`, `mysterious-calm`; 9 calm progressions; drum style `soft-pulse`.
- `src/core/instruments/presets/{snes,gb,nes}.ts`: soft pads, strings, squares and triangle with long releases.
- `src/tools/{session,services,util,index}.ts`, `src/tools/defs/index.ts`: multi-song session and tool registration. `src/tools/guideText.ts` is regenerated.
- `src/main/{index,services}.ts`, `src/shared/ipc.ts`:
  - Headless or windowed start.
  - Window mode takes the single-instance lock and forwards `--open` through `second-instance`.
  - A port bind failure does not crash the app.
  - New `fs:encodeAudio` channel.
- `src/renderer/{main.tsx,toolBridgeClient.ts}`, `src/renderer/state/actions.ts`: `openSongRequest`, and `exportOnSave` (audio plus sidecar) when an `exportTo` is set.
- `package.json` (`yarn mcp`), `README.md`, `docs/llm-guide.md`: headless mode, the new tools and the round trip.
- Tests updated for bank sizes and mood lists:
  - `tests/core/instruments.test.ts`
  - `tests/core/theory.test.ts`
  - `tests/core/synth/snes.test.ts`
  - `tests/main/services.test.ts`

**Ticket files:** `.claude/tickets/MDI-03-vn-studio-music/{plan,changelog}.md`.

#### 3. pixel-art-generator (Pixel Studio), branch `PAR-05_vn-studio-art` (from `origin/master` 3f2cf19)

**New files**
- `src/core/convert.ts`: `convertImage`, with this pipeline:
  1. Alpha-aware area downscale.
  2. Alpha threshold.
  3. Palette (given, or median cut).
  4. Remap with none, ordered or floyd dithering. Transparent pixels are never dithered.
  5. Orphan cleanup.
  6. Optional 1px outline.

  The file also has `resizeNearest`, which scales to an exact size at any ratio.
- `src/tools/documents.ts`: `DocumentSet` (headless multi-document), `DocumentHost`, and export-to-target helpers.
- `src/tools/defs/studio.ts`: `import_image`, `export_many`, `draw_sprite_from_reference`, `list_documents`, `open_document`, `save_document`.
- `src/main/headless.ts`, `src/main/cli.ts`, `src/main/imageDecode.ts`: the `--mcp-only` host, the CLI parser, and JPEG decoding via `nativeImage`.
- Tests:
  - `tests/core/convert.test.ts`
  - `tests/tools/studio.test.ts`
  - `tests/main/headless.test.ts`

**Changed files**
- `src/tools/defs/export.ts`: `export_png` gains `width`, `height`, `document` and a JSON result.
- `src/tools/{registry,services,index}.ts`, `src/tools/defs/index.ts`, `src/core/index.ts`: `ToolContext.documents`, `decodeImage`, registration. `src/tools/guideText.ts` is regenerated.
- `src/main/{index,services}.ts`, `src/shared/ipc.ts`: headless or windowed start, single-instance `--open` forwarding, the `fs:decodeImage` channel, and a bind failure that does not crash.
- `src/renderer/state/{actions,workspace}.ts`, `src/renderer/{main.tsx,toolBridgeClient.ts}`: a document host over the tabs, and export on save when the tab has `exportTo`.
- `package.json` (`yarn mcp`), `README.md`, `docs/llm-guide.md`.
- Tests updated (tool count 54 → 60, fs channel count):
  - `tests/tools/registry.test.ts`
  - `tests/main/toolBridge.test.ts`
  - `tests/mcp/server.test.ts`
  - `tests/mcp/stdio.test.ts`
  - `tests/main/services.test.ts`

**Ticket files:** `.claude/tickets/PAR-05-vn-studio-art/{plan,changelog}.md`.

### Deviations from the plan
- **Contract and branches.**
  - A shared contract (`contracts.md`) was written first so that the three repos could be built in parallel. It gained one addition: the Chiptune loop sidecar `<export>.json`, which carries loop points through the round trip.
  - The VN Studio branch is based on `master`, not VNO-01, because VNO-01 was merged before this work started.
- **Headless architecture:** both studios run their tools in the Electron main process (Node) with no hidden window, because the cores are pure TypeScript.
- **Pixel Studio**
  - WebP input is not supported; PNG and JPEG are.
  - Document ids are opaque (`docN` headless, `tabN` in the window).
  - The headless server exits 1 when its port is taken.
- **Chiptune Studio**
  - `compose_track` uses no intro bars, so the loop covers the whole song.
  - `calm` and `relaxed` still map to `chill`.
  - Soft presets exist only for SNES, GB and NES.
- **VN Studio**
  - New settings are optional fields with resolvers instead of zod defaults, for backward compatibility.
  - Draw mode is a separate job `vn.assets.draw`, because generation runs without a model.
  - "Open in" launches the window first and uses MCP `open_*` only as a fallback (`--via mcp`).
  - Agents are not part of the seed refresh; they stay copy-only.
- **Bugs fixed during live integration**
  - A music asset with an earlier ComfyUI version did not follow the provider switch.
  - The sprite pixel scale was not a whole number (335x972 from a 56x162 grid).

### Verification

**Run and passing**

| Repo | `yarn typecheck` | `yarn lint` | `yarn test` | `yarn build` |
| --- | --- | --- | --- | --- |
| VN Studio | ok | ok | 436 passed (389 before) | ok (implementer) |
| Chiptune Studio | ok | ok | 829 passed | ok (implementer) |
| Pixel Studio | ok | ok | 363 passed | ok (implementer); `yarn test:electron` 7 passed |

- **Headless MCP, both studios:** live `yarn mcp` answered `tools/list` (Pixel 60 tools, Chiptune 54) and tool calls with no window open.
- **Live VN Studio CLI on a copy of the soother book**, with ComfyUI running. Details are in the plan's integration note.
  - Pixel Studio art: backgrounds are an exact 320x180 → 1920x1080; sprites keep alpha with a whole-number 6x scale.
  - Sharp fallback when Pixel Studio is down, with the warning stored on the version.
  - Chiptune ogg files whose length equals `loopEndSec` (ffprobe).
  - Ren'Py output `"<loop 0>audio/music_0N.ogg"` with Ren'Py lint clean.
  - Pixel round trip: the save in the window became the new version, which the rebuild used.
  - Chiptune round trip: the save in the window became the new version, with loop points from the sidecar.

**Not run**
- Listening for an audible seam in `vno run` (manual).
- Ctrl+S pressed by hand in the studio UIs. The round trip was driven through the windows' MCP `save_document` / `save_song`, which use the same export code.
- `pixel-studio-draw` with a live LLM (none was running).
- The VN Studio UI (Look tab, Generators page, asset buttons) checked by eye in Electron.
- The packaged studio exe with `--mcp-only`.
- `yarn test:electron` for Chiptune Studio.

### Follow-ups and known limitations
- Song file extensions are inconsistent: generated versions store `v<n>.ctune`, round-trip versions `v<n>.song`. Both open in Chiptune Studio.
- VN Studio does not send the optional studio MCP bearer tokens (`PIXEL_STUDIO_MCP_TOKEN` / `CHIPTUNE_STUDIO_MCP_TOKEN`). The headless servers have no auth by default.
- `cues.json` from an earlier run keeps its old music mapping until the stage step runs again.
