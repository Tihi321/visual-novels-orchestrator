# VNO-07 changelog

## 2026-10-20 - VNO-07: hand-made art mode (no ComfyUI) and nearest-neighbour resize for pixel builds

Repo `visual-novels-orchestrator`, branch `VNO-07_hand-drawn-art` (from `origin/master` 034de2c).

### Files
- `src/shared/vn.ts`: `ART_PROVIDERS` gains `hand`; new shared `IMAGE_KINDS` and `isHandArt` (any art style).
- `src/engine/vn/handlers.ts`: art step returns `hand-made art: no prompts planned` with no model call unless the job body has `explicit: true`; generate dispatch skips image assets in hand mode (music and voice still queue); step messages end with `; N image(s) wait for a hand-made file (vno_asset_replace)` (sheets not counted); a stray image generate job in hand mode returns without calling ComfyUI.
- `src/engine/vn/service.ts`: `assertNotHandImage` (used by `regenerateAsset`) refuses images in hand mode and points to `vno_asset_replace`; `summary()` does not count a file-less sheet in hand mode.
- `src/engine/mcp/tools.ts`: `vno_asset_generate` errors when `kind`/`only` names an image in hand mode; descriptions of `vno_update_settings`, `vno_asset_regen`, `vno_asset_generate` mention hand mode.
- `src/engine/mcp/tools-plan.ts`, `src/engine/vncli.ts`: explicit `vno_plan` / CLI `plan` pass `explicit: true` (prompts still planned in hand mode); CLI usage `--art-provider comfy|pixel-studio-draw|hand`.
- `src/renderer/ui/book/LookTab.tsx`: "Hand-made (no ComfyUI)" in the pixel Sprites picker; new "Images" picker (ComfyUI / Hand-made) for illustrated style.
- `src/engine/renpy/images.ts`, `src/engine/renpy/build.ts`: `buildImages` takes `pixel` (from `art.style === 'pixel'`); background and cover (`gui/main_menu.png`) resizes use `kernel: 'nearest'` for pixel projects.
- `docs/protocol.md` (Studios: settings, hand mode), `docs/mcp-guide.md` (new "Hand-made art" section; the MCP guide resource imports this file with `?raw`).
- Tests: `tests/vn-hand-art.test.ts` (7), `tests/renpy-images-pixel.test.ts` (2).

### Deviations
- Item 3: the build already ignored sheets; only the summary count changed, plus a test.
- In hand mode with nothing to queue, the generate message is `hand-made art: nothing to generate; N image(s) wait ...`.
- Item 7 (pixel resize with nearest kernel) was added mid-implementation at the user's request.
- Look tab: added an "Images" picker for illustrated style so hand mode is selectable for any style.

### Verification
- `yarn test`: 48 files, 567 tests passed.
- `yarn typecheck`: exit 0. `yarn lint`: exit 0.
- Not run: the Look tab in the app (only typecheck/lint); a live engine run (the running engine on port 7459 was not rebuilt or restarted, so it does not have these changes yet).

### Follow-ups
- Rebuild/restart the engine (hub) to pick up hand mode.
- A client-friendly Pixel Studio draw loop (ROADMAP).

Commit status: committed on `VNO-07_hand-drawn-art`, not pushed or merged.
