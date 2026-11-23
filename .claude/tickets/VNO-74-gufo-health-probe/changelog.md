# Changelog VNO-74

## 2026-11-23 VNO-74: Gufo is asked on its /health before it holds back ComfyUI

Branch `VNO-74_gufo-health-probe` (from master 35ed8da), repo visual-novels-orchestrator.

Files:
- `src/engine/studios/autostart.ts`: new `gufoAnswers` (GET /health 200 status ok, or 503 JSON body, or /v1/models 200 with an entry owned_by gufo; one 2000 ms budget for all requests); `defaultProbe` is exported and uses it for the entry `gufo` with no `http`; two comments updated. Strata, Llama.cpp, the holder loop and the reason text are unchanged.
- `tests/autostart.test.ts`: fixture constants and one new `it` (local HTTP server on port 0).
- `ROADMAP.md`: VNO-74 bullet after VNO-73.

Failing first (unchanged probe, only `export` added): `AssertionError: another program answering 200 text: expected true to be false` (tests/autostart.test.ts:330).

Verification: `npx vitest run tests/autostart.test.ts` 32/32; `yarn test` 89 files, 1158 tests passed; `yarn typecheck` exit 0; `yarn lint` exit 0.

Deviations: none.

UNTESTED: against a real Gufo on 8081; what Gufo's /health says during a load (assumed 503 JSON); whether a Gufo image server answers /health or /v1/models; the rebuilt `out/` (hub build after merge).

Commit: see git log on the branch (one commit).
