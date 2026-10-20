# VNO-05: Claude Code does the model work (provider kind `client`)

Status: **implemented, uncommitted** (2026-10-20). Live check (hub plan step 9) not done here.
Ticket folder: `.claude/tickets/VNO-05-client-provider/`. Branch: `VNO-05_client-provider`. Plan: `creative-hub/.claude/tickets/external-llm-jobs/plan.md` (VNO-05). Do not commit or push.

## Goal

A role, an agent or one project can be routed to the model `client/claude-code`. Its model calls wait in an in-memory queue until an MCP client takes them (`vno_get_task`) and answers (`vno_submit_task`). Everything above the provider is unchanged.

Done when:
- typecheck, lint and tests pass (`fnm exec --using=24 cmd /c "yarn ..."`).
- The tools, guide, README, seed and Models page are updated.
- (Hub, later) the live run with every role on client.

## Progress checklist
- [x] Provider: `models/client.ts` (`ClientTaskQueue`, `ClientProvider`, `checkAgainstSchema`, `DEFAULT_LEASE_MS`), kind `client` in `schemas.ts`, `registry.setupClient` (forces `local: true`, own queue when none is passed), `RequestMeta.job`, scheduler passes the job id.
- [x] Engine owns the queue (`engine.clientQueue`), passes it to the registry, `McpController` and stdio.
- [x] Tools `vno_client_tasks`, `vno_get_task`, `vno_submit_task`, `vno_release_task` (`mcp/tools-client.ts`); `callTool` can return image content (`ToolOutput`); `vno_status` has `clientTasks`.
- [x] `svc.waitIdle` returns `clientTasks` and does not block on parked jobs (`vno_wait`, `settle`, CLI says so).
- [x] Per-project models: `models` in project settings, `vno_update_settings {models}`, validated; first in the router candidates (`projectModel`), scheduler hook `projectModel`, cache in `ProjectStore` (warmed at start).
- [x] `model_order` keeps client refs first (`roleEntries`).
- [x] Docs: `docs/mcp-guide.md` ("Do the model work yourself"), `server.ts` INSTRUCTIONS, README, `seed/config/providers.md` (commented example + Client section), `ModelsPage.tsx`.
- [x] Tests: models, scheduler, mcp-http, vn-handlers (art plan + stage same files as the mock; waitIdle with clientTasks; per-project model).
- [ ] Live (orchestrator).

## Findings and deviations
- Role model choice in VN Studio: only the UI command `setRoleModel`, `config/roles.md` and `agents/<id>.md`; no MCP tool. No `set_model` tool added. Per-project `models` via `vno_update_settings` is the recommended route (orchestrator request), roles.md the global one.
- Schema check: no ajv; the small built-in check of the Scriptorium version (copied), exported as `checkAgainstSchema`. Note `z.toJSONSchema` lists defaulted fields as required, ; a required field that has a `default` is not reported as missing (ported from Scriptorium).
- `waitIdle` returns when no non-parked job runs and tasks exist for running jobs; `clientTasks` counts waiting plus leased. Queued jobs are not waited for.
- A parked job holds its agent (`max_parallel` 1 by default): documented in the guide.
- The pixel-studio draw loop uses the art-director role (`vn.assets.draw`); documented as out of scope. Not added to a ROADMAP (this repo has none; the hub ROADMAP is the orchestrator's).
- Test helpers: `TestProvider.kind/vision`, `makeVnEnv({client, mixed})`, `answerClientTasks`.
- Side fix note (jobs that need no model still wait for a slot) not changed.
