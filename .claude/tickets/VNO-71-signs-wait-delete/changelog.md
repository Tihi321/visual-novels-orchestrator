# Changelog

## 2026-11-22 VNO-71: revised prompts without text negations, vno_wait max 240 s, delete removes job files
Branch `VNO-71_signs-wait-delete` (from master). Committed (not merged, not pushed).
- `src/engine/assets/derive.ts`: new pure `stripTextNegations`.
- `src/engine/vn/handlers.ts`: revised prompt is stripped before redraw (see Polish 1 for the empty-result case).
- `seed/prompts/art-critic/review_image.md`: critic told not to write negations.
- `src/engine/mcp/tools.ts`: `vno_wait` default and max 240 s.
- `src/engine/vn/service.ts`: `deleteProject` removes queued, done and failed job files of the slug.
- `docs/mcp-guide.md`, `ROADMAP.md`: updated. Lines 9 and 181 of the guide name no timeout, so unchanged.
- Tests: 3 (derive, mcp-http, vn-interfaces).
Verification: `yarn test` 89 files / 1157 tests pass (first run had one timeout in vn-pack-editions under load, passed alone), `yarn typecheck`, `yarn lint` clean. Build skipped (VN Studio running). Live check UNTESTED.

## Polish 1

- `src/engine/vn/handlers.ts`: the earlier fallback to the original revised prompt (when stripping left nothing) was a mistake in the brief, not a plan deviation: a negation-only prompt was sent as the positive prompt. Now `revised` is the stripped string, and an empty result is falsy, so the existing `!revised` branch ends the retries and keeps the best earlier version. No new test (the `stripTextNegations` test already covers `'no text, no letters'` giving `''`).
- `ROADMAP.md`: the VNO-71 row moved from "Later (not planned yet)" to directly after the VNO-70 bullet in the tasks list, text unchanged.
