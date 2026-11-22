---
status: done
request: creative-hub/REQ-0030
repos: [visual-novels-orchestrator]
branch: VNO-70_small-ideas
updated: 2026-11-22
---

# VNO-70 `vno_comfy_free` on an empty reply, stale LM Studio embedding sentence, ROADMAP live-check facts

Hub ticket: creative-hub HUB-41 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-41-pixel-agent-and-small-ideas\plan.md`), request REQ-0030. The user said "new small ideas, build them now". Checked on master 2b6906b (2026-11-22).

## Scope

1. **`vno_comfy_free` fails on a good answer.** ComfyUI answers `POST /free` with HTTP 200 and an empty body (hub run log `C:\projects\Personal\creative-hub\runs\hub-39-vision-checks.md:72`: "lane error "Unexpected end of JSON input""). `freeMemory` (`src/engine/comfy/client.ts:175-182`) goes through `fetchJson` (`:114-128`), which ends with `await response.json()` (`:127`) and throws on an empty body. Its callers ignore the value: `freeAllLanes` (`src/engine/comfy/inventory.ts:139-150`, used by `vno_comfy_free` via `svc.comfyFree()`, `src/engine/vn/service.ts:1895`) and `freeBeforeDispatch` (`client.ts:487`, errors swallowed). Fix: `freeMemory` checks the status and does not parse the body.
2. **`seed/config/providers.md:245`** still says to keep the nomic embedding model loaded in LM Studio. LM Studio is not installed, VN Studio uses embeddings only in `engine probe` (`src/engine/cli.ts:62-72`), and no seed row is an embedding model (`:262` only documents `embedding: true`).
3. **ROADMAP facts from the hub run logs.** `ROADMAP.md:22` (VNO-68) says "Live check UNTESTED (hub K2)": K2 passed on 2026-11-22 (`runs/hub-39-vision-checks.md:21-40`), with three false sprite rejections for the grey backing. `ROADMAP.md:23` (VNO-69) says "Live check UNTESTED (hub N1)": N1 passed for the grey backing on 2026-11-22 (`runs/hub-40-extra-ideas.md:64-72`); the English-notes half was not exercised (the review approved).

## Out of scope

- Edu Studio's copy of `freeMemory` (same code, `edu-game-studio/src/engine/comfy/client.ts:175`): not in this ticket.
- `fetchJson` itself (every other caller expects JSON).
- The live data folder.

## Files to touch (verified)

**`src/engine/comfy/client.ts:174-182`**. Old:
```ts
/** Asks ComfyUI to drop cached models and free VRAM (weights stay on disk). */
export async function freeMemory(lane: string, timeoutMs = 30_000): Promise<unknown> {
  return fetchJson(`${lane}/free`, {
    method: 'POST',
    timeoutMs,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true })
  })
}
```
New:
```ts
/** Asks ComfyUI to drop cached models and free VRAM (weights stay on disk). ComfyUI answers 200 with an empty body. */
export async function freeMemory(lane: string, timeoutMs = 30_000): Promise<void> {
  const response = await fetchWithDeadline(`${lane}/free`, {
    method: 'POST',
    timeoutMs,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true })
  })
  if (!response.ok) throw new Error(`ComfyUI POST ${lane}/free failed: HTTP ${response.status}`)
}
```
(`fetchWithDeadline` is in the same file, `:96`.) The re-export `export { freeMemory }` (`src/engine/comfy/inventory.ts:153`) stays. `yarn typecheck` shows any caller that used the old `unknown` value (none found: `inventory.ts:144`, `client.ts:487` ignore it).

**`tests/comfy-client.test.ts`**: one test next to the lane tests (`:135-155`), using the file's `stubFetch` (`:17-30`):
"frees every lane on an empty 200 reply and reports a failing lane": `stubFetch` answers `POST /free` on `http://a:8188` with `new Response('', { status: 200 })` and on `http://b:8188` with `new Response('', { status: 500 })`; `await freeAllLanes({ lanes: ['http://a:8188', 'http://b:8188'] } as ComfyConfig)` (import `freeAllLanes` from `../src/engine/comfy/inventory`; build the config the way the other tests do, e.g. `parseComfyConfig`) equals `[{ lane: 'http://a:8188', ok: true }, { lane: 'http://b:8188', ok: false, error: expect.stringContaining('HTTP 500') }]`.

**`seed/config/providers.md:245`**. Old:
"- Strata takes most of the GPU memory with any of these models: keep only the nomic embedding model loaded in LM Studio, and no ComfyUI, while it runs. Only one local model is on the GPU at a time (gufo, strata and llama through the proxy included)."
New:
"- Strata takes most of the GPU memory with any of these models: no ComfyUI while it runs. Only one local model is on the GPU at a time (gufo, strata and llama through the proxy included)."

**`ROADMAP.md:22`**, end of the VNO-68 bullet. Old: "Live check UNTESTED (hub K2)." New: "Live check: hub K2 passed (2026-11-22: 5 of 5 valid verdicts on Inkling; the sprite was falsely rejected three times for its grey backing, fixed in VNO-69)."

**`ROADMAP.md:23`**, end of the VNO-69 bullet. Old: "Live check UNTESTED (hub N1)." New: "Live check: hub N1 passed for the grey backing (2026-11-22: `sprite_mara_neutral` approved on Inkling at the first review); English notes UNTESTED until a review rejects (hub HUB-41 K2)."

**`ROADMAP.md`**, a new bullet after `:23`:
"- **VNO-70** (2026-11-22, branch `VNO-70_small-ideas`; creative-hub HUB-41, REQ-0030): `vno_comfy_free` accepts ComfyUI's empty 200 reply to `/free` (it failed with "Unexpected end of JSON input"); the seed no longer says to keep the nomic model loaded in LM Studio. Live check UNTESTED (hub K2 ends with `vno_comfy_free`)."

## Tasks for workers

One task: the edits above and the one test. Commands (Bash; Node under fnm): `export PATH="/c/Users/Infplane/AppData/Roaming/fnm/aliases/default:$PATH"`, then in `C:\projects\Personal\visual-novels-orchestrator`: `yarn test`, `yarn typecheck`, `yarn lint`, `yarn build:engine`.

## Acceptance criteria

| # | criterion | proof |
|---|---|---|
| V1 | an empty 200 from `/free` is success; a 500 is a lane error | the new test in `tests/comfy-client.test.ts` |
| V2 | no LM Studio embedding advice in the seed | `grep -n "nomic embedding model loaded in LM Studio" seed/config/providers.md` prints nothing |
| V3 | ROADMAP rows carry the recorded live results; VNO-70 row added | `git diff master -- ROADMAP.md` |
| V4 | the rest green | `yarn test`, `yarn typecheck`, `yarn lint`, `yarn build:engine` exit 0 |

## UNTESTED

- `vno_comfy_free` against the real ComfyUI (hub HUB-41 K2 calls it at the end of the check, after `hub.ps1 build vn-studio` and a restart).
