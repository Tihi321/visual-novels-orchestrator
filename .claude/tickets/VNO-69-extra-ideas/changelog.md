# Changelog

## 2026-11-22 VNO-69 (REQ-0030 / HUB-40)
Outcome: the art-critic no longer judges a sprite's grey backing and answers in English; autostart skips ComfyUI while Gufo answers; wording and test URLs cleaned.

Repo visual-novels-orchestrator, branch `VNO-69_extra-ideas`:
- `seed/prompts/art-critic/review_image.md`: "plain light background" now only for a character sheet; a sprite line says the grey is not part of the picture; asks for `problems` and `revisedPrompt` in English.
- `src/engine/vn/agents/art-critic.ts`: doc comment only.
- `src/engine/studios/autostart.ts`: `GPU_HOLDERS` (Strata 8080, Gufo 8081); ComfyUI not started while either answers; Strata message unchanged.
- `src/renderer/ui/ModelsPage.tsx`: fallback help text names ACP proxy / acp, drops Strata's -low.
- `seed/config/providers.md`: Strata script path `D:\Strata\terminal`; LM Studio vision comment replaced by the Inkling note.
- `tests/autostart.test.ts`: Gufo case added to the existing test. `tests/custom-providers.test.ts`: sample port 7461 -> 8787.
- `ROADMAP.md`: VNO-69 row.

Deviations: none.
Verification (passed): yarn test (89 files, 1155 tests), yarn typecheck, yarn lint, yarn build:engine; greps A1, A4, A5 clean.
Not run: real sprite review on Inkling (hub N1); Models page in the running app; Gufo check against a real server.
Commit status: committed on branch, not merged or pushed.
