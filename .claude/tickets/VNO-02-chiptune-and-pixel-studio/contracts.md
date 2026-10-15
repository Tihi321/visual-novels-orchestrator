# VNO-02 studio contracts (shared by MDI-03, PAR-05 and VN Studio)

This is the single source of truth for what VN Studio calls and what the studios provide. If an implementer must deviate, it reports the change; the orchestrator updates this file.

## Common rules

### Structured results
The tool results have no `structuredContent` today.
- Every **new or extended** tool below returns its normal human-readable text first.
- The **last** content item is `{type:'text', text:'<one JSON object>'}`, holding the fields listed for that tool.
- VN Studio parses the last text item that `JSON.parse`s to an object.
- `isError: true` results contain a plain-text error.

### Paths
- Every path that VN Studio passes is absolute: Windows paths, local filesystem.
- The studios write exactly to that path and create parent directories.
- Relative file names keep today's behaviour: they resolve to `~/PixelStudio/exports` or `~/ChiptuneStudio/exports`.

### Headless mode
- **Flag:** `--mcp-only [--port N]` on the Electron app.
- **Commands to start it:**
  - Dev or built: `yarn mcp` = `electron . --mcp-only` (it needs `yarn build` first).
  - Packaged: `<exe> --mcp-only`.
- **What it does:**
  - It starts the MCP Streamable HTTP server at `http://127.0.0.1:<port>/mcp` with no window. The default port is 7457 for Pixel Studio and 7458 for Chiptune Studio.
  - Every tool runs in the main process (Node) on a headless session. A hidden window is acceptable only if it is far simpler; document the choice.
  - It logs `MCP listening on http://127.0.0.1:<port>/mcp` to stdout.
- **Single instance:**
  - Headless mode does **not** take the single-instance lock, and it does not open any window.
  - Window mode keeps the lock. A second launch with `--open <path>` forwards that path to the running window, using the `second-instance` event.
- **Port collision:** if window mode cannot bind the MCP port because the headless server holds it, the window still opens, and the MCP status shows the bind error. It does not crash.

### Round trip (window mode)
- **CLI:** `--open <path> [--export-to <path>] [--export-width W --export-height H]`. Chiptune Studio uses `--export-format ogg|wav` instead of width and height.
  - The app opens the document or song in the window.
  - Each time the user **saves** the document (Ctrl+S or the Save action), the studio also exports to `--export-to`:
    - Pixel Studio: a PNG of the current frame with visible layers, nearest-neighbour scaled to the export width and height if given.
    - Chiptune Studio: the looping audio in the given format, with the same loop rules as `render_audio`.
- **MCP:** `open_document` and `open_song` take the same `exportTo` options. When the studio is headless, they load into the headless session instead.
- **Chiptune loop sidecar (added 2026-10-15):** on every save-triggered auto-export, Chiptune Studio also writes `<exportTo>.json` (for example `music.ogg.json`) containing `{ loopStartSec, loopEndSec, durationSec, sampleRate }`. The loop fields are `null` when the song doesn't loop. VN Studio reads this file for the loop points of the new version.

---

## Chiptune Studio (midi-generator, `MDI-03_vn-studio-music`), port 7458

### Moods
- **New moods:** `ambient`, `lullaby`, `peaceful`, `mysterious-calm`. Existing moods stay.
- **New soft instrument presets:**
  - SNES pads and strings.
  - A GB soft square with a long release.
  - Something soft for the NES triangle and pulse.
- Calm moods default to soft presets, a slow BPM (60-90) and sparse drums (or none).

### `compose_track`
Input:
```
{ mood: string, chip?: 'nes'|'gb'|'genesis'|'snes'|'pce' (existing chip ids; default per mood),
  bpm?: number, key?: string (e.g. 'C','F#'), scale?: string, bars?: number (default 16),
  seconds?: number (approximate target; overrides bars — rounds to whole bars),
  loop?: boolean (default true), seed?: number (default random; returned), instruments?: Record<channelId, presetName>,
  name?: string }
```
- It creates a new song, makes it the current song, and composes a progression, a bass, a melody and optional drums from the existing theory, moods, progression and melody code.
- With `loop: true`, it calls the equivalent of `set_loop` over the whole body. An optional intro of 0-2 bars is allowed. The loop end must equal the song end, with no tail.
- It is **deterministic for the same seed and arguments.**

