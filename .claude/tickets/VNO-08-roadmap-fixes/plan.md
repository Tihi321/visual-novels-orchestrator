# VNO-08: Roadmap fixes (VN Studio)

Repo `C:\projects\Personal\visual-novels-orchestrator`. Branch `VNO-08_roadmap-fixes`, cut from `master` (clean, 414b743). Ticket folder `.claude/tickets/VNO-08-roadmap-fixes/`: save this file there as `plan.md`, and keep a `changelog.md` in the style of VNO-05/07 (files, deviations, verification, commit status). Commit after each phase as `VNO-08: <what>`, ending with the attribution line from the session. Do not push or merge.

## Ground rules

- **Node.** Load it in PowerShell with `fnm env --use-on-cd | Out-String | Invoke-Expression`. Checks: `yarn test`, `yarn typecheck`, `yarn lint`.
- **Do not run `yarn build:engine`, `yarn engine`, `yarn dev` or `yarn build`.** The hub starts VN Studio from this repo's `out/engine/index.js` (`creative-hub/services.json`). Rebuilding `out/` from the feature branch would change what the hub runs at its next restart. Do not stop the engine on port 7459.
- **Never write to `~/VisualNovels`.** Tests use temp folders (`mkdtemp`), as the existing tests do.
- **Ren'Py lint** comes from `tests/renpy-integration.test.ts`. It builds fixtures and runs the real `renpy.exe lint` when the SDK is at `C:/projects/Local/renpy/renpy-8.5.3-sdk` (`DEFAULT_SDK_PATH`, or `VNO_RENPY_SDK`), and is skipped otherwise. Every phase that changes the build adds a fixture case there.
- **Seed changes reach existing data folders by themselves.** `store/seedRefresh.ts` hash-updates untouched seed files. A seed file the user edited gets the X3 migrations (Phase 1).
- **Docs.** `docs/mcp-guide.md` is also the MCP guide resource (imported with `?raw`), so update it, plus `docs/protocol.md` and the `server.ts` INSTRUCTIONS when tools change.

## Status of every item (checked on master)

| Item | Status on master | Phase |
|---|---|---|
| X1 prompt sent twice | Open: `mcp/tools-client.ts:29` | 1 |
| X2 client `context` | Open (seed only). VN Studio sizes nothing by `context`: there is no 8,192 default in this repo. The client entry is commented out in the seed and has no `context`. | 1 |
| X3 client provider in old data folders | Open: an edited `providers.md` is never touched (`seedRefresh.ts` "keep") | 1 |
| V0 languages leftovers | Open: UI strings exist only for `hr`, no per-language font, no RTL mirroring | 4 |
| V1 asset kinds | Open | 6 |
| V2 external import | Open | 5 |
| V3 restart needed | Operational. The running engine is older than VNO-07: its `vno_update_settings` description does not mention `hand`. | 7 (verify) |
| V4 non-Latin titles | Open, and worse than reported: `normText` drops non-Latin letters, so Cyrillic or CJK bibles match no speaker or place. | 3 |
| V5 studio tokens | Open: `studios/mcp-http.ts:49` sends no `Authorization` header | 1 |
| V6 parked client job holds its agent | Open: `scheduler.ts:359` | 2 |
| V7 names read as cast | Open: `vn/script.ts:240-260`, `:104-119`; `fixes.ts:157-170` | 3 |
| V8 aliases | Open: no `aliases` field, `bible.ts:75-80` | 3 |
| V9 portrait cover | Open: `derive.ts:86,225`, `handlers.ts:334`, `generate.ts:331` | 5 |
| V10 sheet regen after sprites | Open: `service.ts:858-868`, `scheduler.ts:288` | 2 |
| V11 stop/resume and stylePrompt | Open: `tools.ts:339-350`, `engine.ts:223-233`, `handlers.ts:236`, `art-director.ts:128` | 2 |
| V12 per-project model unused | Root cause found (see Phase 1) | 1 + 2 |
| V13 draw loop and client | Open: `studios/draw.ts:63-71` | 5 |
| V14 no image path without ComfyUI | Fixed by VNO-07 (verified, see Phase 7) | 7 |
| V15 menu image | Nearest kernel fixed by VNO-07 (`images.ts:120,155`); the portrait crop is still open (`images.ts:155-157`) | 5 |
| V16 lossless WebP for pixel art | Fixed by VNO-07 c23bfb3 (verified) | 7 |
| V17 analysis adds assets after the art | Open: `fixes.ts:83-85,103-123,138-145`, `script-analyst.ts:138-143` | 3 |
| V18 no-op model jobs wait for a slot | Open: `scheduler.ts:303-338` | 2 |

## Phase order and parallelism

```
P1 (client, seeds, keys, tokens)  ||  P4 (languages: ui, fonts, RTL)
            |
P2 (scheduler and queue)
            |
P3 (import and analysis: translit, cast, aliases, existing art)  ||  P5 (asset import, cover, draw)
            |
P6 (asset kinds: CG, SFX, ambience, scene music, expression sets)
            |
P7 (docs, verify-only items, final run)
```

- **P1 and P4 touch different files.** P4 puts its one new tool in a new file, `mcp/tools-lang.ts`. They can run in parallel.
- **P2 needs P1 first.** Both edit `service.ts`, `tools.ts` and `router.ts`.
- **P3 and P5 can run in parallel.** Each touches a different part of `handlers.ts`: P3 the analyse handler, P5 `generateOne` and the comfy voice loop. Expect one small merge there. P5 needs P2's `JobContext.model`.
- **P6 comes after P3, P4 and P5.** It touches `shared/vn.ts`, `script.ts`, `fixes.ts`, `derive.ts`, `generate.ts`, `build.ts`, `images.ts` and `emit.ts`, which those phases change.

---

## Phase 1: client provider, seeds, keys, studio tokens (X1, X2, X3, V12 part 1, V5)

### X1. Every client task sends the prompt twice

- **Root cause.** `taskView` (`src/engine/mcp/tools-client.ts:19-37`) always returns `system` and `user`, plus `messages` when `t.messages.length > 1` (line 29). Every task has a system and a user message, so the whole prompt goes out twice.
- **Fix.** Count the turns:

  ```ts
  const userTurns = t.messages.filter((m) => m.role === 'user').length
  const multi = userTurns > 1 || t.messages.some((m) => m.role === 'assistant')
  ```

  - Single turn: send `system` and `user`, with no `messages`.
  - Multi-turn (a repair round, the draw loop): send `system` and `messages` (the non-system turns, in order), with no `user`. Each text is sent once.
  - Add `turns: 'single' | 'multi'` to the view so the client knows which shape it got.
  - Update the `vno_get_task` description and the guide section "Do the model work yourself".
- **Files.** `src/engine/mcp/tools-client.ts`, `docs/mcp-guide.md`.
- **Tests.** In `tests/mcp-http.test.ts`:
  - The vision test (2 system messages and 1 user message) expects `messages` to be undefined and `user` set.
  - New: a task with a user, an assistant and a user turn gives `messages` (3 entries) and no `user`.
  - New: a single-turn task's JSON is smaller than the sum of its parts twice over (it contains the user text exactly once).

### X2. Client context in the seed

- **Status.** VN Studio never sizes anything by `context`; `registry.ts` only stores it.
- **Fix.** In `seed/config/providers.md`, replace the commented `# - id: client` block at the end of the frontmatter with a live entry. It is harmless while no role, agent or project names it:

  ```yaml
  - id: client
    kind: client
    local: true
    concurrency: 8
    models:
      - id: claude-code
        vision: true
        context: 200000
  ```

  Update the "Client" section of the seed body: it is on by default, and you still pick it per role or project. Update the README's providers note.
- **Tests.** In `tests/models.test.ts`, the seed `providers.md` parses, `client/claude-code` resolves with `context` 200000, and no role resolves to it.

### X3. Migration for missing seed entries

- **Root cause.** `initDataFolder` (`store/dataFolder.ts:110-128`) calls `syncSeedFile`. For a file the user edited, `planSeedFile` returns `keep` (`seedRefresh.ts:206-210`), and nothing new is ever added to it.
- **Fix.** A new `src/engine/store/seedMigrations.ts` holds a list of one-time, additive migrations, applied after `copyTree` in `initDataFolder`.
  - **Bookkeeping.** `SeedState` gets `migrations: string[]` (the ids already applied, saved in `.seed-hashes.json`), and `InitResult` gets `migrated: string[]`. A migration records its id once it ran, even when it changed nothing, so an entry you delete later never comes back.
  - **How a migration edits a file.**
    - Split the file with `splitFrontmatter` (`shared/md.ts`) and keep the body byte for byte.
    - Edit the frontmatter with `yaml`'s `parseDocument`, which keeps comments, and write it back with `atomicWrite`.
    - A file that is missing or does not parse is skipped and not recorded, so the migration runs again at the next start.
  - **`providers-client-v1`.** If no provider has `kind: client` or `id: client`, append the seed's `client` entry (read from the seed file's frontmatter) to `providers`.
  - **`providers-client-context-v1`.** Every model of a `kind: client` provider that has no `context` gets `context: 200000`. Existing values are never changed.
  - The list is open for later additive migrations (same shape: id, file, apply). The migrations never overwrite a value, only add a missing entry or field.
  - The engine logs `initDataFolder`'s `migrated` the same way it logs `updated`.
- **Files.** `src/engine/store/seedMigrations.ts` (new), `src/engine/store/dataFolder.ts`, `src/engine/store/seedRefresh.ts` (state shape; `loadSeedState` defaults `migrations: []`), the engine start log line.
- **Tests.** New `tests/seed-migrations.test.ts`:
  - An edited `providers.md` without a client entry gets one appended. Its comments, the other providers and the body are unchanged.
  - A client entry without `context` gets 200000; one with `context: 50000` keeps it.
  - Delete the client entry after the migration, run init again: it is not re-added.
  - A file with bad YAML is left alone and the migration is not recorded.
  - An untouched (seed-hash) file is simply updated by the seed refresh, and the migration then makes no change.

### V12 (part 1). Per-project models not used for analysis

- **Root cause.**
  - `vno_update_settings {models}` checks only that the model exists. `service.ts:520-524` uses `registry.getModel(full)`, which returns models of unavailable providers too.
  - When the job is routed, `ModelRouter.candidates` (`router.ts:91-101`) silently drops a model whose `provider.available` is false.
  - A provider is unavailable when its key cannot be found (`registry.ts:296-300`). Keys are looked up in the environment, then in the Windows credential store under service **`vn-studio`** (`models/keys.ts:4,55-59`).
- **Evidence (read-only).**
  - `~/VisualNovels/projects/the-clockless-god-{2,3}/project.md` set `script-analyst`, `composer` and `stage-director` to `deepseek/deepseek-flash`.
  - In `logs/agents/*.md`, every later job's "first model" is `strata/...` or `lmstudio/...` (for example the composer job at 17:09, after `project.md` was written at 12:04). DeepSeek appears in no VN Studio job, log or spend row.
  - `DEEPSEEK_API_KEY` is not set in the user or process environment.
  - So the provider has no key in VN Studio: Scriptorium keeps its keys under its own service `scriptorium`. The setting was accepted, then dropped without a word.
