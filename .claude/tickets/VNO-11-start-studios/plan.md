# HUB-08 / VNO-11: VN Studio starts the studios it needs

Status: plan, not implemented. Written 2026-10-22.

## Goal

VN Studio starts Pixel Studio, Chiptune Studio and ComfyUI by itself when a job needs one and it is down. It waits until the service answers, then the job goes on. Today the user or Claude must run `hub.ps1 start <id>` first. Without that, Pixel Studio work quietly falls back to the built-in pixelate, and Chiptune and ComfyUI jobs fail and retry.

Origin: VNO-02 `next-steps.md` §2, item 1, and "Auto-start the studios" in VN Studio's `ROADMAP.md` ("Providers").

## Scope

- A service starter in the VN Studio engine. It reads start commands, ports and health URLs from the hub's `services.json`.
- It starts only `pixel-studio`, `chiptune-studio` and `comfyui`, and only when a job calls them and they do not answer.
- A hook in the shared MCP client (Pixel Studio, Chiptune Studio) and in the ComfyUI client. On "connection refused" they ask the starter, wait, then retry once.
- A new config file `config/autostart.md` with an on/off switch, and a `VNO_AUTOSTART=0` override.
- Logs: VN Studio's engine log, the job's log, and the started service's stdout/stderr in the hub's `logs/` folder.
- Optional stop on engine exit (off by default).
- Docs in both repos. Unit tests with a fake process launcher. A live check from the hub.

## Out of scope

- Starting VibeTTS, LM Studio, Strata, Scriptorium, Book Translator, comfy-mcp, flow-music-mcp or acp-proxy. VN Studio calls none of them except VibeTTS and LM Studio, which are `managed: false` (see open question Q1).
- "Start" buttons on the Generators page, and an MCP tool to start a service. Later, in VN Studio's roadmap.
- Stopping a service when it is idle.
- `node` and `console` start kinds. VN Studio needs neither.
- The `hub.ps1 start` hang when piped (hub ROADMAP, "Hub scripts"). VN Studio does not call `hub.ps1`, so it is not affected. That fix stays a separate hub item.
- The "Open in Pixel Studio / Chiptune Studio" window launch (`studios/launch.ts`). It is unchanged. Its clash with a headless studio is a known gap (see "Known gaps").

## Decisions made

1. **Start commands come from the hub's `services.json`.** It already holds the exact commands, ports, health URLs, `startTimeout`, `managed` and `warning` for every tool, including ComfyUI's long command line, which VN Studio cannot know otherwise. One source of truth. VN Studio reads it directly and does not run `hub.ps1`: no PowerShell dependency, no inherited pipe, and VN Studio holds the PID and sees an early exit.
   - Path: `registry` in `config/autostart.md`, default `C:\projects\Personal\creative-hub\services.json`.
   - If the file is missing or does not parse, auto-start is off and the engine logs that once.
   - The packaged-app override stays: when `pixelStudioExe` / `chiptuneStudioExe` is set in `config/studios.md`, VN Studio runs `<exe> --mcp-only` instead of the registry's Electron command.
2. **VN Studio's policy lives in VN Studio.** The registry gives the "how". VN Studio decides "whether". A service is started only if every rule holds:
   - Its id is in VN Studio's own list of services it calls: `pixel-studio`, `chiptune-studio`, `comfyui`. The `services` list in `config/autostart.md` can only narrow this list.
   - Its id is not `scriptorium` or `strata`. These are hard-coded in code and cannot be turned on by config. Scriptorium resumes a paid book factory. Strata uses most of the GPU.
   - The entry has `managed: true` and no `warning` field.
   - Its `start.kind` is `electron` or `exe`.
   - The URL VN Studio calls is on loopback (`127.0.0.1`, `localhost`, `::1`), and its port equals the registry entry's `port`. A remote ComfyUI lane is never started.
   - Auto-start is on (`enabled: true` and `VNO_AUTOSTART` is not `0`).
