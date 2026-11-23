---
status: done
request: creative-hub/REQ-0031
repos: [visual-novels-orchestrator]
branch: VNO-74_gufo-health-probe
updated: 2026-11-23
---

# VNO-74 Gufo is asked on its /health before it holds back ComfyUI

Hub ticket: creative-hub HUB-44 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-44-pending-ideas\handoff.md`, item P-26, first part), request REQ-0031. Source of the facts: the Gufo probe P1 of 2026-11-23 (`C:\projects\Personal\creative-hub\runs\hub-44-pending-ideas.md`, section K8: `GET http://127.0.0.1:8081/health` -> 200 `{"status":"ok"}`). Same change, same wording, in edu-game-studio EGS-77 and cartoon-studio CTS-59. Every line number below was checked on master 35ed8da (2026-11-23).

## Rules for every worker

- Branch `VNO-74_gufo-health-probe`, cut from master 35ed8da. One worker. The worker does not commit; the orchestrator makes **one commit** after the checks: subject `VNO-74: Gufo is asked on its /health before it holds back ComfyUI`, written with a Bash heredoc (`git commit -F - <<'EOF'`), a blank line after the subject, last line `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. No push, no merge.
- VN Studio is **running from `out/`**: no `yarn build`, no `yarn build:engine`, no `yarn dev`, `yarn engine`, `yarn mcp` or `yarn dist*` on the branch (each of them builds `out/`). The hub rebuilds after the merge (`scripts\hub.ps1 build vn-studio`), not this ticket. Never touch VN Studio's data folder under `C:\Users\Infplane\` (`C:\Users\Infplane\VisualNovels`: projects, config and jobs) or the hub's `services.json`.
- Commands (verified in `package.json` scripts). In Bash, first: `export PATH="/c/Users/Infplane/AppData/Roaming/fnm/aliases/default:$PATH"` (`fnm exec yarn` fails). Run from `C:\projects\Personal\visual-novels-orchestrator`:
  - one file: `npx vitest run tests/autostart.test.ts`; all tests: `yarn test` (`vitest run`)
  - typecheck: `yarn typecheck`; lint: `yarn lint` (`eslint .`)
- Line endings: the working tree is **CRLF** (`src/engine/studios/autostart.ts` and `tests/autostart.test.ts` are CRLF, no `.gitattributes`, `core.autocrlf true`): keep CRLF, do not flip. Edit with the Edit tool; no Bash heredoc for code.
- Tests follow the global `test-discipline` skill: exactly one new `it` in the existing `tests/autostart.test.ts`, first **shown failing** on the unchanged probe, the failing line pasted into `changelog.md`.

## Scope (item, decision, verified cause)

| item | decision | cause, verified on 35ed8da |
|---|---|---|
| P-26 Gufo probed by a bare TCP connect | IN | Before it starts ComfyUI, `ensure` asks each GPU holder (`src/engine/studios/autostart.ts:340-348`): `GPU_HOLDERS` (`:28-32`) is Strata 8080 and Gufo 8081. The holder's registry entry is used when there is one (`:342`); the hub's `services.json` has a `strata` entry with `http: http://127.0.0.1:8080/health` but **no `gufo` entry**, so Gufo gets the fallback `{ id: 'gufo', port: 8081 }`, and `defaultProbe` (`:220-241`) has no `http` for it and does a TCP connect with a 1000 ms timeout (`:231-240`). Any program listening on 8081 therefore holds ComfyUI back with "ComfyUI not started: Gufo is running and uses most of the GPU". |
| Strata (8080) | NO CHANGE | Already an HTTP probe through its registry `http` (`:221-228`, 2000 ms, 2xx). |
| Llama.cpp (8082) | NO CHANGE | Not a GPU holder on purpose (`:28`, creative-hub HUB-39: Inkling runs beside ComfyUI). |

### The rule

Gufo (the fallback entry, id `gufo`, no `http`) holds the GPU when, within one 2000 ms budget for all its requests (the timeout the HTTP probe already uses, `:223`; it replaces the 1000 ms TCP connect for Gufo only):
1. `GET http://127.0.0.1:8081/health` answers **200** with a JSON body whose `status` is `"ok"` (recorded 2026-11-23), or
2. `GET /health` answers **503** with a JSON object body (a model is loading; see the assumption below), or
3. `/health` answered something else (for example 404), and `GET /v1/models` answers 200 with a JSON `data` array holding an entry with `owned_by: "gufo"` (recorded 2026-11-23 for the language model server; this covers a Gufo image server, which was not probed and may have no `/health`).

Everything else means "not Gufo" and ComfyUI autostart goes on: connection refused, the timeout, any other status, a body that is not JSON, a 200 `/health` with another `status`, a `/v1/models` without a `gufo` entry. A registry entry for `gufo` with its own `http`, if the hub ever adds one, keeps the plain HTTP probe (2xx), as Strata's.

