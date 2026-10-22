# VNO-18 changelog

## 2026-10-22: hand-mode test for `key` background removal on import

Branch `VNO-17-18_roadmap-tasks`. Test only; no source change.

**Files**
- `tests/vn-hand-art.test.ts`: `vno_asset_import cuts a sprite out with the flat-colour key, never with ComfyUI`, for `illustrated` and `pixel`. An opaque sprite imported with no `removeBackground` comes out with a transparent corner and an opaque figure, as locked version 1 (`custom:import`); `comfy.removeBackground` and `comfy.generate` are never called. `removeBackground: "birefnet"` calls the removal once.

**Verification**
- `yarn test`: 56 files, 741 passed (739 after VNO-17).
- `yarn typecheck`, `yarn lint`: exit 0.
