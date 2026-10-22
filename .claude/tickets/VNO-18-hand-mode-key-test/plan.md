# VNO-18: Hand-mode test for `key` background removal on import

Part of `.claude/tickets/VNO-17-18-roadmap-tasks/plan.md` (task 2). Branch `VNO-17-18_roadmap-tasks`.

## Why

VNO-08 phase 7 planned a hand-mode test where `vno_asset_import` cuts a sprite out with the flat-colour `key` and never calls ComfyUI. `tests/vn-hand-art.test.ts` got the CG part only. ROADMAP "Tests", second item. (`tests/assets-import.test.ts` checks the service call `importAsset` in hand mode, not the MCP tool in the hand-art suite.)

## What

In `tests/vn-hand-art.test.ts`, for both art styles (`illustrated`, `pixel`): an opaque sprite on a plain background imported with `vno_asset_import` and no `removeBackground` comes out with a transparent corner and an opaque figure, as one locked `custom:import` version. Neither `comfy.removeBackground` nor `comfy.generate` is called. An explicit `removeBackground: "birefnet"` still asks ComfyUI (only when told to).

## Acceptance

The test passes; `yarn test`, `yarn typecheck`, `yarn lint` exit 0.