Result JSON:
```
{ songId, name, chip, bpm, key, scale, mood, bars, seed, durationSec, loop: { startBar, endBar } | null, channels: string[] }
```

### `render_audio`
Input:
```
{ song?: songId (default current), path: string (absolute), format?: 'ogg'|'wav'|'mp3' (default 'ogg'),
  loops?: 1..8 (default 1), fadeOutSec?: number (makes it non-looping), sampleRate?: 44100|48000 }
```
- **Rendering:**
  - It renders like `export_wav`: the intro plus the loop body × `loops`.
  - **When the song loops and there is no fade, the file ends exactly at the loop end.** The player then loops from `loopStartSec` to the end of the file seamlessly; Ren'Py does this with `<loop S>`.
- **Format:**
  - ogg: ffmpeg `libvorbis -q:a 6`. mp3: `libmp3lame -q:a 2`.
  - ffmpeg comes from `FFMPEG_PATH`, else PATH.
  - If ffmpeg is missing, it writes `.wav` next to the requested path, sets `format: 'wav'`, and adds a `warning`.
  - The WAV keeps the `smpl` loop chunk.

Result JSON:
```
{ path (actual written path), format, sampleRate, durationSec, loopStartSec: number|null, loopEndSec: number|null,
  loopStartSample: number|null, loopEndSample: number|null, warning?: string }
```

### `save_song`
- Input: `{ song?: songId, path: string }`. It saves the native song file (the existing project format), so it can be reopened with `open_song`.
- Result JSON: `{ songId, path }`.

### `list_songs`
- Input: `{}`.
- Result JSON: `{ songs: [{ songId, name, path: string|null, chip, bpm, current: boolean }] }`. It lists the songs held in this session or process.

### `open_song`
- Input: `{ path: string, exportTo?: string, exportFormat?: 'ogg'|'wav' }`. It loads a native song file and makes it current. In window mode it also brings the window to front, and with `exportTo` it auto-exports on save.
- Result JSON: `{ songId, name, path }`.

### `delete_song`
- Input: `{ song: songId }`. It removes the song from the session; it never deletes files.
- Result JSON: `{ deleted: true }`.

### Existing tools
Existing tools (`write_pattern`, `export_wav` and the rest) must keep working headless and act on the current song.

---

## Pixel Studio (pixel-art-generator, `PAR-05_vn-studio-art`), port 7457

### `import_image`
Input:
```
{ path: string (absolute PNG/JPG/WebP — at least PNG; JPG/WebP if a pure-TS/node decoder is cheap, else document PNG-only),
  name?: string, width?: number, height?: number, scale?: number (downscale divisor, alternative to width/height; aspect kept when only one of width/height given),
  palette?: string (seed palette id/name) | string[] (hex colours), maxColors?: number (default 32, used when no palette — median-cut or k-means),
  dither?: 'none'|'ordered'|'floyd' (default 'none'), outline?: boolean | string (hex; true = darkest palette colour),
  cleanup?: boolean (default true: remove orphan single pixels / 1px noise), alphaThreshold?: 0..255 (default 128; below → fully transparent) }
```
- **Pipeline:**
  1. Decode the image.
  2. Do an area-average downscale that is alpha-aware (premultiplied).
  3. Threshold the alpha.
  4. Remap the colours to the palette, with optional dithering. Transparent pixels are never dithered.
  5. Clean up orphan pixels.
  6. Add an optional outline: 1px outside opaque regions.
- It creates a new document with one pixel layer, and that document becomes the current one.
- **Max size is 512x512.** That covers 320x180 backgrounds and 64x96 sprites.

