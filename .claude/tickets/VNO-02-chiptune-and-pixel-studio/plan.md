# VNO-02: Chiptune Studio music and Pixel Studio art for VN Studio

Status: **planned, next milestone.** Not started. It follows VNO-01 (`.claude/tickets/VNO-01-visual-novel-studio-scriptorium-book-ren/`).

## Context

VN Studio makes art and music with ComfyUI. The user wants both of their own studio apps as options too:
- **Chiptune Studio** (`C:\projects\Personal\midi-generator`): a chiptune and MIDI composer with chip synths (NES, Game Boy, Genesis, SNES, PC Engine) and an MCP server.
- **Pixel Studio** (`C:\projects\Personal\pixel-art-generator`): a pixel-art editor (layers, frames, palettes, asset library) with an MCP server.

**Freedom to change the studios.** These are the user's own apps, so they can be changed freely to suit VN Studio: expand their MCP, add a headless mode, add high-level tools. Each studio change goes on a ticket branch in that repo, using its own prefix (`MDI-03_…`, `PAR-05_…`) and its own `.claude/tickets/` folder. At the end, report every repository changed.

### What exists today (from VNO-01 exploration)
- **Both studios:**
  - Electron 44 + React 19 + TypeScript + yarn, the same base as Scriptorium.
  - Each has its own LLM agent plus an MCP server that **only runs inside the open app window**, because tool calls are bridged to the renderer.
- **Pixel Studio:**
  - **MCP:** `http://127.0.0.1:7457/mcp`; a stdio shim at `out/mcp-stdio/index.js`.
  - **Tools:** documents, layers, frames, palettes, assets and style reference, `draw_grid` (max 64x64 per call), `export_png` (integer scale 1-32), `export_spritesheet`, `remap_to_palette`.
  - **Code:** pure-TS PNG codec `src/core/codecs/png.ts`; palettes in `seed/palettes/`; guide `docs/llm-guide.md`.
- **Chiptune Studio:**
  - **MCP:** `http://127.0.0.1:7458/mcp`; a stdio shim at `out/mcp-stdio/index.js`.
  - **Tools:** `new_song {chip,bpm,key,scale,mood}`, `get_mood_recipe`, `suggest_progression`, `write_pattern`/`write_melody`/`write_drums`, `set_loop`, `export_wav {loops,fadeOutSec,stems,sampleRate}` (with a `smpl` loop chunk), `export_midi`.
  - **Moods:** `calm`/`relaxed` map to `chill`, and there is no "ambient" mood (`src/core/theory/moods.ts`).
  - **Code:** the synth core in `src/core/synth` is pure TS, but rendering runs in the renderer (`src/renderer/audio/*`).
- **VN Studio:**
  - **Music:** comes only from ComfyUI (`music.engine`, ACE-Step).
  - **Pixel style:** a simple sharp-based downscale and palette quantise (`src/engine/assets/postprocess.ts` `pixelate`).
  - **Ren'Py loops:** Ren'Py can loop music at a sample point with the `<loop N>` audio prefix.
  - **Existing integration pattern:** VibeTTS (`src/engine/voice/vibetts.ts`, an MCP HTTP client with JSON+SSE and timeouts) is the template for talking to a studio app.

## Goals
1. **Music provider choice:** ComfyUI (ACE-Step) or Chiptune Studio.
   - Pixel-style books default to Chiptune.
   - Tracks are calm, loopable and seamless.
2. **Pixel art through Pixel Studio:**
   - ComfyUI images are converted to clean pixel art (better than plain quantising).
   - Optionally, small sprites are drawn directly by the agent.
3. **Manual round trip:** "Open in Pixel Studio" or "Open in Chiptune Studio" from an asset card, then save back as a new custom version.
4. **Headless studios:** both work without an open window, so the VN Studio pipeline and CLI can run them unattended.

## Plan

### A. Chiptune Studio (midi-generator, branch `MDI-03_vn-studio-music`)
- **Headless engine:**
  - Move song model + synth render out of the renderer into a Node-runnable core (or run it in a utilityProcess).
  - Add `--mcp-only [--port]`: the MCP server with no window, the same idea as VibeTTS. The existing window mode still works.
- **New MCP tools:**
  - `compose_track {mood, chip, bpm?, key?, bars?, seconds?, loop: true, seed?, instruments?}`: a procedural composer built on the existing theory and moods (progressions, melody, drums). It returns the song id and a summary, so an agent gets a calm loop in one call. The composer agent may refine it after with `write_pattern`.
  - `render_audio {song, path, format: wav|ogg|mp3, loops, fadeOutSec, sampleRate}`. It returns the duration and loop points in seconds (loopStart, loopEnd). Use ffmpeg for ogg/mp3 when it is on PATH, otherwise write wav.
  - `list_songs`, `open_song`, `delete_song`, for the round trip.
  - New moods `ambient`, `lullaby`, `peaceful`, `mysterious-calm`, plus softer instrument presets (SNES pads/strings, GB soft square with long release).
