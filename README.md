# VN Studio

An Electron + TypeScript desktop app that takes a visual-novel book written in [Scriptorium](../scriptorium) (or any folder in the same format), has a small team of AI agents plan and generate its art, music and optional voice with ComfyUI, and builds a Ren'Py game for desktop and Android.

- Books are English or Croatian. A translated edition you wrote yourself reuses every asset and only replaces the text. There is no machine translation.
- Models: local ones (LM Studio, Strata) plus every Scriptorium provider (DeepSeek, Anthropic, Gemini, OpenRouter, other OpenAI-compatible APIs). Pick the models on the Models page and a model per agent on the Agents page.
- The engine core (model router, job queue, agents) is a plain copy of Scriptorium's. The plan is in `.claude/tickets/VNO-01-visual-novel-studio-scriptorium-book-ren/plan.md`.

Status: working end to end (VNO-01 to VNO-03): import a Scriptorium book, the agent pipeline, ComfyUI / Pixel Studio / Chiptune Studio assets, editions, VibeTTS voices, the Ren'Py and Android build, and an MCP server (HTTP, or headless with no window).

## Setup

Node 24 through fnm, Yarn 4.

```
fnm use 24
yarn install
```

## Scripts

| Script | What it does |
| --- | --- |
| `yarn dev` | Builds the engine and starts the desktop app with hot reload |
| `yarn build` | Builds the engine, main, preload and renderer into `out/` |
| `yarn engine [-- probe]` | Runs the headless engine; `probe` sends one short request to a model |
| `yarn mcp [--port N]` | The engine without Electron, serving MCP over HTTP (headless mode, below) |
| `yarn key:set <NAME>` | Stores an API key (for example `DEEPSEEK_API_KEY`) in the Windows credential store |
| `yarn test` | Vitest |
| `yarn typecheck` | `tsc` for the node and web projects |
| `yarn lint` | ESLint |

API keys come from environment variables or the Windows credential store (service `vn-studio`), never from files.

## Command line and MCP

The same engine runs headless: `yarn engine -- <command>` (`yarn engine -- help` lists everything). It starts the scheduler and the agents, enqueues the jobs, prints the progress and exits when the project has nothing left to run. Exit codes: 0 ok, 1 a job failed or lint found problems, 3 lint could not run (no Ren'Py SDK, not built).

```
yarn engine -- books                                    # the Scriptorium library
yarn engine -- import <folder|slug> [--lang hr]         # make a project (shows the detected language)
yarn engine -- run <slug> [--from art] [--force]        # the pipeline: import analyse art music generate voice stage build lint
yarn engine -- edition add <slug> <folder> --lang hr    # a translated edition (you translated it; no machine translation)
yarn engine -- analyse|plan|assets|generate <slug> ...  # single steps: settle the script, write prompts, list, generate (--only id, --kind k)
yarn engine -- asset replace|pick|regen|lock|unlock <slug> <id> ...
yarn engine -- build|lint|play|android|voice <slug>
yarn engine -- comfy status|free
yarn engine -- themes
```

`yarn engine -- mcp` serves the same operations as MCP tools on stdio, for clients that cannot speak HTTP: `claude mcp add vn-studio -- yarn --cwd <repo> engine -- mcp`. When an engine already runs on the data folder (the app, or `yarn mcp`) it relays to that engine's MCP server instead of starting a second one. The engine protocol for the UI is in `docs/protocol.md`.

### MCP server (HTTP)

The app's engine serves MCP (Streamable HTTP) at `http://127.0.0.1:7459/mcp` while it runs, so an outside agent drives the same projects and the window shows its work live:

```
claude mcp add --transport http vn-studio http://127.0.0.1:7459/mcp
```

- Settings > MCP shows the state and the connection lines, and sets on/off, the port and an optional bearer token. They live in `config/mcp.md` (`enabled`, `port`, `token`), which is reloaded live; `VNO_MCP_PORT` and `VNO_MCP_TOKEN` override the port and the token for one run. 7457, 7458 and 7723 are taken by Pixel Studio, Chiptune Studio and VibeTTS.
- The server only listens on `127.0.0.1`, checks the Host and Origin headers, and runs every call on its own, so `vno_wait` does not hold up `vno_status`.
- Tools (`docs/mcp-guide.md` is the guide the server also serves as the resource `vn-studio://guide`):
  - library and projects: `vno_list_books`, `vno_import`, `vno_list_projects`, `vno_get_project`, `vno_update_settings`, `vno_delete_project`
  - pipeline and queue: `vno_run_pipeline`, `vno_status`, `vno_wait`, `vno_pause_all`, `vno_resume_all`, `vno_stop_now`
  - editions: `vno_add_edition`, `vno_get_edition`, `vno_update_beat`, `vno_align_report`
  - assets: `vno_asset_list`, `vno_asset_replace`, `vno_asset_regen`, `vno_asset_pick`, `vno_asset_lock`, `vno_asset_unlock`, `vno_asset_generate`
  - voice: `vno_voice_status`, `vno_voice_plan`, `vno_voice_set`, `vno_voice_preview`, `vno_voice_generate`
  - generators and build: `vno_studios_status`, `vno_comfy_status`, `vno_comfy_free`, `vno_themes`, `vno_build`, `vno_lint`, `vno_android_preflight`, `vno_android_build`, `vno_renpy_config_get`, `vno_renpy_config_set`
- Only one engine can use a data folder: `engine.lock` in it names the running one (its pid and MCP url). A second `yarn engine -- <command>`, `yarn mcp` or app start says "VN Studio is already running on this data folder (pid N). Use its MCP at <url> or close it." and exits with 1. A lock left by a process that died is replaced.

### Headless mode (no window)

```
yarn mcp                          # = yarn build:engine && node out/engine/index.js --mcp-only   (port from config/mcp.md, 7459)
yarn mcp --port 7500              # another port
<VN Studio.exe> --mcp-only        # the packaged app: no window, no tray
```

It prints `MCP listening on http://127.0.0.1:<port>/mcp` and runs until Ctrl+C, serving every tool with no Electron. It serves even when `config/mcp.md` has `enabled: false`. If the port is taken, or the data folder is in use by another engine, it prints why and exits with 1.

## Data folder

Default `~/VisualNovels`; override with `--data <dir>` or the `VNO_DATA` environment variable. It is created from `seed/` at start and existing files are never overwritten.

```
config/      providers.md, roles.md, models.md, settings.md, budget.md, mcp.md, ... (YAML frontmatter, reloaded live)
agents/      one file per agent: role, name, model override
prompts/     <role>/<task>.md prompt templates
projects/    <slug>/ project.md, vn.json, editions/<lang>.json, assets.json, assets/, voice/, game/
jobs/        queued, running, done, failed
engine.lock  names the engine that runs on this folder (pid, MCP url); removed when it stops
logs/        per agent, and spend rows
```

`config/settings.md` has `scriptoriumData` (default `~/Scriptorium`): the Library lists the books in its `books/` folder.

## Layout

- `src/engine`: headless engine (models, budget, queue, agents, logs, store, `vn/` pipeline handlers)
- `src/main`, `src/preload`: Electron main and the `window.vnstudio` bridge
- `src/renderer`: React UI (Library, Book, Models, Agents, ComfyUI, Settings)
- `src/shared`: protocol, schemas, markdown helpers, and `vn.ts` (the VN data contract)
- `seed/`: default config, agents and prompts