- **Fix.**
  1. **`updateSettings`** (`service.ts:510-540`) still saves the model, but collects a warning when `!m.provider.available`, for example `deepseek/deepseek-flash: provider deepseek is not available (no key (set DEEPSEEK_API_KEY or run: npm run key:set DEEPSEEK_API_KEY)); jobs of script-analyst will use the role's list`. It returns `{ settings, warnings }`. The service API changes, so update the `vno_update_settings` tool, `vncli` and the renderer handler (look for `updateSettings(` callers).
  2. **Router.** A new `whyUnusable(ref, { visionOnly }): string | null` returns one of: unknown model, provider disabled, no key, server down, daily limit used up, not a vision model, embedding model.
  3. **`vno_status` and `vno_get_project`** show `models: { [role]: { ref, usable: boolean, reason? } }` for the project's models.
  4. **Shared keys** (user decision 1, default on). `resolveKey` falls back to the credential-store services `scriptorium` and `book-translator` after `vn-studio`. `VNO_SHARED_KEYS=0` turns it off. The Models page and logs say where a key came from (`key from the scriptorium credential store`), never its value.
- **Files.** `src/engine/vn/service.ts`, `src/engine/models/router.ts`, `src/engine/models/keys.ts`, `src/engine/mcp/tools.ts` (`vno_update_settings` and `vno_status` output), `src/engine/vncli.ts`, `src/renderer` call sites only if types break.
- **Tests.**
  - `tests/models.test.ts`:
    - `whyUnusable` gives "no key" for a keyless openai-compat provider, and "server down" after `markDown`.
    - `resolveKey` falls back to a second service, using an injected getter. Refactor `resolveKey` to take a `getStoredKey` dependency for the test.
    - `VNO_SHARED_KEYS=0` disables the fallback.
  - `tests/vn-plan-tools.test.ts` or `tests/vn-handlers.test.ts`: `vno_update_settings {models: {"script-analyst": "nokey/m"}}` saves the model and returns a warning naming the key variable.

### V5. Studio tokens

- **Root cause.** The MCP HTTP client (`studios/mcp-http.ts:48-51`) builds headers without `Authorization`. `studiosConfigSchema` (`studios/config.ts:15-30`) has no token. Pixel Studio and Chiptune Studio accept a bearer token from `PIXEL_STUDIO_MCP_TOKEN` / `CHIPTUNE_STUDIO_MCP_TOKEN` (`pixel-art-generator/src/main/index.ts:78`, `midi-generator/src/main/headless.ts:53`).
- **Fix.**
  - `McpHttpOptions.token?: string | null`. When set, send `Authorization: Bearer <token>` on every POST.
  - A 401 answer becomes `McpHttpError` with kind `http` and the message `<label> rejected the token: set <VAR> to the token shown in its Settings -> MCP`.
  - Token resolution, first match wins:
    1. the env var `PIXEL_STUDIO_MCP_TOKEN` / `CHIPTUNE_STUDIO_MCP_TOKEN`;
    2. the credential store through `resolveKey`, same account names;
    3. the optional `pixelStudioToken` / `chiptuneStudioToken` in `config/studios.md` (default `''`).
  - VibeTTS: if its config has a URL-based client built on `createMcpClient`, add `VIBETTS_MCP_TOKEN` the same way. Otherwise leave it.
  - Document the token fields in the `seed/config/studios.md` body.
- **Files.** `src/engine/studios/mcp-http.ts`, `src/engine/studios/config.ts`, `src/engine/studios/pixel.ts`, `src/engine/studios/chiptune.ts`, `seed/config/studios.md`.
- **Tests.** In `tests/studios-clients.test.ts`, with the fake fetch:
  - The header is sent when a token is configured and absent when not.
  - A 401 gives the token message.
  - Precedence: env, then config.

**Phase 1 acceptance.** `yarn test`, `yarn typecheck` and `yarn lint` pass. Commit `VNO-08: Client task shape, client seed and migration, model warnings, studio tokens`.

**Phase 1 notes (done).**
- Baseline before the ticket: 568 tests (one run of the full suite had a 15 s timeout in the first test of `vn-handlers.test.ts` under load; it passes alone). Typecheck and lint clean.
- Final: 583 tests in 49 files, typecheck and lint clean. The Ren'Py integration describe ran (no skipped tests).
- Deviations: `vno_status` and `vno_get_project` add `models` in the tool output only (not in `ProjectDetail`). VibeTTS got a `vibettsToken` field in `config/voice.md` next to `VIBETTS_MCP_TOKEN`. `ProviderSummary.keyFrom` and the Models page tooltip say where a shared key came from, and the engine logs `provider <id>: key from <store>` at start. The migration records its id also when the seed has no client entry (the file in the seed folder is the source).

---

## Phase 2: scheduler and queue (V6, V18, V10, V11, V12 part 2)

### V6. A parked client job holds its agent

- **Root cause.** `pickAgent` (`scheduler.ts:353-371`) skips an agent when `rt.running.size >= def.data.max_parallel` (line 359). A job that waits in the client queue counts as running, so a role with `max_parallel: 1` answers one client task at a time.
- **Fix.**
  - A private `occupying(rt)` counts the running jobs whose current model (`rj.model`) is not on a `kind: client` provider (`this.d.router.registry.getModel(rj.model)?.provider.kind`). Jobs with no model count as occupying.
  - Use `occupying` for the `max_parallel` check and for the `load` sort.
  - The client provider's `concurrency` (the limiter slot every job takes in `tickOnce`) stays the cap on parked jobs. Seed 8, documented.
  - The agent's shown state remains the last launched job.
  - Graceful fire still waits for every running job.
- **Files.** `src/engine/queue/scheduler.ts`, `docs/mcp-guide.md` ("Do the model work yourself": remove the "hire more agents" advice).
- **Tests.** In `tests/scheduler.test.ts`, with a client provider (concurrency 4) and one agent at `max_parallel: 1`:
  - Three jobs all park as client tasks, without waiting for each other.
  - With a non-client model, only one runs.
  - With client concurrency 2, only 2 park.

### V18. Model jobs that do no model work still wait for a model slot

- **Root cause.** In `tickOnce` (`scheduler.ts:300-338`), every job whose handler is not `noModel` has to win a provider slot (`limiter.hasCapacity` / `tryAcquire`) before it starts. These handlers return without calling a model:
  - analyse with 0 items (`handlers.ts:141-142`);
  - stage with `byHand` cues (`:492-498`);
  - art plan in hand mode (`:220`);
  - music plan with no tracks (`:247`);
  - edition align with nothing left (`:194-196`);
  - voice plan with voice off (`:537`);
  - a review of a locked, custom or missing file (`:443-444`).

  When Strata is down or the client queue is full, they wait anyway.
- **Fix.**
  - **New handler option.** `HandlerOptions.skipModel?: (job: JobFile) => Promise<boolean>`: a cheap check that says the job will need no model.
  - **Scheduler.** In `tickOnce`, when `skipModel` returns true (an error counts as false), claim the job and launch it like a `noModel` job, flagged `lazy`.
  - **`ctx.chat` on a lazy job** (the files changed between check and run) does not throw. It gets a slot itself:
    - compute `modelsFor(rj)`;
    - apply the same paid-over-budget skip;
    - poll `limiter.tryAcquire` every 500 ms until it wins, honouring the abort signal;
    - from then on it runs as a leased job. Make `leased` a mutable variable in `run()`.
  - **Predicates in `handlers.ts`** (pass `skipModel` through `reg` opts):
    - analyse: `loadUncertain(slug)` is empty;
    - stage: `cues.json` has `byHand`;
    - artPlan: hand art and not `explicit` in the body;
    - musicPlan: `settings.music.tracks <= 0`;
    - editionAlign: no report, or no missing and no extra;
    - voicePlan: voice is off;
    - review: the asset is locked, custom or has no file;
    - draw: the asset has a file and the body has no `force`.
- **Files.** `src/engine/queue/scheduler.ts`, `src/engine/vn/handlers.ts`.
- **Tests.**
  - `tests/scheduler.test.ts`: a `skipModel` job runs while the only provider has 0 capacity. A lazy job that calls `ctx.chat` waits for capacity, then runs on the first candidate.
  - `tests/vn-handlers.test.ts`: analyse with no items and stage with `byHand` cues finish while the role's only model is a down provider (or a client queue nobody answers).

### V10. A regenerated sheet runs after its sprites

- **Root cause.**
  - Jobs run oldest first (`scheduler.ts:288`).
  - `regenerateAsset` (`service.ts:858-868`) enqueues the sheet job with a new run number, and nothing links it to sprite jobs already queued.
  - `dispatchGenerate` links a sprite only to the sheet job of the same dispatch (`handlers.ts:421-425`).
- **Fix.**
  1. **Sheet regen.** In `regenerateAsset`, when the asset is a sheet, add the new job id to `depends_on` of every queued `vn.assets.generate` / `vn.assets.draw` job of the project whose unit is a sprite with `refs[0] === id` (`jobs.update('queued', ...)`).
     - Add `sprites?: boolean` (MCP `vno_asset_regen {sprites}`). When true, also enqueue a forced regen of every unlocked, generated sprite of that sheet, each depending on the sheet job, then one build that depends on all of them.
     - Without `sprites`, list the sprites already made from the old sheet as `staleSprites` in the result.
  2. **Sprite regen.** In `regenerateAsset` and `dispatchGenerate`, a sprite job also depends on any queued or running generate job of its sheet from another run.
  3. Explicit jobs get a priority (V11). Ordering itself stays dependency-based.
- **Files.** `src/engine/vn/service.ts`, `src/engine/vn/handlers.ts` (`dispatchGenerate`), `src/engine/mcp/tools.ts` (`vno_asset_regen` gets `sprites` and returns `staleSprites`), `src/engine/vncli.ts` (`asset regen --sprites`).
- **Tests.** In `tests/vn-pipeline.test.ts` or a new `tests/vn-queue.test.ts`:
  - With two queued sprite jobs of `sheet_mara`, `vno_asset_regen sheet_mara` gives both of them a dependency on the regen job. With a fake comfy, the sheet's new version is made before either sprite (check the call order).
  - `sprites: true` enqueues the sprite regens after the sheet.

### V11. Stop/resume restarts the old queue; a plan waits behind it; stylePrompt has no effect on queued jobs

- **Root cause.**
  - `vno_stop_now` (`tools.ts:347-350`, `engine.ts:229-232`) pauses and aborts. Aborted jobs are requeued (`scheduler.ts:574`), and `vno_resume_all` runs them again, oldest first, ahead of a `vno_plan` asked for in between (`tools-plan.ts:48-50`, enqueued later).
  - The style words are baked into each stored prompt (`handlers.ts:236` fallback, `art-director.ts:128`). `generateAsset` uses the stored prompt (`generate.ts:190`), and `updateSettings` never rewrites prompts.