- **Tests:** the composer is deterministic for a seed; render length and loop points; headless MCP `tools/list` and `tools/call`.

### B. Pixel Studio (pixel-art-generator, branch `PAR-05_vn-studio-art`)
- **Headless mode:** `--mcp-only [--port]`. The document model and core ops run without the renderer, or in a hidden window if that is far simpler (decide after reading `src/main/toolBridge.ts`).
- **New MCP tools:**
  - `import_image {path, width?, height?, scale?, palette?, dither: none|ordered|floyd, outline?, cleanup?}`: brings a ComfyUI image in as a new document. Pixel-art conversion: area downscale → palette remap (existing `remap_to_palette`) → orphan-pixel cleanup → optional outline. Keeps alpha for sprites.
  - `export_png` with explicit `width`/`height` target (nearest-neighbour), so 320x180 fits 1920x1080 exactly. A batch variant: `export_many`.
  - `draw_sprite_from_reference {reference, width, height, palette, expression?}`: a prompt helper that loads the reference and style context for an agent to draw small sprites (64x96) with `draw_grid`. Meant for chibi or retro books.
  - `list_documents`, `open_document {path}`, `save_document`, for the round trip.
- **Tests:** the import pipeline on fixture images (palette only, alpha kept, exact size); headless MCP.

### C. VN Studio integration (branch `VNO-02_chiptune-pixel-studio`)
- **Contract** (`src/shared/vn.ts`):
  - `music.provider: 'comfy' | 'chiptune'`, plus `music.chip`. Auto: chiptune when `art.style` is `pixel`.
  - `art.pixelProvider: 'vno' | 'pixel-studio'` and `art.pixel.{width,height,dither,outline}`.
  - `art.provider` gets an option `pixel-studio-draw` for agent-drawn small sprites.
- **Clients:** `src/engine/studios/{mcp-http,chiptune,pixel}.ts`.
  - Factor the VibeTTS MCP client into a shared `mcp-http.ts`.
  - URLs live in `seed/config/studios.md` (7457, 7458), with env overrides.
  - When a studio is down, the error says how to start it headless.
- **Music:**
  - The composer agent plans per track `{mood, chip, bpm, key, bars}` for chiptune, or ComfyUI prompts as today.
  - `vn.music.generate` calls `compose_track` and `render_audio` (ogg), then stores the loop points in the asset version.
  - The Ren'Py emit uses `play music "<loop S>audio/music_01.ogg"` for seamless loops.
- **Art:**
  - In pixel mode with `pixel-studio`, the pixelate step calls `import_image` and `export_png` instead of the sharp quantiser. It falls back to sharp if Pixel Studio is down (warning on the asset).
  - The optional draw mode for sprites uses an agent loop that calls Pixel Studio tools, capped by steps and time.
- **Round trip:**
  - The asset card gets "Open in Pixel Studio" or "Open in Chiptune Studio" (`open_document`/`open_song`, launching the app if needed).
  - VN Studio watches the exported file; saving creates a new custom, locked version.
- **UI:**
  - Look tab: music provider and chip, pixel provider and size, dither and outline.
  - ComfyUI page becomes "Generators", with status cards for ComfyUI, VibeTTS, Pixel Studio and Chiptune Studio, each with a start hint.
- **Seed refresh (debt from VNO-01):** existing data folders never get updated seed prompts. Record seed file hashes, so an untouched seeded prompt or config is updated on upgrade and one the user edited is kept, with an "update available" note.

### Verification
1. **Studio repos:** their own test suites pass, and the headless MCP answers `tools/list` and one `tools/call` with the window closed.
2. **Chiptune:** with `music.provider: chiptune`, a calm loop renders to ogg with loop points. In `vno run` it loops with no audible seam at the loop point.
3. **Pixel art:** `style: pixel`, `pixelProvider: pixel-studio` on the soother book gives backgrounds at an exact 320x180 → 1920x1080 and transparent sprites in the chosen palette (check by eye). With Pixel Studio stopped, it falls back to sharp with a warning.
4. **Round trip:** open a background in Pixel Studio, edit a pixel, save. VN Studio shows a new custom version and the rebuild uses it.
5. **VN Studio checks:** `yarn typecheck`, `lint`, `test` and `build` pass, and Ren'Py lint is clean.
6. **Repos changed:** list every repo touched in the changelog, with branch and files.