3. **Health check.** First a probe. If the service answers, nothing is started (someone else started it). After a start, poll every 500 ms:
   - Entries with `http` (ComfyUI): `GET <http>` returns 2xx.
   - Entries with `mcp`: a TCP connect to `127.0.0.1:<port>` succeeds. This matches `hub.ps1`, which waits for the port.
   - Timeout: `startTimeoutS` in `config/autostart.md` if above 0, else the entry's `startTimeout`, else 60 s (the hub's default). ComfyUI's entry says 240 s.
   - If the child exits before it answers, fail at once with its exit code and the last 20 lines of its err log. (Typical cause: the studio's desktop app is open and holds its `engine.lock`.)
   - If the job is stopped (its abort signal), stop waiting. The started process keeps running.
4. **One start at a time per service.** Concurrent jobs that find the same service down share one start (a promise per id). A failed start is remembered for 5 minutes. During that time `ensure` returns the same reason at once and spawns nothing, so job retries do not spawn a new process every few seconds.
5. **A failed start does not change today's behaviour.** The caller gets the original "not running" error with ` (auto-start: <reason>)` appended. Pixel Studio work still falls back to the built-in pixelate with a warning. Chiptune and ComfyUI jobs fail and retry as now.
6. **Status checks never start anything.** `studiosStatus`, `voiceStatus`, `comfyStatus`, the CLI `studios status` and the Generators page only probe. Only job paths and `importAsset` ask for auto-start.
7. **Logging.**
   - Engine log (and the job log through `ctx.log`): `autostart pixel-studio: down, starting <exe> <args> in <cwd> (pid N), log <file>`, then `up after 7.2 s` or `failed: <reason>`.
   - The child's stdout and stderr go to `<registry dir>\logs\<id>.out.log` and `<id>.err.log`, the same files `hub.ps1` uses. So `hub.ps1 logs <id>` shows them. VN Studio appends, with a header line `--- started by VN Studio <ISO time> ---`. The folder is created if missing.
8. **Stopping.** By default VN Studio leaves what it started running. The next job and the next production reuse it, and `hub.ps1 stop` stops it (it stops by port). With `stopOnExit: true`, `Engine.stop()` kills the process trees VN Studio started in this run and only those (`taskkill /PID <pid> /T /F` on Windows). If the engine is killed hard (`hub.ps1 stop vn-studio` uses `taskkill /F`), `Engine.stop()` does not run and the services stay up. That is documented, not fixed.
9. **Windows process details.**
   - `spawn(file, args, { cwd, env, detached: true, windowsHide: true, shell: false, stdio: ['ignore', outFd, errFd] })`, then `child.unref()`, then close the two fds in the parent.
   - `shell: false`: no `cmd.exe`, no hand quoting. Node quotes arguments with spaces (ComfyUI's paths contain `Comfy Desktop`). Do not reuse `launch.ts`'s `shell: true` + `quote()` way.
   - No handle inheritance beyond the two log files: stdin is `ignore`, and stdout/stderr are fresh file descriptors, never VN Studio's own (`'inherit'` is not allowed). This is the cause of the hub's "hangs when piped" note: a child that inherits its parent's pipe keeps it open.
   - `detached: true`: the service gets its own process group, survives VN Studio's exit and does not get its Ctrl+C.
   - Environment: VN Studio's environment plus the entry's `start.env`, minus `ELECTRON_RUN_AS_NODE` (VN Studio's desktop app runs the engine in an Electron utility process, and that variable would turn `electron.exe` into node).
   - `~` at the start of `path`, `cwd` and each arg is replaced with the user's home folder, as `hub.ps1` does.
   - `electron` kind: `<repo>\node_modules\electron\dist\electron.exe` with the entry's args, cwd = repo. Refuse with "not built: run hub.ps1 build <id>" when `<repo>\out` is missing. `exe` kind: `path`, cwd = `start.cwd` or the repo. Refuse when the file does not exist. Nothing is spawned in either case.
10. **Branches.**
    - VN Studio: `VNO-11_start-studios` from `master` (7ff8a2d or later). Commits `VNO-11: ...`.
    - Hub: `HUB-08_vn-studio-starts-studios` from `master`, docs only. Commits `HUB-08: ...`.
    - No push and no PR without the user's go-ahead.

## Preconditions (check before starting)

- VN Studio's working tree is on `VNO-09_roadmap`, and `ROADMAP.md` is untracked (not on `master`). Ask the user to land VNO-09 first. If it is not landed, do the VN Studio `ROADMAP.md` edit in the untracked file and leave it out of the VNO-11 commits.
- The hub's working tree is on `HUB-01_roadmaps-to-repos` with uncommitted edits to `README.md`, `ROADMAP.md`, `CLAUDE.md` and the skill, the same files HUB-08 touches. Land HUB-01 first, then cut HUB-08 from `master`.
- Pixel Studio and Chiptune Studio are built (`out\` exists in both repos) for the live check.

## Open questions for the user

- **Q1. Should VN Studio start VibeTTS too?** It is a tray app (`managed: false`) that starts at login. Its MCP server must also be on in its `config.toml`, which a start does not fix. **Recommendation: no.** Keep the rule "`managed: false` is never started". Voice jobs keep failing with the start hint.
- **Q2. Start ComfyUI while Strata runs?** Strata uses most of the GPU. A started ComfyUI would load models next to it and may run out of memory. **Recommendation: do not start ComfyUI while Strata's health URL (`http://127.0.0.1:8080/health`, from the registry) answers.** Log "ComfyUI not started: Strata is running and uses most of the GPU". The job then fails as it does today.
- **Q3. Default for `stopOnExit`?** **Recommendation: `false`.** The services stay up for the next job and for Claude, and `hub.ps1 stop` stops them.
- **Q4. Auto-start on by default?** **Recommendation: yes (`enabled: true`).** Tests turn it off with `VNO_AUTOSTART=0`.

The implementation below follows the recommendations. If the user answers differently, the changes are small: Q1 adds `vibetts` to the known list and drops the `managed` rule for it; Q2 removes one guard; Q3 and Q4 change a default in the seed and the schema.

## Design

### New file `src/engine/studios/autostart.ts`

- `autostartConfigSchema` (zod) and `loadAutostartConfig(dataDir, env)`. Reads `config/autostart.md`. A missing or broken file gives the defaults. `VNO_AUTOSTART=0` sets `enabled: false`.
  ```yaml
  kind: autostart
  enabled: true
  registry: C:\projects\Personal\creative-hub\services.json
  services: [pixel-studio, chiptune-studio, comfyui]
  startTimeoutS: 0        # 0: the registry's startTimeout, else 60
  stopOnExit: false
  ```
- `loadRegistry(file)`: parses `services.json` with a lenient zod schema (`id`, `repo`, `port`, `mcp`, `http`, `managed`, `warning`, `startTimeout`, `start {kind, path, cwd, args, env}`). Unknown fields are kept and ignored.
- `KNOWN = ['pixel-studio', 'chiptune-studio', 'comfyui']` and `NEVER = ['scriptorium', 'strata']`.
- `canStart(entry, url, config): true | string`: the rules in decision 2. The string says why not.
- `startPlan(entry, overrides): { file, args, cwd, env } | string`: decision 9 (`~`, Electron path, `out\` check, exe check, studios.md exe override, env without `ELECTRON_RUN_AS_NODE`).
- `class ServiceStarter`
  - Constructor deps, all injectable for tests: `spawner` (the `Spawner` type from `launch.ts`), `probe(entry) => Promise<boolean>`, `openLog(file) => number`, `closeFd(fd)`, `kill(pid) => Promise<void>`, `now()`, `sleep(ms, signal)`, `log(msg)`, and `loadConfig()` (re-read per call, so a config edit applies without a restart).
  - `ensure(id, url, o: { signal?, log? }): Promise<true | string>`. Steps: config and registry checks, `canStart`, Strata guard for `comfyui` (Q2), cooldown check, probe, single-flight start, wait for health, log.
  - `stopStarted()`: only with `stopOnExit`. Kills the trees it started that are still alive.
  - `idForUrl(url)`: maps a URL to a known id by loopback and port. Used by the ComfyUI hook, which only knows the lane.
- Default deps: `child_process.spawn`, `net.connect` with a 1 s timeout for MCP entries, `fetch` with a 2 s timeout for `http` entries, `fs.openSync(file, 'a')`, `taskkill.exe /PID n /T /F` on Windows (`process.kill(-pid)` elsewhere).

### Hooks in the clients

- `studios/mcp-http.ts`: new option `ensureUp?: (signal?: AbortSignal) => Promise<true | string>`. In `request()`, on an `McpHttpError` of kind `unreachable` (from `init` or `rpc`) and only once per call: call `ensureUp`. On `true`, reset `ready` and retry. On a string, throw the original error with ` (auto-start: <reason>)` appended. Timeouts, HTTP errors and tool errors never call it.
- `studios/pixel.ts`, `studios/chiptune.ts`: pass `ensureUp` through their options to `createMcpClient`.
- `studios/config.ts`: `pixelClientFor(c, o?: { ensureUp })`, `chiptuneClientFor(c, o?)`. `startHint` gets an optional note: "VN Studio starts it when a job needs it (config/autostart.md)", shown when auto-start can start that studio.
- `comfy/client.ts`: new option `ensureLane?: (lane: string, signal?) => Promise<true | string>`. In `chooseLane()` and in the `firstReachableLane` call of `removeBackground`: when no lane answers at all (every reason is "unreachable", none is "busy"), call it for each loopback lane in order. On the first `true`, pick again. Otherwise keep today's error, with the reasons appended. A reachable but busy lane never triggers a start.

### Wiring

- `vn/service.ts`
  - `VnDeps.starter?: ServiceStarter`.
  - `studios(o?: { autoStart?: boolean; log?: (m: string) => void })`: with `autoStart` and a starter, builds the clients with `ensureUp: (signal) => starter.ensure('pixel-studio' | 'chiptune-studio', url, { signal, log })`. Injected fake clients (`deps.pixel`, `deps.chiptune`) are used as they are.
  - `comfy(o?: { autoStart?: boolean; log? })`: same idea with `ensureLane`. A `comfyOverride` is used as it is.
  - `importAsset` uses `studios({ autoStart: true })` and `comfy({ autoStart: true })`.
  - `studiosStatus`, `voiceStatus` and the comfy status keep calling without `autoStart`.
- `vn/handlers.ts`: `generateOne` (art, music, the draw mode) and the ComfyUI voice path call `svc.studios({ autoStart: true, log: ctx.log })` and `svc.comfy({ autoStart: true, log: ctx.log })`.
- `engine.ts`: `EngineOptions.starter?`. Without it the engine makes one with the default deps and `this.log`. It passes it to `registerVnHandlers`. `stop()` calls `await this.starter.stopStarted()` after `this.vn.dispose()`.

## File-by-file checklist

VN Studio (`C:\projects\Personal\visual-novels-orchestrator`, branch `VNO-11_start-studios`):

- [ ] `src/engine/studios/autostart.ts` (new): config, registry, policy, plan, `ServiceStarter`.
- [ ] `seed/config/autostart.md` (new): the YAML above with comments, and a body that explains each field, what is never started and why, where the logs go, and how to turn it off. A new seed file is copied into existing data folders at the next start, so no seed migration is needed.
- [ ] `src/engine/studios/mcp-http.ts`: `ensureUp` option and the retry once.
- [ ] `src/engine/studios/pixel.ts`, `src/engine/studios/chiptune.ts`: pass `ensureUp` through.
- [ ] `src/engine/studios/config.ts`: client factories take `{ ensureUp }`; `startHint` note.
- [ ] `src/engine/comfy/client.ts`: `ensureLane` option in `chooseLane` and `removeBackground`.
- [ ] `src/engine/vn/service.ts`: `starter` dep, `studios(o)`, `comfy(o)`, `importAsset`.
- [ ] `src/engine/vn/handlers.ts`: job paths ask for auto-start and pass `ctx.log`.
- [ ] `src/engine/engine.ts`: make and pass the starter, `stopStarted()` in `stop()`.
- [ ] `vitest.config.ts`: `test.env: { VNO_AUTOSTART: '0' }`, so no test ever starts a real app.
- [ ] `seed/config/studios.md`: the last bullet ("When a studio is not running...") now says VN Studio starts it first (see `config/autostart.md`) and falls back only when that fails.
- [ ] `docs/protocol.md`: `config/autostart.md` and `VNO_AUTOSTART` in the config part; the VibeTTS paragraph says it is not auto-started.
- [ ] `docs/mcp-guide.md`: one line under Generators: art and music jobs start Pixel Studio, Chiptune Studio and ComfyUI when needed.
- [ ] `README.md`: one line on auto-start next to the studio tokens paragraph.
- [ ] `ROADMAP.md`: move "Auto-start the studios" to done (VNO-11). Add: Start buttons on the Generators page; VibeTTS auto-start if Q1 changes; "Open in" while a headless studio holds the lock (see Known gaps). See the VNO-09 precondition.
- [ ] Tests (below).
- [ ] `.claude/tickets/VNO-11-start-studios/plan.md` (a copy of this plan) and `changelog.md`, as in the other VNO tickets.

Hub (`C:\projects\Personal\creative-hub`, branch `HUB-08_vn-studio-starts-studios`):

- [ ] `services.json` `_about`: add "VN Studio reads this file to start pixel-studio, chiptune-studio and comfyui (id, repo, port, mcp, http, managed, warning, startTimeout, start). Keep those fields when you change it."
- [ ] `README.md`, "Running it": VN Studio starts Pixel Studio, Chiptune Studio and ComfyUI itself when a job needs them. It never starts Scriptorium, Strata, VibeTTS or LM Studio. Turn it off in `~\VisualNovels\config\autostart.md`.
- [ ] `.claude/skills/make-visual-novel/SKILL.md`: §0 step 1 says VN Studio starts those three on demand, and that `hub.ps1 start` still works and shows failures sooner. The "MCP connection refused" line stays (it is about Claude's own MCP links).
- [ ] `ROADMAP.md`: VN Studio row, drop "auto-start studios" from "Open there"; one line in "Done".
- [ ] `.claude/tickets/HUB-08-vn-studio-starts-studios/verification.md`: what the live check showed, and what was not checked.

## Tests

Run in VN Studio: `yarn test`, `yarn typecheck`, `yarn lint`, `yarn build:engine`. All must pass. There were 717 tests at 7ff8a2d.

New `tests/autostart.test.ts`, with a fake spawner (an `EventEmitter` with `pid` and `unref()`, which emits `spawn` and, on demand, `exit`), a fake probe, a fake clock and a fake `kill`:

- Registry: reads a fixture copy of the hub's `services.json`; `~` is expanded in path, cwd and args.
- Policy:
  - `scriptorium` and `strata` are refused even when listed in `services`.
  - `vibetts` (`managed: false`) and an entry with `warning` are refused.
  - The `console` and `node` kinds are refused.
  - A non-loopback URL and a port that differs from the registry are refused.
  - `enabled: false` and `VNO_AUTOSTART=0` refuse.
  - A missing or broken registry means off, logged once.
- Start plan:
  - `electron`: `electron.exe` under the repo, args, cwd. Refused when `out\` is missing.
  - `exe` (ComfyUI): `path`, `cwd`, and args with spaces passed as they are (no added quotes).
  - The studios.md exe override gives `<exe> --mcp-only`.
  - The env has the entry's `env` and no `ELECTRON_RUN_AS_NODE`.
- Spawn options: `detached: true`, `windowsHide: true`, `shell: false`, `stdio[0] === 'ignore'`, `stdio[1]` and `stdio[2]` are numbers; `unref()` is called; the fds are closed.
- Waiting:
  - Already up: no spawn, returns true.
  - Up after N polls: one spawn, returns true, logs "up after".
  - The child exits early: the reason has the exit code and the err log tail.
  - Timeout: the reason names the timeout. The abort signal stops the wait.
- Three concurrent `ensure` calls give one spawn.
- Cooldown: after a failure, a second `ensure` within 5 minutes spawns nothing; after the fake clock passes 5 minutes, it spawns again.
- Strata guard (Q2): `comfyui` is refused while the Strata probe answers.
- `stopStarted()`: with `stopOnExit` it kills only the pids it started that are still alive; without it, nothing.

Extend existing tests:

- `tests/mcp-http.test.ts`: on unreachable, `ensureUp` is called once, then the call is retried and succeeds. When `ensureUp` returns a string, the error has the reason. Timeout and HTTP errors do not call it. It is called at most once per call.
- `tests/comfy-client.test.ts`: no lane answers, so `ensureLane` is called for the loopback lane and the job goes to it. A reachable busy lane does not call it. Same for `removeBackground`.
- `tests/studios-pipeline.test.ts` or `tests/vn-handlers.test.ts`: with a fake starter, `studiosStatus` and `voiceStatus` never call `ensure`. A music job with a Chiptune client that is first unreachable calls `ensure('chiptune-studio')` and finishes.
- `tests/seed-refresh.test.ts` or a new small test: `seed/config/autostart.md` parses with the schema and gives `enabled: true`.

## Live verification from the hub

Run from `C:\projects\Personal\creative-hub` after the unit tests pass. Never pipe `hub.ps1 start` (redirect to a file if needed). Do not start Scriptorium.

1. Build and restart VN Studio from the branch: `hub.ps1 build vn-studio`, `hub.ps1 stop vn-studio`, `hub.ps1 start vn-studio`. Reconnect `/mcp`, or use `hub.ps1 call vn-studio ...`.
2. Check that `~\VisualNovels\config\autostart.md` was seeded, and that the engine log (`hub.ps1 logs vn-studio`) has no autostart warning.
3. `hub.ps1 start comfyui` (pixel backgrounds start from a ComfyUI render). Close the Pixel Studio and Chiptune Studio desktop apps if open. Run `hub.ps1 stop pixel-studio chiptune-studio`, then `hub.ps1` and see both down.
4. Make a small test project, `hub08-autostart-test`: `vno_create_project` with one character, one place and one chapter with one scene. Then `vno_update_settings {slug, art: {style: "pixel", pixelProvider: "pixel-studio"}, music: {provider: "chiptune", chip: "nes", tracks: 1}}`.
5. Music: `vno_asset_generate {slug, only: ["music_01"], wait: false}`, then `vno_wait {slug, timeoutSeconds: 240}`. Expect:
   - VN Studio's log: `autostart chiptune-studio: down, starting ...` and `up after ... s`.
   - `hub.ps1` shows chiptune-studio up, and `hub.ps1 logs chiptune-studio` has the VN Studio header.
   - The asset has a new `.ogg` version with loop points, and the job finished.
6. Art: `vno_asset_generate {slug, only: ["<the place's background id>"], wait: false}`, then `vno_wait`. Expect pixel-studio to start the same way, the job to finish, and no "used the built-in pixelate" warning on the asset.
7. Optional, only if Strata is down: `hub.ps1 stop comfyui`, then generate the background again with `force: true`. Expect ComfyUI to start (up to 240 s) and the job to finish. If Strata is up, check instead that the log says ComfyUI was not started because of Strata.
8. Off switch: set `enabled: false` in `config/autostart.md`, run `hub.ps1 stop chiptune-studio`, then generate `music_01` with `force: true`. Expect no start and today's "not running" error. Set it back to `true`.
9. `hub.ps1 stop pixel-studio chiptune-studio` stops what VN Studio started. `hub.ps1` shows Scriptorium and Strata still down.
10. Write `verification.md` in this ticket folder: each step, pass or fail, timings, and what was not checked. Leave the test project in place and name its slug there.

## Known gaps (record in VN Studio's ROADMAP.md)

- "Open in Pixel Studio / Chiptune Studio" starts a window. When a headless studio holds the studio's `engine.lock` (started by VN Studio or by the hub), the window cannot take the data folder, but `launchStudio` already reported success. This was already true with `hub.ps1 start`.
- A hard kill of VN Studio leaves the services it started running, even with `stopOnExit: true`.
- No Start buttons in the UI yet.

## Implementation notes (2026-10-22, VN Studio side)

User answers: Q1 no VibeTTS auto-start, Q2 do not start ComfyUI while Strata answers, Q3 `stopOnExit: false`, Q4 `enabled: true`. Branch: the shared `VNO-10-19_hub-roadmap` instead of `VNO-11_start-studios`; VNO-09 and HUB-01 are merged, so the ROADMAP.md edit is committed.

Checklist (VN Studio): all done except `yarn build:engine` (not run on request) and the live check (the orchestrator does it).

- [x] `src/engine/studios/autostart.ts`, `seed/config/autostart.md`
- [x] `mcp-http.ts` (`ensureUp`, one retry), `pixel.ts`, `chiptune.ts`, `config.ts` (`ClientHooks`)
- [x] `comfy/client.ts` (`ensureLane`, only when every lane is unreachable)
- [x] `vn/service.ts` (`starter` dep, `studios(o)`, `comfy(o)`, `importAsset`), `vn/handlers.ts` (job paths), `engine.ts` (starter, `stopStarted()`)
- [x] `vitest.config.ts` (`VNO_AUTOSTART=0`), `seed/config/studios.md`, `docs/protocol.md`, `docs/mcp-guide.md`, `README.md`, `ROADMAP.md`
- [x] `tests/autostart.test.ts` (31 tests)

Deviations from the plan text:
- `startHint` is unchanged (no extra note): a failed start already appends `(auto-start: <reason>)`.
- Electron start also checks that `node_modules\electron\dist\electron.exe` exists (reason: run yarn install).
- The start wait is shared per service and each caller races its own abort signal, so one job being stopped does not cancel another job's wait.
- Tests of the pipeline are in `tests/autostart.test.ts` (service wiring with a fake starter), not in `studios-pipeline.test.ts`.