- **Fix.**
  1. **Job priority.**
     - `jobSchema` (`shared/schemas.ts:164-194`) gets `priority: z.number().int().default(0)`.
     - The scheduler sorts by priority (descending), then `created`, then id.
     - `svc.enqueue` takes `priority`. MCP and UI explicit requests use 1: `vno_plan`, `vno_asset_regen`, `vno_asset_generate`, `vno_build`, `vno_lint`, `vno_voice_plan`, `vno_voice_generate`, `vno_add_edition`. Pipeline chain jobs keep 0. Dependencies still gate.
  2. **Dropping the queue.**
     - `vno_stop_now {drop?: boolean, slug?: string}`. With `drop`: pause, `stopAll('stopNow')`, `await scheduler.drain()`, then `svc.clearQueue(slug ?? null)`.
     - `clearQueue` deletes the queued job files of that project (or all), the same way `deleteProject` does (`service.ts:570-572`), and sets every `queued` or `running` step in `pipeline.json` to `skipped` with `dropped (vno_stop_now)`.
     - A new `vno_clear_queue {slug?, confirm: true}` drops queued jobs without stopping running ones.
     - `mcpControl()` (`engine.ts:223`) gets `clearQueue`.
     - Default `drop: false` keeps today's behaviour (user decision 8).
  3. **Restyle on a style change.**
     - In `updateSettings`, when `resolveStylePrompt(book, old) !== resolveStylePrompt(book, new)`, call `svc.restylePrompts(slug, oldPrefix, newPrefix)`.
     - It covers every image asset (background, sheet, cover, and later `cg`) with no versions, not locked and `source === 'generated'`, including prompts set by hand: if the prompt starts with `styleForKind(oldPrefix, kind)`, swap in `styleForKind(newPrefix, kind)`. Sprites have no style prefix and stay unchanged.
     - Return `{ restyled, kept, generated }`: `kept` are prompts without the old prefix, `generated` are assets with versions, still in the old style. The tool output suggests `vno_plan {refreshPrompts: true}` for `kept` and `vno_asset_regen` for `generated`.
     - Queued generate jobs read the prompt when they run (`handlers.ts:309`), so they pick up the new one.
- **Files.** `src/shared/schemas.ts`, `src/engine/queue/scheduler.ts`, `src/engine/vn/service.ts`, `src/engine/engine.ts`, `src/engine/mcp/tools.ts`, `src/engine/mcp/tools-plan.ts`, `src/engine/vncli.ts` (`clear-queue`), `docs/mcp-guide.md`.
- **Tests.**
  - `tests/scheduler.test.ts`: a later priority-1 job runs before an earlier priority-0 job, and dependencies still win.
  - `tests/vn-pipeline.test.ts`: a run is stopped, then `vno_plan` is called. With `drop: true` only the plan jobs run after resume; without it, the plan job runs first.
  - `tests/vn-plan-tools.test.ts`: change `art.stylePrompt` → unversioned prompts get the new prefix, a versioned asset is reported as `generated`, a sprite prompt is unchanged, and a queued generate job uses the new prompt (fake comfy records it).

### V12 (part 2). Make a dropped project model visible in the job log

- At job start (`run()`, `scheduler.ts:441-445`): if the job has a project model and it is not `leased`, log `project model <ref> not used: <router.whyUnusable(...) or 'over the budget cap'>`. Do the same for an agent's own `model`.
- **Test.** `tests/scheduler.test.ts`: a job with a keyless project model logs the reason, and its first model is the role's.
- **New context field.** `JobContext.model?: ModelInfo` (the leased first model). Phase 5 needs it.

**Phase 2 acceptance.** All checks pass. Commit `VNO-08: Scheduler: client jobs free agents, no-op jobs skip the slot, priority, queue drop, sheet-first regen, restyle`.

