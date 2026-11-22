# Changelog

## 2026-11-22 VNO-70: vno_comfy_free accepts ComfyUI's empty 200 reply
Branch VNO-70_small-ideas, commit 3001105 (not merged, not pushed).
- src/engine/comfy/client.ts: freeMemory checks the HTTP status and does not parse the body (returns void).
- tests/comfy-client.test.ts: one test, empty 200 frees a lane, a 500 is a lane error.
- seed/config/providers.md: LM Studio nomic advice removed.
- ROADMAP.md: VNO-68/69 live-check results, VNO-70 row.
Verification: yarn test 1156 passed, yarn typecheck 0, yarn lint 0. Skipped: yarn build:engine (VN Studio running). Not run: real ComfyUI.
