# VNO-05 changelog

## 2026-10-20: client provider (Claude Code does the model steps)

Branch `VNO-05_client-provider`, from origin/master c67409b. Uncommitted.

**What changed**
- **New provider kind `client`** (`src/engine/models/client.ts`, new; the same contract as Scriptorium SCP-08). A model request waits in the engine's `ClientTaskQueue` until an MCP client answers it. The answer is checked against the request's schema on submit. Images in messages are carried to the client. The task is leased for 30 minutes, and an abort drops it. It costs nothing and has no timeout.
- **Wiring:**
  - `shared/schemas.ts`, `models/types.ts`.
  - `models/registry.ts`: client refs go first under `model_order`.
  - `models/router.ts`: the project model goes first.
  - `queue/scheduler.ts`: the job id and a `projectModel` hook.
  - `engine.ts`: the queue goes to the registry, `mcp/controller.ts` and `mcp/stdio.ts`.
- **Per-project models:** `shared/vn.ts` adds settings `models`. In `vn/service.ts`, `updateSettings` validates the role and the ref, and `null` clears it. `vn/project.ts` caches the models.
- **MCP:**
  - New `mcp/tools-client.ts` with `vno_client_tasks`, `vno_get_task` (art-critic images go out as image content), `vno_submit_task` and `vno_release_task`.
  - `mcp/tools.ts`: `callTool` can return image blocks, `vno_status` and `vno_wait` gain `clientTasks`, and `vno_update_settings` takes `models`.
- **`waitIdle`** (`vn/service.ts`): returns when running jobs are only waiting on the client, with a hint. `vncli.ts` exits 1 in that case.
- **UI:** `ModelsPage.tsx` shows the client provider as local and free.
- **Docs:** `docs/mcp-guide.md` gets the section "Do the model work yourself". Also updated: the tools table, the `server.ts` INSTRUCTIONS, the README, and `seed/config/providers.md` (a commented example).

**Deviations**
- No `set_model` MCP tool. The global choice stays in `config/roles.md`, and the per-project `models` setting is the documented way.
- `ClientProvider` also derives images from the messages when the caller passes none.
- The Pixel Studio draw loop (`vn.assets.draw`) is out of scope. Its 240 s timeout breaks with a client model. This is documented.
- A parked job holds its agent (`max_parallel` 1). This is documented.

**Verification** (Node 24, fnm)
- `yarn test`: 45 files, 557 passed.
- `yarn typecheck`: ok.
- `yarn lint`: ok.
- Not run:
  - a live run against the hub's VN Studio (needs `hub.ps1 build vn-studio`, a restart and a reconnect)
  - the Models page in a window

**Follow-ups**
- Live run: a two-chapter `vno_create_project` with every role on `client/claude-code`, through to build and lint. Then commit and open a PR.
- Add the `client` provider to `~/VisualNovels/config/providers.md`.
- In the hub ROADMAP: a client-friendly draw loop, and no-op model jobs that still wait for a model slot.