**Phase 2 notes (done).**
- Done: V6 (`occupying`), V18 (`HandlerOptions.skipModel`, lazy jobs lease a slot in `ctx.chat`; the predicates are one table in `handlers.ts`, `noModelThisTime`), V10 (sheet regen links queued sprite jobs, `sprites`, `staleSprites`, a sprite waits for a queued or running sheet job, also in `dispatchGenerate`), V11 (`priority`, `vno_stop_now {drop, slug}`, `vno_clear_queue`, `svc.clearQueue`, `svc.restylePrompts`, `vncli clear-queue`), V12 part 2 (log lines `project model <ref> not used: <reason>`, `JobContext.model`).
- Verification: full run 624 tests in 51 files (617 before the new queue and restyle tests, 609 at the end of phase 4), typecheck and lint clean. New: `tests/vn-queue.test.ts` (6), scheduler (6), vn-handlers (2), vn-plan-tools (1). Ren'Py integration describe ran (not skipped).
- Deviations: `svc.regenerateAsset` now returns `{ jobs, staleSprites }` (was a list of ids). `restyle` lists asset ids (`restyled`, `kept`, `generated`) rather than counts. Priority 1 also covers the jobs a `vno_asset_generate` fans out (they inherit the dispatch job's priority), `vno_android_build`, and the rebuild after an asset edit. A lazy job whose models are all paid and over the cap throws the budget error (requeued after 15 s) instead of polling. The agent's own model is logged like the project model when it is not used.

---

## Phase 3: import and analysis (V4, V7, V8, V17)

### V4. Non-Latin titles and names

- **Root cause.**
  - `projectSlug` (`vn/project.ts:36-47`) keeps `[a-z0-9]` only, so a title without Latin letters gives `book`, then `book-2` and so on.
  - The same goes for `slugKey` (`vn/ids.ts:28-35`, which gives `x`, `x_2`) and `slugify` (`renpy/escape.ts:146-155`).
  - `normText` (`ids.ts:20-25`) deletes every non-Latin letter. `matchCharacter` and `matchPlace` (`script.ts:76,105-107`) then return null for any Cyrillic or CJK name, so every speaker becomes "not in the bible".
- **Fix.**
  - **New `src/shared/translit.ts`.** `transliterate(text): { latin: string; dropped: number }`, table-driven:
    - Cyrillic: Russian, Ukrainian, Belarusian, Serbian and Bulgarian letters, ISO 9-like with readable digraphs (ж zh, ш sh, щ shch, ч ch, ц ts, ю yu, я ya, ђ dj, ћ c, љ lj, њ nj, џ dz);
    - Greek, including the tonos letters (θ th, χ ch, ψ ps);
    - Armenian and Georgian;
    - Hebrew and Arabic/Persian (consonant maps);
    - Devanagari (consonant plus vowel sign; virama drops the inherent a);
    - Hiragana and Katakana (Hepburn: きゃ kya, small っ doubles the next consonant, ー lengthens);
    - Hangul (algorithmic Revised Romanization from the syllable decomposition).

    Han, Thai and anything else are dropped and counted in `dropped`.
  - **`asciiSlug(text, { sep, prefix })`.** Transliterate, strip diacritics, lowercase, collapse to `sep`. When letters were dropped, append `-<sha1(text) first 6 hex>` (`_` for keys), so `红楼梦` gives `book-1a2b3c` and `東京 Tokyo` gives `tokyo-1a2b3c`.
  - `projectSlug`, `slugKey` and `slugify` use `asciiSlug`: ASCII results stay the same, Ren'Py ids stay ASCII. Keys must still start with a letter (`x_` prefix as today).
  - **`normText`** keeps Unicode letters and digits: `.replace(/[^\p{L}\p{N}]+/gu, ' ')` after lowercasing and stripping Latin diacritics. Matching works inside any script. Check that the callers (`HEADINGS`, `TIME_WORDS`, `matchPlace`, `story.ts` `findChar`) behave the same for Latin text: the existing tests cover it.
  - Chinese pinyin: no new dependency, hash fallback (user decision 6).
- **Files.** `src/shared/translit.ts` (new), `src/engine/vn/ids.ts`, `src/engine/vn/project.ts`, `src/engine/renpy/escape.ts`.
- **Tests.** New `tests/translit.test.ts`:
  - `Война и мир` gives `voina-i-mir`; `Ὀδύσσεια` gives `odysseia`; `さくら` gives `sakura`; `한국어` gives `hangugeo`; `红楼梦` gives a `book-` hash slug, the same for the same title and different for another; mixed text keeps its Latin part.
  - `slugKey('Наташа')` gives `natasha`.
  - In `tests/vn-import.test.ts`: a Russian bible plus script fixture (new `tests/fixtures/books/linear-ru/`) imports with every speaker matched and keys `natasha` ...
  - `vno_create_project` with a Japanese title gets a romaji slug.
  - The Ren'Py integration build of the Russian fixture passes lint.

### V7. Script names read as cast

- **Root cause.** On the-clockless-god-2 ch-04 (read-only):
  - `ON SCREEN: The ledger page, headed DÉBITEURS: Delorme, ... / Roux, Anselme, horloger ...` and `ON SCREEN: Lassalle, Gérard, notaire. Mars. Remis.` (lines 75, 77) are props.
  - The CAST branch (`script.ts:240-260`) splits any ON SCREEN text on commas, and each piece that `matchCharacter` accepts becomes a cast member: `Roux` and `Lassalle` match exactly.
  - `matchCharacter` also has loose rules. The first-token rule (`:113`) does not skip articles or titles: "the silver-haired man" matches the first bible name starting with "The", and "Madame Ferré" matches "Madame Jobin". The single shared ≥3-letter token rule is at `:117`.
  - The script-analyst's `cast` decisions are applied without checking that the character is in the scene (`fixes.ts:157-170`). It is never told who speaks or is named there (`script-analyst.ts:124-135`).
- **Fix.**
  1. **`classifyOnScreen(text, bible)`** in `script.ts`. The line is a **prop** when any of these holds:
     - after stripping brackets, the text contains `:` or ` / `;
     - an entry, with its bracket removed, has more than 5 words or contains sentence punctuation (`. ; !`) inside it;
     - the line starts with an article or preposition (`a, an, the, over, on, in, at, under, beside`, plus Croatian `na, u, iznad`) and its first entry matches no character exactly by name, key or alias.

     A prop line makes no cast beat. Its text becomes a **narration beat** (the reader sees the ledger) and a scene hint (`Also on screen: ...`) as today.
  2. **`matchCharacter`.** Exact name, key or alias first. In the first-token and overlap rules, ignore stop words and titles: articles, `man, woman, lady, girl, boy, old, young, brother, sister, mother, father, mr, mrs, ms, madame, monsieur, mademoiselle, maitre, frere, mere, dr, doctor, sir`, and Croatian equivalents. Require the token to be at least 3 letters and the entry to be at most 3 words. The overlap rule applies only to speaker labels, not to ON SCREEN entries.
  3. **Presence check** after parsing (`checkCasts(scenes, bible)`, `script.ts`). A cast member matched by a loose rule who neither speaks in the scene nor is named (name or alias) in its narration is flagged `Uncertain` kind `cast` with reason `named only: on screen?`, and is kept off the cast beat until the analyst confirms. A cast of more than 3 is flagged too.
  4. **Analyst context.** `describeItems` adds `present: { speakers: [...keys speaking in the scene], named: [...keys named in narration] }` and, for cast items, `candidates` (key, name, looks clipped to 100) of the bible characters whose looks share a word with the entry's text. The prompt `seed/prompts/script-analyst/resolve_uncertain.md` gets the rules:
     - put on screen only someone physically there;
     - a person who is only read, listed, mentioned or remembered is `isDirection: true`;
     - a description such as "the silver-haired man" goes to the character whose bible looks match, else `newCharacter`.
  5. **Deterministic check of the analyst's `cast` answer** (`fixes.ts` case `cast`). Accept `charKey` only if the character speaks in the scene, is named in it, or shares at least one looks word (from `VISUAL_WORDS` tokens) with the entry text. Otherwise leave it unresolved, with the note `rejected <key> for "<text>": not in the scene and looks do not match`.
- **Files.** `src/engine/vn/script.ts`, `src/engine/vn/fixes.ts`, `src/engine/vn/agents/script-analyst.ts`, `seed/prompts/script-analyst/resolve_uncertain.md`.
- **Tests.**
  - `tests/vn-import.test.ts`, with a new fixture chapter in `tests/fixtures/books/quirks-en/` that copies the ledger lines and the silver-haired case:
    - the ledger ON SCREEN lines give narration and no cast beat;
    - `ON SCREEN: Dec (...), Inès (...), the silver-haired man (...)` casts Dec and Inès and flags the third entry;
    - "Madame Ferré" does not match "Madame Jobin".
  - `tests/vn.test.ts` / `vn-lang-expr.test.ts`: `matchCharacter` unit cases.
  - `tests/vn-handlers.test.ts`: a mock analyst that answers `charKey: zoltan` for "the silver-haired man" is rejected; `vaulmont` (looks "silver hair") is accepted.

### V8. Bible aliases become separate characters

- **Root cause.** Every `- **Name**:` bullet becomes a character (`bible.ts:75-80`), and the book schema has no `aliases` (`shared/vn.ts:97`). In the-clockless-god-2's bible:
  - Kessler's entry says "Narration calls him 'the bald man'";
  - Fabien's says 'the young man in grey';
  - Dec's says "Declan Hartley from Galway";

  yet each alias has its own bullet.
- **Fix.**
  1. **Schema.** Characters get `aliases?: string[]` in `vnBookSchema`, `characterInputSchema` (`story.ts`) and the `character.set` op (`aliases: string[] | null`; null clears). `vno_character_set` describes it.
  2. **`parseBible`** extracts aliases written in an entry: quoted names after `calls (him|her|them)`, `known as`, `also called`, `called`, `nicknamed`, and an explicit `Aliases:` / `Also:` sentence. Croatian too: `zovu ga`, `poznat kao`.
  3. **`mergeBibleAliases(bible)`** (`bible.ts`), run in `import.ts` before parsing chapters. Entry B merges into entry A when either holds:
     - B's normalized full name (at least 2 words, or quoted) appears in A's text, or is one of A's extracted aliases;
     - B's text starts with A's name as its first sentence ("Dec. 34, from Galway").

     A gets `aliases += B.name`, and A's looks are kept. The merge is reported in `book.warnings` and `import.json` (`aliases merged: the bald man -> kessler (named in Kessler's entry)`). Pairs that only share looks (looks-word Jaccard ≥ 0.5) are not merged: they become `Uncertain` kind `alias` (new kind) for the analyst. Its decision gets `aliasOf: string | null`. `applyDecisions` merges when `aliasOf` names a character: remap speakers and cast, add the alias, drop the other character.
  4. **Matching.** `matchCharacter` and `story.ts` `findChar` match aliases exactly (normalized).
  5. **Display.** A line whose `speakerLabel` equals an alias keeps that label on screen, so the reader is not told the name early. `emitCharacters` defines `define <var>__a<n> = Character(_("<alias>"), kind=<var>)` for each alias used, and `emitScene` says with that variable (same sprite tag, so expression changes still work). Alias display names are translatable: `translatableStrings` adds them, and an edition's `characterNames["<key>#<n>"]` translates them.
  6. **Summary.** `vno_get_story` shows aliases.
- **Files.** `src/shared/vn.ts`, `src/engine/vn/bible.ts`, `src/engine/vn/import.ts`, `src/engine/vn/script.ts`, `src/engine/vn/fixes.ts`, `src/engine/vn/agents/script-analyst.ts` (decision schema `aliasOf`, kind `alias` described in the prompt), `src/engine/vn/story.ts`, `src/engine/renpy/emit.ts`, `src/engine/mcp/tools-story.ts`.
- **Tests.**
  - New `tests/vn-aliases.test.ts`:
    - A bible with the three Clockless God pairs merges to Kessler, Fabien and Dec; the reasons are reported.
    - Zoltán Varga (only "Zoltán" appears in Inès's text) is not merged.
    - Brother Anselme Vey is not merged into Roux ("Anselme Roux" ≠ "Anselme Vey").
    - Script lines `THE BALD MAN:` map to `kessler`; the emitted `characters.rpy` has the alias Character; the say uses it.
    - `character.set {aliases}` round-trips.
    - Analyst `aliasOf` merges.
  - `tests/renpy-integration.test.ts`: an alias fixture builds and passes lint.

### V17. The analysis adds assets after the art is done

- **Root cause.** `applyDecisions` sets a new `time` and recomputes `backgroundId` (`fixes.ts:83-85,103-123`), so a new `bg_<place>_<time>` asset appears. An expression decision (`:138-145`) can create a sprite with no file. The analyst is never told which art exists (`script-analyst.ts:138-143`, prompt).
- **Fix.**
  1. **Tell the analyst.** The analyse handler (`handlers.ts:140-161`) builds `art = { backgrounds: { [placeKey or bgId]: string[] /* times with a file */ }, sprites: { [charKey]: string[] /* expressions with a file */ } }` from the manifest (`resolveFile`) and passes it to `resolveUncertain`. The prompt gets an `{{art}}` block: "These already have art. Prefer a time or expression from this list; only pick another when the text clearly needs it."
  2. **Guard.** `applyDecisions(book, edition, items, decisions, { hasFile(assetId): boolean })`:
     - **Time or place.** If the new background id has no file while the current one has a file, keep the current `time` and `backgroundId` (note `kept bg_x_any: no art for bg_x_dusk`). Otherwise, if another background of the same place has a file, use the nearest existing time (dawn↔morning↔day↔afternoon, evening↔dusk↔night), with a note.
     - **Expression.** If `sprite_<char>_<expr>` has no file but the character has other sprite files, use the nearest existing expression: worried→scared→sad→neutral, surprised→happy→neutral, thinking→neutral, angry→neutral. Keep `rawExpression` and add a note.
     - With no art at all (a fresh project), nothing changes.
  3. Hand mode needs no special case: the guard covers it.
- **Files.** `src/engine/vn/fixes.ts`, `src/engine/vn/agents/script-analyst.ts`, `src/engine/vn/handlers.ts` (analyse), `seed/prompts/script-analyst/resolve_uncertain.md`.
- **Tests.** In `tests/vn-handlers.test.ts` / `tests/vn.test.ts`:
  - With `bg_harbour_any` on disk, a `time: dusk` decision keeps `bg_harbour_any` and adds no asset.
  - With `bg_harbour_night` on disk, `evening` maps to night.
  - With only `sprite_mara_neutral` and `sprite_mara_happy`, `surprised` becomes `happy`.
  - Without any files, decisions apply as today.
  - The analyst prompt contains the art list.

**Phase 3 acceptance.** All checks pass, including the Ren'Py lint cases. Commit `VNO-08: Transliterated slugs and keys, cast and alias detection at import, analysis keeps existing art`.

**Phase 3 notes (done).**
- Done: V4 (`shared/translit.ts`, `asciiSlug` in `vn/ids.ts` used by `projectSlug`, `slugKey`, `slugify`; `normText` keeps letters of every script), V7 (`classifyOnScreen`, `matchCharacterDetail`, `checkCasts`, analyst `present` and `candidates`, the guard on a cast answer), V8 (`aliases` in the book, story JSON and `character.set`; `vn/aliases.ts` extracts and merges, `alias` item kind with `aliasOf`; alias `Character`s in `characters.rpy`; `<key>#<n>` names in editions), V17 (the analyst gets the art list, `applyDecisions` takes `{ hasFile }`).
- Verification: full run 679 tests in 54 files, typecheck and lint clean; the Ren'Py integration describe ran 8 tests, including a Russian book and an alias book with a French edition (real `renpy.exe lint`). Two full runs had one load-dependent timeout each (the first test of `vn-handlers.test.ts` as in the baseline, and once `scheduler.test.ts` "fire gracefully"); both pass alone and the next full run was green.
- Deviations: (1) the new fixture chapter is a new book folder, `tests/fixtures/books/quirks-cast-en/`, not a chapter of `quirks-en` (a fourth chapter would change the existing endings and chapter-count assertions). (2) `matchCharacter(label, chars, { entry: true })` turns the overlap rule off for ON SCREEN entries (default on, so speaker labels keep matching a bare surname). (3) A bare first name matches exactly enough to need no presence check; only longer descriptions that match through the first word, and entries matched by a prefix, are "loose". (4) The "more than 5 words" test for a prop does not count a leading article, so "the soother spinning in the sky" in the existing quirks fixture stays a hint in a real cast line. (5) Two entries that mention each other are never merged by "named in the entry" (a wife and a husband), unless the name is quoted or listed as an alias. (6) Reasons for merged aliases read `named in <Name>'s entry` for an alias list too. (7) Han text gets `-<6 hex>`: `さくらの手紙` is `sakurano-<hash>` because the kana part is written and the Han part dropped. (8) `ъ` is dropped (Russian), so a Bulgarian `България` is `blgariya`.

---

## Phase 4: languages (V0). Can run in parallel with Phase 1 (and Phase 3)

### UI strings for the main languages