### Assumption: Gufo while it loads a model (not recorded)

The probe ran only after the load, so what Gufo's `/health` says during a load is **not recorded**. Assumed: Gufo behaves like llama-server, whose `/health` answers 503 `{"error":{"code":503,"message":"Loading model","type":"unavailable_error"}}` while the model loads; or it does not listen yet. Chosen side: **hold ComfyUI back** (rule 2). Why that is the safe side: holding ComfyUI back by mistake costs a refused autostart with a clear reason, and the job fails or waits for a retry with nothing lost; starting ComfyUI beside a loading Gufo puts a 27B model and an image model in the same GPU memory, which can make the Gufo load or the picture fail out of memory. If Gufo does not listen at all during the load, no probe can see it (today's TCP connect cannot either), so nothing gets worse.

## Files to touch (verified)

**`src/engine/studios/autostart.ts`**:
- `:28` comment, append: "Gufo is asked on its own `/health` (`gufoAnswers`, creative-hub HUB-44 P-26), so another program on 8081 does not hold ComfyUI back."
- `:192` (`StarterDeps.probe` doc): "Default: GET of the entry's `http` (2xx); Gufo without a registry entry by `gufoAnswers`; else a TCP connect to its port."
- Before `defaultProbe` (`:220`), a new function:
  ```ts
  /**
   * Is Gufo the program on 127.0.0.1:<port>? (creative-hub HUB-44 P-26; recorded 2026-11-23: GET /health -> 200 {"status":"ok"}, GET /v1/models -> owned_by "gufo".)
   * True for /health 200 with JSON status "ok"; for /health 503 with a JSON body (a model loading, llama-server style: assumed, not recorded,
   * and the safe side: ComfyUI waits); or, when /health says anything else, for /v1/models 200 with an entry owned_by "gufo" (an image server,
   * not probed). Refused, timed out (2000 ms for all requests together) or any other answer: not Gufo.
   */
  async function gufoAnswers(port: number, timeoutMs = 2000): Promise<boolean> {
    const signal = AbortSignal.timeout(timeoutMs)
    const base = `http://127.0.0.1:${port}`
    const json = async (r: Awaited<ReturnType<typeof fetch>>): Promise<unknown> => {
      try {
        return await r.json()
      } catch {
        return undefined
      }
    }
    try {
      const health = await fetch(`${base}/health`, { signal })
      const body = await json(health)
      if (health.status === 200 && (body as { status?: unknown } | undefined)?.status === 'ok') return true
      if (health.status === 503 && typeof body === 'object' && body !== null) return true
      const models = await fetch(`${base}/v1/models`, { signal })
      if (models.status !== 200) return false
      const data = ((await json(models)) as { data?: unknown } | undefined)?.data
      return Array.isArray(data) && data.some((m) => (m as { owned_by?: unknown } | null)?.owned_by === 'gufo')
    } catch {
      return false
    }
  }
  ```
- `defaultProbe` (`:220`): `export const defaultProbe = ...` (exported for its test) with a doc line "Does the service answer? Exported for its test (VNO-74)."; after the `if (entry.http) { ... }` block (`:221-228`) and before `const port = entry.port` (`:229`), add `if (entry.id === 'gufo' && entry.port) return gufoAnswers(entry.port)`. The TCP path stays for every other entry without `http`.
- Nothing else: `GPU_HOLDERS`, the holder loop (`:340-348`) and the reason text stay as they are.

**`ROADMAP.md`**: a new bullet after `:27` (the VNO-73 bullet), in its style: "- **VNO-74** (2026-11-23, branch `VNO-74_gufo-health-probe`; creative-hub HUB-44, REQ-0031): ComfyUI autostart is held back for Gufo only when Gufo answers as Gufo (`/health` 200 `{"status":"ok"}`, 503 while a model loads, or `/v1/models` owned by gufo), not for any program on port 8081. Live check UNTESTED."

**`.claude/tickets/VNO-74-gufo-health-probe/changelog.md`** (new): files, the failing-first line, test counts, deviations, the UNTESTED list.

## Test fixture (the recorded bodies of 2026-11-23, no path, key or prompt in them; the 503 body is the assumed llama-server one)

Put these constants in `tests/autostart.test.ts` after `REGISTRY` (it ends at `:31`), with the comment `// Gufo 8081, recorded 2026-11-23 (creative-hub HUB-44 K8); the 503 body is llama-server's "Loading model" answer, assumed for Gufo.`:

