# VNO-07: Hand-made art mode (no ComfyUI)

Branch: `VNO-07_hand-drawn-art` from `master`.

## Why

Every image path in VN Studio starts with ComfyUI: backgrounds and sheets call `ctx.comfy.generate`, sprites are edited from
the sheet with ComfyUI, and both pixel modes (`pixelProvider: pixel-studio`, `provider: pixel-studio-draw`) convert or copy
a ComfyUI render (`src/engine/assets/generate.ts`). A user who wants a book drawn only in Pixel Studio (or with their own
files) has no safe path: the only way is to `vno_asset_replace` every image before the pipeline reaches `generate`, and any
image they missed goes to ComfyUI. Found in the hub production "The Soother That Fell Into Dragon Land" (2026-10-20), where
Claude drew every image with the pixel-studio MCP and the user asked for no ComfyUI.

## What

A new art provider `hand`: `ProjectSettings.art.provider: 'hand'` (`ART_PROVIDERS` in `src/shared/vn.ts`). Images are made
outside VN Studio and set with `vno_asset_replace` / "Open in Pixel Studio" (the studio save path that already exists); VN
Studio never generates an image for that project.

1. **Generate step** (`vn.assets.generate` and the job routing in `src/engine/vn/service.ts` / `handlers.ts`): in `hand` mode
   an image asset (background, sheet, sprite, cover) without a file is not enqueued and never reaches ComfyUI. Music and voice
   are generated as usual. The step finishes `done` with a message such as `music_01..04: version 1; 12 image(s) wait for a
   hand-made file (vno_asset_replace)`. `vno_asset_generate` and `vno_asset_regen` on an image in `hand` mode return an error
   that says to use `vno_asset_replace` (music still works).
2. **Art plan**: the pipeline's art step in `hand` mode does not ask the art-director (no model call, message `hand-made art:
   no prompts planned`). `vno_plan` still plans prompts when called explicitly (they are useful as briefs for the person
   drawing), and it plans the music either way.
3. **Sheets**: in `hand` mode sprites do not need a sheet. A sheet without a file is not a placeholder in the build result and
   is not listed as missing (it is only a reference). If the build already ignores sheets, keep that and add a test.
4. **Build**: placeholders for missing hand-made images still work as today (the build lists them), so a book can be built
   and played while art is still being drawn.
5. **Settings surfaces**: `vno_update_settings` accepts `art: {provider: "hand"}` (and `null` clears it); the CLI flag
   `--art-provider hand` (`src/engine/vncli.ts`); the Look tab (`src/renderer/ui/book/LookTab.tsx`) offers "Hand-made (no
   ComfyUI)" in the provider picker; the `vno_update_settings` description in `src/engine/mcp/tools.ts` names it.
6. **Docs**: `docs/protocol.md` (Studios section, settings), `docs/mcp-guide.md` (a short "Hand-made art" section: set
   `art.provider: hand`, draw, `vno_asset_replace` each image; sprites transparent, bottom-aligned, any height up to the screen;
   backgrounds 1920x1080; cover portrait), and the guide resource served by the MCP server if it is generated from that file.
7. **Pixel resize** (user request): `buildImages` (`src/engine/renpy/images.ts`) resizes backgrounds and the cover (`gui/main_menu.png`)
   with `kernel: 'nearest'` when `art.style` is `pixel` (flag `pixel` in `BuildImagesInput`, set in `build.ts`), so pixel art is
   never blurred. Other projects keep the default kernel.

## Tests

- Unit tests next to the existing ones for generate/pipeline routing: in `hand` mode no ComfyUI client call happens for any
  image kind (use the existing comfy fake), music still generates, the step message counts the waiting images.
- `vno_asset_regen` / `vno_asset_generate` on an image in `hand` mode give the error; on music they work.
- Art step in `hand` mode makes no model call; `vno_plan` still does.
- Build with missing hand-made sheets does not count them as placeholders.
- Settings round trip: `provider: 'hand'` saved in `project.md`, cleared with `null`.
- Pixel project: `main_menu.png` and a background built from a small 2-colour image contain only those colours (non-pixel blends).
- Run the whole suite (`yarn test`) and the type check (`yarn typecheck` or the repo's equivalent) and lint, all green.

## Out of scope

- Restarting the running engine (the hub does that).
- A client-friendly Pixel Studio draw loop (ROADMAP item).

## Done when

All of the above is implemented with tests, the suite passes, and the work is committed on `VNO-07_hand-drawn-art` with
the repo's commit style (`VNO-07: ...`). Do not push or merge.

## Implementation status

- [x] Provider `hand` in `ART_PROVIDERS` (`src/shared/vn.ts`); new `isHandArt` and shared `IMAGE_KINDS`. Works for any `art.style`.
- [x] 1. Generate step: `dispatchGenerate` skips image assets in hand mode (music and voice as usual), step message ends with `; N image(s) wait for a hand-made file (vno_asset_replace)` (also on each bump); `generateJob` guard for stray image jobs; `regenerateAsset` and `vno_asset_generate` (kind/only naming an image) error telling to use `vno_asset_replace` (`assertNotHandImage` in service.ts, tools.ts); music works.
- [x] 2. Art step returns `hand-made art: no prompts planned` with no model call; music plan is a separate step, untouched. Explicit `vno_plan` and CLI `plan` pass `explicit: true` and still plan prompts and music.
- [x] 3. Build already ignored sheets (placeholders only for backgrounds, sprites, cover); added `summary()` change so a file-less sheet in hand mode is not counted in `assets.total/missing`; test added.
- [x] 4. Placeholders for missing hand-made images unchanged (tested).
- [x] 5. `vno_update_settings` (description, accepts `hand`/`null` via schema), CLI `--art-provider comfy|pixel-studio-draw|hand`, Look tab: "Hand-made (no ComfyUI)" in the pixel Sprites picker (cast fixed) and, for illustrated style, a new "Images" picker (ComfyUI / Hand-made).
- [x] 6. Docs: `docs/protocol.md` (Studios), `docs/mcp-guide.md` ("Hand-made art" section). The MCP guide resource is imported from `docs/mcp-guide.md` (`?raw`), so no copy to sync.
- [x] 7. Pixel resize with `nearest` kernel (see above).
- Tests: `tests/vn-hand-art.test.ts` (7), `tests/renpy-images-pixel.test.ts` (2). `yarn test`: 48 files, 567 tests passed; `yarn typecheck` and `yarn lint` exit 0.
- Review fix: the waiting-image count leaves out sheets (they are only a reference), matching `summary()`.
- Deviation: the empty-todo generate message in hand mode is `hand-made art: nothing to generate; N image(s) wait ...` instead of "every asset already has a file".
- Not done: engine not rebuilt or restarted (forbidden); Look tab not exercised in a browser.
