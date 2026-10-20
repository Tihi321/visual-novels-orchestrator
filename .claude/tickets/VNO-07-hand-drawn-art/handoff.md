# VNO-07 handoff

- Branch `VNO-07_hand-drawn-art` (from `origin/master` 034de2c), committed, not pushed or merged.
- Done: plan items 1-8 (hand-made art provider `art.provider: hand`; nearest-neighbour resize and lossless WebP for pixel builds, so `config/renpy.md` `imageFormat` can stay webp for pixel games). Commits: 22851d2 (items 1-7), then item 8. See `plan.md` (Implementation status) and `changelog.md`.
- Verified: `yarn test` 48 files / 568 tests passed, `yarn typecheck` and `yarn lint` clean.
- Not verified: Look tab in the running app; a live pipeline run in hand mode.
- The running VN Studio engine (port 7459, `out/engine`) was not rebuilt or restarted, so it does not have these changes. To use hand mode in a production: merge, `yarn build:engine` and restart the engine through the hub (`scripts\hub.ps1`), then `vno_update_settings {slug, art: {provider: "hand"}}` and `vno_asset_replace` each image.
- Next: push and open a PR when the user asks; ROADMAP item for a client-friendly Pixel Studio draw loop.