```ts
const GUFO_HEALTH = '{"status":"ok"}'
const GUFO_NOT_FOUND = '{"error":{"message":"no route for this path","type":"invalid_request_error","code":"not_found"}}'
const GUFO_MODELS = '{"object":"list","data":[{"id":"Qwen3.8-27B","object":"model","created":1795421041,"owned_by":"gufo","context_length":32768,"architecture":{"input_modalities":["text","image"]}}]}'
const GUFO_LOADING = '{"error":{"code":503,"message":"Loading model","type":"unavailable_error"}}'
```

## Test (one new `it`, in the existing file)

**`tests/autostart.test.ts`**, in `describe('ensure', ...)` (`:214`), right after the GPU-holder test that ends at `:305`: `it('asks Gufo on its /health: another program on 8081 does not hold ComfyUI back (HUB-44 P-26)', ...)`. Imports: `import http from 'node:http'` and `import type { AddressInfo } from 'node:net'` at the top; add `defaultProbe` to the value import at `:7`.

Body (a real HTTP server on `127.0.0.1:0`, closed at the end; no real Gufo, no real 8081):
```ts
let mode: 'other' | 'ok' | 'loading' | 'image' | 'llama' = 'other'
const server = http.createServer((req, res) => {
  const send = (status: number, body: string, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type })
    res.end(body)
  }
  if (mode === 'other') return send(200, 'hello', 'text/plain')
  if (req.url === '/health') return mode === 'ok' ? send(200, GUFO_HEALTH) : mode === 'loading' ? send(503, GUFO_LOADING) : send(404, GUFO_NOT_FOUND)
  if (req.url === '/v1/models') return send(200, mode === 'image' ? GUFO_MODELS : GUFO_MODELS.replace('"gufo"', '"llamacpp"'))
  send(404, GUFO_NOT_FOUND)
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const gufo = { id: 'gufo', port: (server.address() as AddressInfo).port } as RegistryEntry
try {
  expect(await defaultProbe(gufo), 'another program answering 200 text').toBe(false)
  mode = 'ok'
  expect(await defaultProbe(gufo), 'the recorded /health').toBe(true)
  mode = 'loading'
  expect(await defaultProbe(gufo), 'a model loading (503 JSON)').toBe(true)
  mode = 'image'
  expect(await defaultProbe(gufo), 'no /health, /v1/models owned by gufo').toBe(true)
  mode = 'llama'
  expect(await defaultProbe(gufo), 'no /health, /v1/models of another server').toBe(false)
} finally {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
expect(await defaultProbe(gufo), 'nothing on the port').toBe(false)
```

Failing first: step 1 only adds `export` to `defaultProbe` (no other change), then the test runs and fails on its first assertion ("another program answering 200 text: expected true to be false", the TCP connect succeeds); paste that line. Step 2 makes the change; the test passes. The existing GPU-holder test (`:295-305`, faked `probe`) must still pass unchanged.

## Tasks for workers

| worker | files (only these) | outputs |
|---|---|---|
| one | `src/engine/studios/autostart.ts`, `tests/autostart.test.ts`, `ROADMAP.md`, `.claude/tickets/VNO-74-gufo-health-probe/changelog.md` | P-26 for VN Studio |

Order: fixture and test; `export` only; run `npx vitest run tests/autostart.test.ts` and paste the failure; the change; the file passes; `yarn typecheck`, `yarn lint`, `yarn test` (all green; a lint finding in a changed file is fixed, others are only reported); ROADMAP; changelog. Report: files changed, the failing line, pass counts, deviations. The orchestrator reruns the three commands, reads the diff, commits once.

## Acceptance criteria

| # | criterion | proof |
|---|---|---|
| V1 | a program on Gufo's port that is not Gufo does not hold ComfyUI back | the "another program" and "another server" assertions |
| V2 | Gufo's recorded `/health`, a loading 503 with JSON, and a `/v1/models` owned by gufo hold ComfyUI back | the three `true` assertions |
| V3 | refused connection means not Gufo; one 2000 ms budget for all of Gufo's requests | the "nothing on the port" assertion; code review of `gufoAnswers` |
| V4 | Strata's probe, Llama.cpp's exclusion, the reason text and the registry path are unchanged | diff limited to `gufoAnswers`, the `export`, one line in `defaultProbe` and two comments; the existing GPU-holder test passes |
| V5 | nothing else breaks | `yarn typecheck`, `yarn lint`, `yarn test` |

## UNTESTED

- Against a real Gufo on 8081 (needs a Gufo load through the proxy, a GPU switch of minutes, and the user's go-ahead): VN Studio's ComfyUI autostart refused with "Gufo is running"; and with Gufo stopped and another program on 8081, ComfyUI started.
- What Gufo's `/health` says during a load (assumption above), and whether a Gufo image server answers `/health` or `/v1/models` (rule 3 is a guess from the language-model server).
- The rebuilt `out/` (the hub's `hub.ps1 build vn-studio` after the merge).