Result JSON:
```
{ documentId, name, width, height, colors: number (distinct opaque colours used), transparentPixels: number }
```

### `export_png` (extended)
- **New input:** `width?` and `height?`, the exact output size with nearest-neighbour scaling. When both are given they override `scale`. The scaling need not be an integer multiple; 320x180 to 1920x1080 is 6x.
- **Also new:** `document?: documentId`, to pick the document; the default is the current one.
- Result JSON: `{ paths: string[], width, height }`.

### `export_many`
- Input: `{ items: [{ document?: documentId, path, width?, height?, scale?, frame? }] }`.
- Result JSON: `{ paths: string[] }`.

### `draw_sprite_from_reference`
- Input: `{ reference: string (absolute image path), width: number (≤128), height: number (≤128), palette: string|string[], expression?: string, name?: string }`.
- It creates a new document of that size with the given palette. It adds the reference, downscaled to fit, as a **reference layer**, hidden from export.
- The text part returns drawing guidance for an agent: the palette, the size, `draw_grid` usage, and expression hints.

Result JSON:
```
{ documentId, name, width, height, palette: string[], referenceLayerId }
```

### `list_documents`
- Input: `{}`.
- Result JSON: `{ documents: [{ documentId, name, width, height, path: string|null, current: boolean, dirty: boolean }] }`.

### `open_document`
- Input: `{ path: string (native doc or PNG), exportTo?: string, exportWidth?: number, exportHeight?: number }`.
- It opens the file. A PNG opens as a new one-layer document at its pixel size.
- Result JSON: `{ documentId, name, width, height, path }`.

### `save_document`
- Input: `{ document?: documentId, path?: string }`.
- It saves in the native format. If `exportTo` was set for this document, it also exports the PNG there.
- Result JSON: `{ documentId, path, exported?: string }`.

### Existing tools
Existing tools (`draw_grid`, `remap_to_palette` and the rest) must work headless on the current document.

### As implemented (PAR-05 deviations)
- **Image formats:** PNG always works. JPEG works in the app and headless, through Electron `nativeImage`. **WebP is not supported.**
- **`documentId`:** an opaque string, `docN` in headless mode and `tabN` in window mode.
- **Headless bind failure:** the process exits 1.
- **Headless MCP settings:**
  - The port comes from `--port` or `PIXEL_STUDIO_MCP_PORT`.
  - The token comes from `PIXEL_STUDIO_MCP_TOKEN`. `~/PixelStudio/config/mcp.json` is ignored.
- **`export_png`:** `width` or `height` alone keeps the aspect ratio.
- **`open_document`:** reopening an already-open `.pxs` activates that document instead of adding a new one.
- **`--open`:** both `--open=<path>` and `--open <path>` work. The export width and height are only applied when both are given.
- **Headless session:** keeps at most 64 documents and drops the oldest clean one.

---

## VN Studio side (`VNO-02_chiptune-pixel-studio`)

### Client and settings
- **Client:** `src/engine/studios/mcp-http.ts`, a generic MCP Streamable HTTP client factored out of `voice/vibetts.ts`. It does `callTool(name, args, {timeoutMs})` and returns `{text, json}`.
- **URLs:**
  - Configured in `seed/config/studios.md`: Pixel Studio is `http://127.0.0.1:7457/mcp`, Chiptune Studio is `http://127.0.0.1:7458/mcp`.
  - Env overrides: `VNO_PIXEL_STUDIO_URL`, `VNO_CHIPTUNE_STUDIO_URL`.
- **Repo paths** are used for start hints and the "Open in" launch. They live in the same config: `C:\projects\Personal\pixel-art-generator` and `C:\projects\Personal\midi-generator`.
  - Launch command: `yarn --cwd <repo> electron . --open <path> --export-to <path>`, or a configured exe path.
- **Down error:** `Pixel Studio is not running at <url>. Start it headless: cd <repo> && yarn build && yarn mcp`.