- **Root cause.** Only `hr` has a table (`shared/languages.ts:30-81,129`). `languageWarnings` (`renpy/build.ts:91-100`) says the menus of every other language stay English.
- **Fix.**
  - New `src/shared/ui-strings.ts` with a table per built-in language other than English: hr (moved here), de, fr, es, it, pt, nl, pl, cs, sk, sl, sr (Cyrillic), bs, ru, uk, bg, el, ro, hu, tr, sv, da, no, fi, et, lv, lt, vi, id, ja, ko, zh (Simplified), ar, he, fa, hi.
  - Every table has exactly the keys of the hr table (the template's strings). Keep `{}` and `\\n` exactly.
  - `BUILTIN_LANGUAGES` takes `ui` from it.
  - A `config/languages.md` entry for a built-in code is now **merged** with the built-in entry: `ui` key by key, other fields override (`registerLanguages`). Today an entry replaces the built-in one completely, losing its `ui`.
  - Update the seed `config/languages.md` body: built-in tables exist for all built-in languages; `ui` there overrides single strings.
  - The strings are model-written (user decision 3). Say so in the seed doc.
- **Files.** `src/shared/ui-strings.ts` (new), `src/shared/languages.ts`, `seed/config/languages.md`.
- **Tests.** `tests/languages.test.ts`:
  - Every built-in non-English language has `ui` with exactly the key set of the English template list.
  - Placeholders `{}` and `\\n` are kept in every value.
  - An override in config merges.
  - `languageWarnings` no longer lists built-ins.

### Per-language font

- **Root cause.** The build only warns (`build.ts:87-98`) that DejaVuSans has no han, kana, hangul, devanagari or thai glyphs. Theme fonts (Lora, Quicksand, Courier Prime, Pixelify Sans) are never checked: Cyrillic in Quicksand shows boxes without a warning.
- **Fix.**
  1. **Font coverage in themes.** `themes/*/theme.yaml` `fonts.scripts` lists the scripts the text font covers; the schema is in `themes/load.ts`.
     - DejaVuSans default: latin, cyrillic, greek, arabic, hebrew.
     - Lora: latin, cyrillic. Quicksand: latin. Courier Prime: latin. Pixelify Sans: latin, cyrillic.
     - The implementer checks each font's cmap once, for example with Python `fontTools` if available, and fixes the lists. A font without the field counts as latin only.
  2. **Font sources per language** (new `src/engine/renpy/fonts.ts`, `resolveLanguageFont(lang, script, { dataDir, platform, exists })`), in order:
     1. `font` (and optional `fontBold`) of the language in `config/languages.md`: an absolute path, or a file name in `<data>/fonts/`. Add both to `languageEntrySchema`.
     2. `<data>/fonts/<script>.(ttf|otf|ttc)`, a file the user dropped in.
     3. System font candidates per script and OS:
        - han `msyh.ttc` / `simsun.ttc`;
        - kana `YuGothM.ttc` / `msgothic.ttc`;
        - hangul `malgun.ttf`;
        - devanagari `Nirmala.ttf`;
        - thai `LeelawUI.ttf` / `tahoma.ttf` in `C:/Windows/Fonts`;
        - macOS `/System/Library/Fonts/...` (Hiragino, AppleSDGothicNeo, PingFang, Kohinoor, Thonburi);
        - Linux `/usr/share/fonts/**/Noto*CJK*` and so on.

        `.ttc` is used with Ren'Py's `0@file.ttc` syntax.
     4. For cyrillic, greek, arabic and hebrew when the theme font lacks them: `DejaVuSans.ttf` (ships with Ren'Py).
  3. **Build.** `BuildGameInput.fontsDir` comes from `dataFolders(dataDir)`; add a `fonts` folder to `DATA_LAYOUT`. For each language of the game whose script the theme text font does not cover:
     - copy the resolved font into `game/fonts/lang/`;
     - write `game/vno_fonts.rpy` with `translate <renpy> python:` blocks setting `gui.text_font`, `gui.name_text_font`, `gui.interface_text_font`, `gui.button_text_font` and `gui.choice_button_text_font`, and in the same block `config.font_replacement_map` for bold to the bold file or the same file.

     A non-English primary is Ren'Py's `config.default_language`, so its block applies at start.
  4. **Warnings.**
     - When no font is found: `no font with <script> glyphs for <Name>: set font for <code> in config/languages.md, put a font in <data>/fonts/, or run vno_fonts_fetch {script: <script>}`.
     - When a system font was copied: `copied the system font <file> for <Name>: fine to play, check its license before you share the game (vno_fonts_fetch gets a free Noto font)` (user decision 2).
  5. **`vno_fonts_fetch {script}`** in a new `src/engine/mcp/tools-lang.ts` (registered from `buildTools`). It downloads the Noto Sans (OFL) font of the script into `<data>/fonts/<script>.<ext>`, plus `OFL.txt`, for han (SC), kana (JP), hangul (KR), devanagari and thai.
     - Source: the `notofonts` GitHub repos. The implementer verifies each URL with one manual fetch. A script whose URL cannot be verified is left out of the table and documented as a manual download.
     - It never runs automatically.
     - Fetch is injectable for tests.
- **Files.** `src/engine/renpy/fonts.ts` (new), `src/engine/renpy/build.ts`, `src/engine/themes/load.ts`, `themes/*/theme.yaml`, `src/engine/vn/languages-config.ts`, `src/shared/languages.ts` (`font`/`fontBold` on `LanguageInfo`), `src/engine/store/dataFolder.ts` (layout: `fonts`), `src/engine/vn/handlers.ts` (build passes `fontsDir`: a one-line change), `src/engine/mcp/tools-lang.ts` (new), `src/engine/mcp/tools.ts` (register only).
- **Tests.**
  - `tests/renpy-fonts.test.ts`, new, with an injected `exists` / platform:
    - priority config, then data, then system, then DejaVu;
    - `.ttc` gets the index syntax;
    - a theme covering cyrillic writes no font block for `ru`;
    - Quicksand plus `ru` gives DejaVu;
    - `ja` with no font gives the warning text;
    - `vno_fonts_fetch` writes the file with a fake fetch.
  - `tests/renpy-integration.test.ts`: the linear fixture plus a `ja` edition, with a tiny OFL font copied as the language font (or DejaVu used for the test), builds `vno_fonts.rpy` and passes lint.

### RTL mirroring

- **Root cause.** `build.ts:209-211` writes only `define config.rtl = True`. The template layout (`templates/renpy/game/gui.rpy:109-141,251`, `screens.rpy`) stays left-to-right, and the build says so (`build.ts:99`).
- **Fix.**
  - Template: add `define gui.navigation_xanchor = 0.0` to `gui.rpy` and use `xanchor gui.navigation_xanchor` in the `navigation` screen's vbox in `screens.rpy`. Add the same kind of hook for the quick menu and the history entries if they are positioned by absolute xpos. Change nothing visible for LTR.
  - `build.ts` writes `game/vno_rtl.rpy`. For each RTL language (`rtlLanguages`) it contains a `translate <renpy> python:` block that mirrors, using the resolution width W:
    - `gui.name_xpos = W - 360`, `gui.name_xalign = 1.0`;
    - `gui.dialogue_text_xalign = 1.0`;
    - `gui.navigation_xpos = W - 60`, `gui.navigation_xanchor = 1.0`;
    - `gui.main_menu_text_xalign = 0.0`;
    - `gui.history_name_xpos = W - 233`, `gui.history_text_xalign = 1.0`;
    - `gui.choice_button_text_xalign` unchanged.

    The source values are read from the template constants, not hard-coded twice: keep one table in `src/engine/renpy/rtl.ts`.
  - `config.rtl` stays global.
  - Remove the "not mirrored" warning. Visual layout cannot be linted: the user checks it once (in the changelog's follow-ups).
- **Files.** `src/engine/renpy/rtl.ts` (new), `src/engine/renpy/build.ts`, `templates/renpy/game/gui.rpy`, `templates/renpy/game/screens.rpy`, `tests/renpy-template.test.ts`.
- **Tests.**
  - Unit: `vno_rtl.rpy` content for `ar` at 1920x1080 and at 1280x720.
  - `renpy-template.test.ts`: the new gui variable exists and the navigation screen uses it.
  - Integration: linear fixture plus an `ar` edition passes lint.

**Phase 4 acceptance.** All checks pass. A `ja` + `ar` build of a fixture lints clean with fonts and RTL blocks. Commit `VNO-08: UI strings for all built-in languages, per-language fonts, RTL layout`.

**Phase 4 notes (done).**
- Done: `src/shared/ui-strings.ts` (36 tables of 49 strings, hr moved from `languages.ts`), merge of a config entry into a built-in language, `font`/`fontBold`, `fonts.scripts` in the themes, `renpy/fonts.ts`, `vno_fonts.rpy`, `renpy/rtl.ts` and `vno_rtl.rpy`, `gui.navigation_xanchor` in the template, `vno_fonts_fetch` in `mcp/tools-lang.ts`, a `fonts` data folder.
- Verification: full run 609 tests (was 583 after phase 1), typecheck and lint clean. The Ren'Py integration describe ran (6 tests, real `renpy.exe lint`), including the new `ja` + `ar` build.
- Font coverage (read from each font's cmap with a small script): Courier Prime latin; Lora latin, cyrillic; Quicksand latin; Pixelify Sans latin, cyrillic, greek (the plan said latin, cyrillic: corrected); DejaVuSans latin, cyrillic, greek, arabic, hebrew. Python/fontTools was not installed, so the cmap script is node.
- `vno_fonts_fetch` URLs, each fetched once by hand (first bytes read, all good): Noto Sans CJK SC/JP/KR OTF from `notofonts/noto-cjk` (`OTTO`), Noto Sans Devanagari and Thai hinted TTF from `notofonts/notofonts.github.io` (TrueType header). Licenses: `notofonts/noto-cjk/Sans/LICENSE`, `notofonts/devanagari/OFL.txt`, `notofonts/thai/OFL.txt`. All five scripts are in the table; none left out. The licenses are saved as `<script>-OFL.txt` (not one `OFL.txt`, since the notices differ).
- Deviations: the mirrored table also sets `history_name_xalign` (0.0) and `history_text_xpos` (W-255), else the history rows would overlap. The other languages of a game with an RTL language get a `translate <language> python:` block with the template values (`None` for an English primary), so switching back from Arabic unmirrors; lint accepts `translate None python:`. A language that sets `font` itself gets a block even if the theme font covers its script. `languageWarnings` now only reports missing menu strings (signature `(langs)`); the font and RTL checks moved to fonts.ts and rtl.ts. macOS and Linux system font paths are from memory and unverified on those systems (only the Windows ones were checked here).
- Not verifiable here: that Ren'Py applies the blocks and looks right in the game (needs the player to open it: Japanese text, an Arabic edition's mirrored menus).

---

## Phase 5: external import, landscape cover, client-friendly draw (V2, V9/V15, V13)

### V2. Import an outside image with post-processing, and outside voice clips

- **Root cause.**
  - `vno_asset_replace` → `replaceAsset` → `setCustom` copies the file as it is (`service.ts:881-887`, `manifest.ts`). Background removal, trim, scale and pixel finishing exist only inside `generateAsset` (`generate.ts:288-335`).
  - Voice clips can only be generated: `VoiceIndexEntry` has no imported state (`voice/jobs.ts:17-21`), and any clip whose hash differs is regenerated (`jobs.ts:170-171`, `handlers.ts:653-658`).
- **Fix: images.**
  - **Refactor.** In `generate.ts`, split the per-kind post-processing into exported `finishImage(ctx, entry, bytes, opts) → { bytes, ext, native?, warnings }`:
    - background (and later cg): `fitBackground`, then pixel finishing;
    - sprite: `removeBackground` → `keepMainSubject` → `prepareSprite`, then pixel finishing;
    - cover: fit (see V9);
    - sheet: as is.

    `generateAsset` calls it.
  - **`svc.importAsset(slug, id, file, opts)`**, in a new `src/engine/assets/import.ts` plus a service method. Options: `process: 'auto' | 'none'`, `removeBackground?: 'auto' | 'birefnet' | 'key' | 'none'`, `trim?: boolean`, `pixelate?: boolean`.
    - Read the file and keep the original as `assets/<id>/import-<n>.<ext>`.
    - With `'auto'`: a sprite whose image already has real transparency (more than 2% of pixels with alpha below 250) skips background removal. In hand mode the default removal is `key`, because ComfyUI is never called for an image there unless `birefnet` is asked for explicitly. A pixel project pixelates unless `pixelate: false`.
    - Write `v<n>.webp`, add a version `{ engine: 'custom:import', prompt: 'imported from <basename>', custom: true, warnings, nativeFile? }`, `lock(addVersion(...))` (the roundtrip pattern, `roundtrip.ts:124-144`), emit, and rebuild unless `rebuild: false`.
    - Audio kinds (music, and later sfx/ambience) are copied as they are into a version (ext checked: ogg, mp3, wav, opus, flac).
  - **MCP `vno_asset_import`** in a new `src/engine/mcp/tools-import.ts`; CLI `asset import <slug> <id> <file> [--no-process] [--bg key|birefnet|none]`.
- **Fix: voice.**
  - `VoiceIndexEntry` gets `imported?: true` and `textHash?: string`.
  - `svc.importVoiceClips(slug, lang, { beatId, file } | { folder })`:
    - a folder matches `<beatId>.<ext>` names;
    - copy to `voice/<lang>/<beatId>.<ext>`;
    - index `{ hash: 'import:<sha1 bytes>', file, imported: true, textHash: sha1(edition text) }`.
  - The VibeTTS (`jobs.ts:170`) and ComfyUI (`handlers.ts:654-658`) generators skip an imported entry whose file exists, and say `N imported clip(s) kept` (plus `M of them for text that changed` when `textHash` differs).
  - `invalidateSpeaker` leaves imported entries alone.
  - MCP `vno_voice_import {slug, lang, beatId?, file?, folder?}`; CLI `voice import`.
- **Files.** `src/engine/assets/generate.ts`, `src/engine/assets/import.ts` (new), `src/engine/assets/postprocess.ts` (alpha check helper), `src/engine/vn/service.ts`, `src/engine/voice/jobs.ts`, `src/engine/vn/handlers.ts` (comfy voice skip), `src/engine/mcp/tools-import.ts` (new), `src/engine/mcp/tools.ts` (register), `src/engine/vncli.ts`, `docs/mcp-guide.md` ("Hand-made art": use `vno_asset_import` for unprocessed images).
- **Tests.**
  - New `tests/assets-import.test.ts`:
    - an opaque sprite on a white background with `bg: key` comes out transparent, trimmed and at sprite height;
    - an already transparent sprite skips removal (no comfy call);
    - a background 800x600 becomes 1920x1080;
    - a pixel project gives exact palette colours;
    - `process: none` equals replace;
    - a version is recorded, locked, with engine `custom:import`;
    - hand mode never calls `comfy.removeBackground` with `auto`.
  - `tests/voice-vibetts-jobs.test.ts`:
    - an imported clip is not regenerated;
    - a folder import matches beat ids and reports unknown names;
    - `invalidateSpeaker` keeps imported clips.

### V9 and V15. The cover is portrait and the menu crops it

- **Root cause.**
  - The cover is planned portrait: `derive.ts:86` (`PORTRAIT`), the prompt `portrait composition` (`derive.ts:225`), `handlers.ts:334` (`cover: { w: res.h, h: res.w }`), `generate.ts:331`.
  - `buildImages` resizes it to the game resolution with `fit: 'cover'` (`images.ts:155`), which cuts a portrait cover to a strip. The nearest kernel for pixel books was fixed in VNO-07 (`images.ts:120,155`).
- **Fix** (user decision 4: landscape cover, no separate menu asset):
  1. **New covers.** Plan and generate the cover landscape: `LANDSCAPE` size in `deriveAssets`; `sizes.cover = resolution` in `handlers.ts:334`; the fallback prompt says `wide 16:9 key art, landscape composition, keep the left third calm for the menu, full-bleed, no text`; the `describeAsset` cover description in `art-director.ts` says landscape menu key art.
  2. **Existing projects.** In `reconcileAssets`, a cover with no versions, not locked and not `promptByHand` gets size `LANDSCAPE`, and `portrait composition` in its prompt becomes `landscape composition`. A cover that has a file is left alone.
  3. **Build.** In `buildImages`, when the cover's aspect ratio differs from the screen's by more than 15% (portrait or square), compose instead of crop:
     - fill: the cover resized `fit: cover`, blurred (sigma about 40) and darkened (about 55% brightness);
     - foreground: the cover `fit: inside` at the full screen height, centred at 62% of the width (right of the menu buttons);
     - pixel projects: fill with the image's mean colour instead of the blur, and use the nearest kernel.

     A landscape cover keeps today's `fit: cover`.
  4. Docs: hand-made art (`docs/mcp-guide.md`) says the cover is landscape 1920x1080.
- **Files.** `src/engine/assets/derive.ts`, `src/engine/vn/agents/art-director.ts`, `src/engine/vn/handlers.ts`, `src/engine/vn/service.ts` (reconcile), `src/engine/renpy/images.ts`, `docs/mcp-guide.md`.
- **Tests.**
  - `tests/assets-derive-manifest.test.ts`: the cover stub is landscape; reconcile migrates an empty portrait cover and keeps one with versions.
  - `tests/renpy-images-pixel.test.ts` plus a new case in `tests/renpy-integration.test.ts` or a unit test:
    - a 1080x1920 cover gives a 1920x1080 `main_menu.png` whose centre-right column shows the whole cover height (the top and bottom rows of the cover appear in the output);
    - a landscape cover is unchanged;
    - pixel mode fills with the mean colour, and the output has no colours outside the cover's palette plus the fill.

### V13. Pixel Studio draw loop and the client provider

- **Root cause.** `drawSpriteWithStudio` (`studios/draw.ts:61-101`) is a multi-turn loop bounded by `maxMs` (`drawTimeoutS` 240, `handlers.ts:329`, `studios/config.ts:28-29`) that is checked between turns. With a client model a single turn can take minutes, so the loop ends after one step, or with nothing drawn (`draw.ts:102`). Each turn is also a separate client task.
- **Fix.**
  - **New `drawMode`** in `config/studios.md`: `auto` (default) | `loop` | `grid`. `drawTimeoutS: 0` means no limit.
    - `auto` picks `grid` when the job's first model (`ctx.model`, Phase 2) is on a `kind: client` provider, else `loop`.
    - In `loop` mode with a client model, the time budget is ignored and `drawSteps` stays the only bound.
  - **`grid` mode** (new `drawSpriteFromGrid` in `draw.ts`): one model request, no time limit.
    - The prompt holds the grid size, the palette as characters (`0-9a-zA-Z` = palette index, `.` = transparent, the same convention as Pixel Studio's `draw_grid`), the expression, and the reference already quantized to that palette at grid size (from the existing `pixelate` and palette code) as text rows to clean up.
    - Answer schema `{ rows: string[] }`: h rows of length w, characters from the alphabet. It is validated, and with a client the queue checks the schema on submit.
    - VN Studio then paints the rows into the document from `drawSpriteFromReference` with `draw_grid` calls in tiles of at most 64x64, and exports as today, so "Open in Pixel Studio" still works.
    - If Pixel Studio is down, the PNG is built locally with sharp from the rows (same nearest scale-up), with a warning.
  - Docs: `config/studios.md` body and the guide's client section.
- **Files.** `src/engine/studios/draw.ts`, `src/engine/studios/config.ts`, `seed/config/studios.md`, `src/engine/assets/generate.ts` (pass the mode, the palette and the model kind through `GenerateContext.draw`), `src/engine/vn/handlers.ts` (`generateOne`: `draw: { steps, ms, mode }` from `ctx.model`).
- **Tests.** `tests/studios-generate.test.ts`, with the fake pixel client:
  - grid mode makes one model request, and its rows become `draw_grid` calls tiled at most 64 wide;
  - bad rows (wrong length or alphabet) get one repair round, then fail;
  - auto picks grid for a client model;
  - loop mode with a client model ignores `maxMs`, using a `now` that jumps 10 minutes per turn.

**Phase 5 acceptance.** All checks pass. Commit `VNO-08: Asset and voice import with post-processing, landscape cover, grid draw mode`.

**Phase 5 notes (done).**
- Done: V2 (`finishImage` split out of `generateAsset`; `assets/import.ts`; `svc.importAsset`, `svc.importVoice`; `vno_asset_import`, `vno_voice_import` in `mcp/tools-import.ts`; CLI `asset import`, `voice import`; imported voice clips kept by the VibeTTS and ComfyUI generators and by `invalidateSpeaker`), V9/V15 (landscape cover plan, prompt, art-director text, size in `handlers.ts`, reconcile migration, `menuImage` in `renpy/images.ts`), V13 (`drawMode`, `drawSpriteFromGrid`, `resolveDrawMode`; `drawTimeoutS: 0` means no limit; the client queue now also checks `maxItems`, `maxLength` and `pattern`).
- Verification: full run 710 tests in 55 files, typecheck and lint clean. New files: `tests/assets-import.test.ts` (12). Added to `studios-generate`, `voice-vibetts-jobs`, `renpy-images-pixel`, `vn-plan-tools`, `assets-derive-manifest`. The Ren'Py integration describe ran (not skipped): it has no cover case, the cover is covered by unit tests of `menuImage` and `buildImages`.
- Deviations: (1) `finishImage` takes a `FinishContext` (the parts of `GenerateContext` it needs) and returns `{ bytes, ext, native?, warnings }`; `generateAsset` keeps the early palette check. (2) A cover is only composed when it is narrower than the screen by more than 15% (ratio under 0.85); a cover wider than the screen is cut to fit as before. `finishImage` also keeps a portrait cover whole (scaled into the frame, not cropped to landscape) so an imported portrait cover can be composed by the build. (3) `process: none` writes `v<n>.<ext>` (the same bytes as replace) as a locked version, not a `custom.<ext>` file. (4) `importVoice` reports `{ lang, imported, unknown }` (no `stale`: a clip is never stale at import time; the stale count is in the generation message). (5) The existing test "generates a cover (1080x1920)" now expects the landscape cover. (6) The slow `vn-queue`, `vn-analysis` and `vn-handlers` test files got `vi.setConfig({ testTimeout: 60_000 })`: the soother test already timed out under full-suite load in the baseline. (7) Grid mode paints with `transparent: 'clear'` so a repaired sprite replaces the document rectangle; the draw_grid contract (rows, x, y, palette-index characters) was read from the Pixel Studio source (`pixel-art-generator/src/tools/defs/drawing.ts`), not run against a live Pixel Studio.

---

## Phase 6: asset kinds (V1)

- **Root cause.**
  - `ASSET_KINDS` is `background, sheet, sprite, cover, music, voiceRef` (`shared/vn.ts:248`), and expressions are a fixed enum (`vn.ts:19-21`).
  - Beats have no image or sound cue (`vn.ts:25-54`).
  - Stage cues have chapter music only (`renpy/stage.ts:11-29`, `emit.ts:276-280`).
- **Design rule.** No new beat types: about 30 code paths treat "not cast" as "has text" (`grep "type !== 'cast'"`). Cues ride on existing beats and scenes as optional fields, so editions, voice, alignment and translation stay untouched.

### Data model (`shared/vn.ts`)

- **Book catalogues.**
  - `images: [{ key, description, display: 'full' | 'insert', characters?: string[] }]` (default `[]`): CG and extra images. Asset id `cg_<key>`, kind `cg`.
  - `sounds: [{ key, kind: 'sfx' | 'ambience', description }]` (default `[]`): asset ids `sfx_<key>` / `amb_<key>`, kinds `sfx` / `ambience`.
- **Book expressions.** `expressions?: string[]`: the expression set, default `CANONICAL_EXPRESSIONS`, must include `neutral`; each matches `/^[a-z][a-z0-9]{0,23}$/` (no `_`, because sprite ids split on the last `_`). Characters get `expressions?: string[]` (extra ones for that character only).
- **Line beats.** `expression` becomes `z.string().regex(...)`, a superset of the old enum, so old `vn.json` files parse. Add a type alias `Expression = string`. Replace `CanonicalExpression` in the signatures of `expressions.ts`, `script.ts`, `fixes.ts`, `derive.ts`, `story.ts` and `script-analyst.ts`.
- **Any beat** may carry:
  - `image?: string | null`: `cg_<key>` shown from this beat on; `null` hides it;
  - `sfx?: string`: played when the beat starts;
  - `ambience?: string | null`: started (looped) or stopped.
- **Scenes** may carry `music?: string | null` (a track id, or `null` for silence) and `ambience?: string | null`.
- `ASSET_KINDS` adds `cg`, `sfx`, `ambience`. `IMAGE_KINDS` adds `cg`. Add `AUDIO_KINDS`.

### Settings

- `projectSettingsSchema.sound`: `{ ambienceEngine: string (default 'ace-step-v1-instrumental'), sfxEngine?: string }`.
  - SFX: no default engine, so an sfx without a file waits for `vno_asset_import`, unless `sfxEngine` names a `custom:<workflow>` (user decision 5).
  - `engineFor` (`service.ts:107`) gets the new kinds: cg uses `art.editor` when it has `characters`, else `art.generator`.

### Script grammar

These directive lines are checked before `LINE_RE` in `parseChapterScript`; Croatian aliases in brackets:

| Line | Effect |
|---|---|
| `CG: <description>` [`SLIKA:`] | Adds or reuses an `images` entry: key from the first 4 content words, display `full`. Sets `image` on the next beat. |
| `INSERT: <description>` | Same, display `insert`. |
| `CG: none` / `END CG` | `image: null` on the next beat. |
| `SFX: <description>` / `SOUND:` [`ZVUK:`] | Adds an sfx sound; `sfx` on the next beat. |
| `AMBIENCE: <description>` / `none` [`ATMOSFERA:`] | `ambience` on the next beat. |

- A pending cue with no next beat in the scene is dropped with a warning.
- **`mapExpression(raw, set)`:**
  - an exact word in the set wins;
  - else the canonical table;
  - a canonical result not in the set goes down the nearest chain to `neutral`.
- Following up in Scriptorium's script prompts is out of this repo (see follow-ups).

### Story JSON and MCP

- **Input schemas.**
  - `storyInputSchema` gets `images`, `sounds` and `expressions`.
  - `characterInputSchema` gets `expressions`.
  - `sceneInputSchema` gets `music` and `ambience`.
  - `beatInputSchema` gets `image`, `sfx` and `ambience`. A cue-only beat is not allowed: cues attach to a text or cast beat.
- **Validation in `buildBook` / `editStory`.** Cue keys must exist in the catalogues; expressions used must be in the book or character set; `scene.music` must name an existing `music_NN` or be null, and is checked at build.
- **New ops:** `image.set {key, description?, display?, characters?}`, `image.remove {key, force?}`, `sound.set {key, kind?, description?}`, `sound.remove {key, force?}`.
- **Extended ops:** `book.update` gets `expressions`; `character.set` gets `expressions`; `scene.update` gets `music`, `ambience`; `beat.update` gets `image`, `sfx`, `ambience` (null clears).
- **One-op tools:** `vno_image_set`, `vno_image_remove`, `vno_sound_set`, `vno_sound_remove`.
- **Updated tools:** `vno_set_cues` gets `scenes[id].music` / `scenes[id].ambience`; `vno_set_music` gets `scenes: {sceneId: trackId|null}`.
- `assetKind` in `tools.ts` lists the new kinds.

### Planners

- **Art-director.** `describeAsset` gets a `cg` case: description, display, the looks of the listed characters, the place of the first scene that uses it.
  - `fallbackPrompt` for `cg`: style, the description, the character looks, `cinematic illustration, full-bleed`.
  - Insert images: `object or document close-up, centered, plain background`.
  - Sizes: landscape for full; `PORTRAIT`-ish 1024x1024 for insert.
- **Composer.** `MusicPlan.scenes?: Record<sceneId, trackId | null>`; the prompt may assign scene music for mood changes. Scene music set in the story wins.
  - Ambience prompts: `fallbackPrompt` for `ambience` gives `ambient soundscape, <description>, no melody, no drums, seamless loop`.
- **Stage-director.** `stageChapter` may answer `sfx` and `ambience` per beat id, chosen only from the catalogue. Its schema and `mergeChapterCues` gain them, and the prompt `stage_chapter.md` lists the catalogue.
  - Cues by hand win as today.
  - Fold the stage results into `StageCues`: `scenes[id].music` / `.ambience`, and `beats[beatId] = { image?, sfx?, ambience? }`.
- **Precedence at build:** cues, then story fields, then chapter music.

### Assets and generation

- **`deriveAssets`** adds a `cg_<key>` for every image used by a beat (with `refs` = the sheets of its characters, at most 3) and an `sfx_` / `amb_` for every sound used.
- **`generateAsset`.**
  - `cg` uses `comfy.generate`, with `references` when `refs` have files (the edit engine), then `finishImage` like a background. Insert images are kept at their size.
  - `ambience` uses `comfy.generate` with the ambience engine, like music, `musicSeconds` 60.
  - `sfx` with a `custom:` engine runs that workflow; with none it is skipped with the reason `no SFX engine: import a file (vno_asset_import)`.
  - Hand mode skips `cg` (it is in `IMAGE_KINDS`).
  - `dispatchGenerate`: `cg` jobs depend on their sheets' jobs (like sprites) and sort after sheets.
  - `KIND_ORDER` (`generate.ts:394`) gets the new kinds.
- **Asset counts** (`summary()`) and the UI asset labels (`src/renderer/lib/assets.ts`, `AssetsTab.tsx` audio check) handle the new kinds: audio players for sfx/ambience, the image view for cg.

### Ren'Py build

- **`buildImages`** writes `images/cg <key>.<fmt>` (a full image fitted to the resolution like a background; an insert scaled to at most 70% of the screen height), with placeholders when missing.
- **`build.ts`** copies the audio of the used `sfx_` / `amb_` into `audio/` and writes `game/vno_media.rpy`:

  ```renpy
  init python:
      renpy.music.register_channel("ambience", mixer="sfx", loop=True)
  transform vn_insert:
      xalign 0.5 yalign 0.42
  ```

- **`emitScene` / `emitChapter`:**
  - at scene start, when the scene's music differs from the chapter's: `play music "<track>" fadein 2.0 if_changed`, or `stop music fadeout 2.0` for null;
  - scene ambience: `play ambience "<file>" fadein 1.5`, or `stop ambience fadeout 1.5`;
  - before a beat:
    - `image` full: `show cg <key> as vn_cg zorder 50` + `with vn_dissolve`;
    - `image` insert: `show cg <key> as vn_cg at vn_insert zorder 50` + `with vn_dissolve`;
    - `image` null: `hide vn_cg` + `with vn_dissolve`;
    - `sfx`: `play sound "<file>"`;
    - `ambience`: as above.
  - A new `scene` statement clears `vn_cg`.
  - Missing audio is skipped with a build warning, as music is today.
- **Expressions.** Sprites are emitted for any expression string. `spriteImageName` is unchanged.

### Files

`src/shared/vn.ts`, `src/engine/vn/expressions.ts`, `src/engine/vn/script.ts`, `src/engine/vn/story.ts`, `src/engine/vn/fixes.ts`, `src/engine/vn/agents/{script-analyst,art-director,composer,stage-director}.ts`, `seed/prompts/{art-director/plan_art.md,composer/plan_music.md,stage-director/stage_chapter.md,script-analyst/resolve_uncertain.md}`, `src/engine/assets/{derive,generate}.ts`, `src/engine/vn/{service,handlers}.ts`, `src/engine/renpy/{stage,emit,images,build}.ts`, `src/engine/mcp/{tools,tools-story,tools-plan}.ts`, `src/renderer/lib/assets.ts`, `src/renderer/ui/book/AssetsTab.tsx`, `docs/mcp-guide.md` (story JSON section), `docs/protocol.md`.

### Tests

- **`tests/vn-story.test.ts`.**
  - A story with `images`, `sounds`, cues on beats, scene music and custom `expressions` (`smug` for one character) builds.
  - An unknown cue key, an expression outside the set, and a cue-only beat are each refused.
  - `image.set` / `sound.remove` with force clears the cues.
- **`tests/vn-import.test.ts`.** The `CG:`, `SFX:` and `AMBIENCE:` lines become catalogue entries and cues on the next beat, and are not speakers. A trailing cue gives a warning.
- **`tests/assets-derive-manifest.test.ts`.** `cg_` with sheet refs, `sfx_` / `amb_` stubs, `smug` sprite derived.
- **`tests/assets-generate.test.ts`.**
  - `cg` with refs calls the edit engine with the sheet files.
  - sfx without an engine is skipped with the reason.
  - ambience calls the audio engine.
  - In hand mode, `cg` is not generated.
- **`tests/renpy-emit.test.ts`** (snapshots under `tests/fixtures/vn/__snapshots__/`): new `media-ch01.rpy` with `show cg ... as vn_cg`, `hide vn_cg`, `play sound`, `play ambience`, scene music.
- **`tests/renpy-stage.test.ts`.** Cue precedence.
- **`tests/renpy-integration.test.ts`.** A media fixture (`tests/fixtures/vn/media.book.json` + `media.en.json`) with placeholder CG and short silent audio files (generate a 0.2 s wav in the test) builds and passes **Ren'Py lint**.
- **`tests/vn-plan-tools.test.ts`.** `vno_set_cues` scene music and ambience round-trip; `vno_set_music {scenes}`.

**Phase 6 acceptance.** All checks pass, the media fixture lints clean, and old fixtures' snapshots are unchanged except where a new feature is used. Commit `VNO-08: CG and insert images, SFX and ambience, scene music, expression sets`.

- Done: expression sets (`book.expressions`, character `expressions`, `vn/expressions.ts`), `images`/`sounds` catalogues, cues on beats and scenes (`image`, `sfx`, `ambience`, `music`), the `cg_`, `sfx_`, `amb_` assets (CG waits for its characters' sheets; ambience uses the music engine; SFX needs an imported file unless `sound.sfxEngine` is set), stage cues `scenes[id].music/ambience` and `beats`, planner prompts, Ren'Py emission (`show cg`, `play sound`, `play ambience`, scene music, `vno_media.rpy`), ops and one-op tools, UI gallery groups.
- Verification: `yarn test` 715 passed (baseline 568), typecheck and lint clean; the real Ren'Py lint ran (not skipped): `tests/renpy-integration.test.ts` 9 passed including a media case (CG, insert, sfx, ambience, music off). New `tests/vn-media-cues.test.ts`.
- Deviations: cues are optional fields and the catalogues optional (not default `[]`). In stored data and story JSON `null` means hide/stop/silence; the string `"none"` is only accepted in edit ops (`beat.update`, `scene.update`), where `null` clears the cue. The media fixture is built inline in the integration test instead of fixture json files. The script-analyst prompt was not changed to pick expression sets (the analyst keeps using the book set). Fewer new unit tests than listed; the story-op and emit paths are covered by `vn-media-cues` and the integration case.

---

## Phase 7: docs, verify-only items, final run

- **V3 (operational).** No code. The engine on port 7459 was started from a build older than VNO-07 (its `vno_update_settings` description lacks `hand`), so neither VNO-07 nor VNO-08 is live. After merging, the hub runs `hub.ps1 build vn-studio`, then `stop` and `start` (not part of this ticket; note it in the changelog).
- **V14 (verified fixed by VNO-07).**
  - Every `comfy.generate` / `removeBackground` call is in `assets/generate.ts`.
  - Image assets are filtered out of dispatch in hand mode (`handlers.ts:412-416`), stray jobs return early (`:381`), `regenerateAsset` and `vno_asset_generate` refuse (`service.ts:871-873`, `tools.ts` asset_generate), the art plan is skipped (`:220`), and reviews are never queued for images in hand mode.
  - `tests/vn-hand-art.test.ts` covers it.
  - Add one test in this phase: in hand mode, a `cg` (Phase 6) is not generated and `vno_asset_import` uses the `key` removal without calling comfy.
- **V16 (verified fixed by c23bfb3).** `images.ts:90-92` encodes lossless WebP for pixel projects, and `generate.ts:287` stores lossless pixel WebP. Covered by `tests/renpy-images-pixel.test.ts`.
- **Docs.**
  - `docs/mcp-guide.md`: client task shape (X1); client provider on by default; models warnings and shared keys (V12); queue priority, drop and clear (V11); `vno_asset_regen {sprites}` (V10); `vno_asset_import`, `vno_voice_import`; landscape cover; grid draw mode; aliases; images, sounds, cues and expression sets in the story JSON; fonts and `vno_fonts_fetch`; RTL.
  - Also `docs/protocol.md`, `README.md` (tools table), and the `server.ts` INSTRUCTIONS (mention import tools and cues).
- **Changelog.** `.claude/tickets/VNO-08-roadmap-fixes/changelog.md`, per phase: files, deviations, verification, follow-ups.
- **Final verification.**
  - `yarn test` (all files; the Ren'Py lint cases run with the SDK present: confirm they did not skip by checking the test output for the integration describe), `yarn typecheck`, `yarn lint`, all exit 0.
  - Record the test count against the 568 baseline.

- Done: V3, V14 and V16 are verified-only (no code). Docs: most of the guide was written phase by phase; this phase added the shared-keys line, README tool lists (image/sound tools, `vno_clear_queue`, `vno_asset_import`, `vno_voice_import`, `vno_fonts_fetch`) and the `server.ts` INSTRUCTIONS. New hand-mode test in `tests/vn-hand-art.test.ts` (a CG is refused for generate/regen, import fills it, ComfyUI never called).
- Final verification: `yarn test` 56 files, 717 passed (baseline 568); `yarn typecheck` and `yarn lint` clean. The Ren'Py integration file ran with the SDK (9 cases, not skipped, real lint clean).
- Deviations: no changelog.md was written (the orchestrator asked for these notes instead). V3 restart (`hub.ps1 build vn-studio`, stop, start) is still to be done after merging.

---

## Acceptance criteria (whole ticket)

1. **X1.** `vno_get_task` never contains the same prompt text twice. Single-turn tasks have `system` + `user` only.
2. **X2/X3.**
   - A fresh data folder has an enabled client provider with `context: 200000`.
   - An existing edited `providers.md` gets it once by migration, with comments and other entries kept.
   - A deleted client entry is not re-added.
3. **V12.**
   - Setting a project model whose provider has no key warns at once.
   - The job log says why the project model was not used.
   - Keys from Scriptorium's or Book Translator's credential store are found unless `VNO_SHARED_KEYS=0`.
4. **V5.** Studio calls carry the bearer token when one is configured, and a 401 says which variable to set.
5. **V6.** With `max_parallel: 1`, several jobs of one agent can wait on the client at once (bounded by the client provider's concurrency).
6. **V18.** Analyse with no items, stage with cues by hand, and the other listed no-op jobs finish while no model has capacity.
7. **V10.** A sheet regen always runs before queued sprites of that sheet. `sprites: true` remakes them afterwards.
8. **V11.**
   - Explicit MCP requests run before older pipeline jobs.
   - `vno_stop_now {drop: true}` and `vno_clear_queue` leave nothing to restart.
   - Changing `art.stylePrompt` restyles unversioned prompts and reports the rest.
9. **V4.** Non-Latin titles, character names and places give readable ASCII slugs and keys (a hash only for Han and Thai), and non-Latin bibles match speakers.
10. **V7.** Prop ON SCREEN lines become narration, not cast. Loose matches on descriptors or titles do not cast the wrong person. Analyst cast answers that fail the presence-or-looks check are rejected.
11. **V8.** `aliases` exist in vn.json, story JSON and MCP. Bible aliases are merged at import with a report, and alias speakers keep their alias label in the game.
12. **V17.** A re-analysis after art never creates a background or sprite with no file when a matching one exists.
13. **V0.**
    - Every built-in language has menu strings.
    - A language whose script the theme font lacks gets a font block (config, data folder, system, or DejaVu), or a precise warning; `vno_fonts_fetch` exists.
    - RTL languages get a mirrored layout.
    - `ja` and `ar` fixture builds lint clean.
14. **V2.**
    - `vno_asset_import` post-processes per kind, records a locked custom version, and avoids ComfyUI in hand mode.
    - `vno_voice_import` adds clips that later generation keeps.
15. **V9/V15.** New covers are landscape. A portrait cover becomes a full, uncropped main menu image.
16. **V13.** With a client model, a sprite is drawn in one schema-checked request with no time limit.
17. **V1.**
    - CGs (full and insert), SFX, ambience, per-scene music and custom expression sets work end to end: story JSON, script grammar, planners, MCP tools, generation or import, Ren'Py build.
    - The media fixture lints clean.
18. `yarn test`, `yarn typecheck` and `yarn lint` pass. The engine on 7459 and `~/VisualNovels` are untouched; `out/` is not rebuilt.

## Decisions for the user (defaults chosen; change them if needed)

1. **Shared API keys.** VN Studio also reads keys stored by Scriptorium and Book Translator in the Windows credential store. Default **on**, off with `VNO_SHARED_KEYS=0`. The other option is to store the DeepSeek key for VN Studio with `yarn key:set DEEPSEEK_API_KEY` (that is the immediate fix for the choice VN, and needs `yarn build:engine`, so do it after merging).
2. **Fonts.** Default: an installed system font is copied when nothing better is set, with a license warning; `vno_fonts_fetch` gets free Noto fonts on request only. The other option is to never copy system fonts.
3. **UI translations** for about 35 languages are model-written. Native review is welcome; `config/languages.md` can override single strings.
4. **Cover.** Default: new covers are landscape, and portrait covers are composed, not cropped. The other option is a separate `menu` asset next to a portrait cover.
5. **SFX.** Default: no SFX engine, so SFX are imported files, unless a ComfyUI custom workflow (for example Stable Audio Open) is set as `sound.sfxEngine`. Ambience defaults to ACE-Step instrumental.
6. **Chinese and Thai slugs** use a short hash, not pinyin, so no new dependency.
7. **Alias auto-merge at import** only when the name appears in the other entry's text. Looks-only pairs go to the analyst.
8. **`vno_stop_now`** keeps today's behaviour unless `drop: true`.

## Follow-ups outside this repo (do not do here)

- **Scriptorium.** Teach the VN script prompts the new lines (`CG:`, `INSERT:`, `SFX:`, `AMBIENCE:`), an `Aliases:` sentence in bible character entries, and not to use `ON SCREEN:` for props.
- **Scriptorium and Book Translator.** The same client-task shape fix (X1), seed client `context` (X2) and seed migration (X3).
- **creative-hub `ROADMAP.md`.** Strike the VN Studio items when merged. Note the restart (V3).

### Critical files for implementation
- C:\projects\Personal\visual-novels-orchestrator\src\engine\queue\scheduler.ts
- C:\projects\Personal\visual-novels-orchestrator\src\engine\vn\handlers.ts
- C:\projects\Personal\visual-novels-orchestrator\src\engine\vn\service.ts
- C:\projects\Personal\visual-novels-orchestrator\src\engine\vn\script.ts
- C:\projects\Personal\visual-novels-orchestrator\src\shared\vn.ts
- C:\projects\Personal\visual-novels-orchestrator\src\engine\renpy\build.ts
- C:\projects\Personal\visual-novels-orchestrator\src\engine\assets\generate.ts
- C:\projects\Personal\visual-novels-orchestrator\src\engine\mcp\tools-client.ts
- C:\projects\Personal\visual-novels-orchestrator\src\engine\store\dataFolder.ts
