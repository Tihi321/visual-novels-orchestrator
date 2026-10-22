# VNO-11 changelog (2026-10-22)

## Behaviour

When a job needs Pixel Studio, Chiptune Studio or ComfyUI and nothing answers, VN Studio starts it from the hub's `services.json`, polls every 500 ms until it answers (TCP connect for MCP entries, `GET <http>` for ComfyUI), and retries the call once. Timeout: `startTimeoutS`, else the registry's `startTimeout` (ComfyUI 240 s), else 60 s. A child that exits early fails the wait at once with its exit code and the last 20 lines of its err log.

- Policy (`canStart`): only those three ids, narrowed by `services`; never scriptorium or strata; `managed: true`, no `warning`, start kind `electron` or `exe`; loopback URL whose port is the registry's; enabled and `VNO_AUTOSTART` not 0. ComfyUI is not started while Strata answers. VibeTTS is never started.
- One start at a time per service (shared promise); a failed start is remembered for 5 minutes. A failed start gives today's error with ` (auto-start: <reason>)` added, so Pixel Studio work still falls back to the built-in pixelate.
- Status checks (`studiosStatus`, `voiceStatus`, `comfyStatus`, CLI, Generators page) never start anything; art/music/draw jobs, the ComfyUI voice path and `importAsset` do.
- Spawn: `detached`, `windowsHide`, `shell: false`, stdin ignored, stdout/stderr to fresh fds appended to `<registry dir>\logs\<id>.out.log` / `.err.log` after `--- started by VN Studio <time> ---`; no `ELECTRON_RUN_AS_NODE`; `~` expanded; `pixelStudioExe` / `chiptuneStudioExe` from `config/studios.md` run as `<exe> --mcp-only`. `out\` missing: "not built: run hub.ps1 build <id>".
- `stopOnExit: true` kills the process trees this run started, in `Engine.stop()`. Default false.
- Config: new seed file `config/autostart.md` (copied to existing data folders at the next start).

## Files

New: `src/engine/studios/autostart.ts`, `seed/config/autostart.md`, `tests/autostart.test.ts`. Changed: `src/engine/studios/{mcp-http,pixel,chiptune,config}.ts`, `src/engine/comfy/client.ts`, `src/engine/vn/{service,handlers}.ts`, `src/engine/engine.ts`, `vitest.config.ts` (`VNO_AUTOSTART=0` for every test), `seed/config/studios.md`, `docs/protocol.md`, `docs/mcp-guide.md`, `README.md`, `ROADMAP.md`.

## Verification

`yarn test`: 58 files, 783 tests pass (752 before, 31 new; fake spawner, probe, clock and kill, no real app started). `yarn typecheck`, `yarn lint`: clean. Not run: `yarn build:engine` (not allowed here) and the live check from the hub (plan section "Live verification").
