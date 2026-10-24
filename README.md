# VN Studio

An Electron + TypeScript desktop app that takes a visual-novel book written in [Scriptorium](../scriptorium) (or any folder in the same format), has a small team of AI agents plan and generate its art, music and optional voice with ComfyUI, and builds a Ren'Py game for desktop and Android.

- A book can be in any of 37 languages (the 31 that VibeTTS Supertonic reads plus Book Translator's; more in `config/languages.md`), and the language is detected. A translated edition (a translated book folder, or text written over MCP) reuses every asset and only replaces the text. There is no machine translation inside VN Studio.
- A story can also be written straight into VN Studio over MCP (`vno_create_project` and the story tools), with no Scriptorium folder.
- A story can stop for a logic puzzle (a 3x3 Murdle so far): code makes and proves it, a `puzzle` beat plays it (`vno_puzzle_*` tools, `docs/mcp-guide.md` "Puzzles").
- Models: local ones (LM Studio, Strata) plus every Scriptorium provider (DeepSeek, Anthropic, Gemini, OpenRouter, other OpenAI-compatible APIs), any OpenAI-compatible server you add yourself in the Models page (Add provider, see Providers below), a seeded but switched-off `acp` entry for the ACP proxy, and the `client` provider (on by default, used only when you pick it): set a role to `client/claude-code` (or `client/antigravity`) and an MCP client (Claude Code, Antigravity CLI) answers its model calls itself, for free (`vno_get_task` / `vno_submit_task`). Pick the models on the Models page and a model per agent on the Agents page.
- The engine core (model router, job queue, agents) is a plain copy of Scriptorium's. The plan is in `.claude/tickets/VNO-01-visual-novel-studio-scriptorium-book-ren/plan.md`.

Status: working end to end (VNO-01 to VNO-04): import a Scriptorium book or write the story over MCP, the agent pipeline, ComfyUI / Pixel Studio / Chiptune Studio assets, editions, VibeTTS voices, the Ren'Py and Android build, and an MCP server (HTTP, or headless with no window).

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
| `npx tsx scripts/puzzle-poc.ts --lint --play` | Builds the puzzle proof of concept (`templates/puzzles/`, a 3x3 Murdle grid) into `.claude/temp/puzzle-poc/`, lints it and opens it; `--selftest` clicks through it with Ren'Py's test runner |

API keys come from environment variables or the Windows credential store (service `vn-studio`), never from files. A key that is not found there is also looked for under the services `scriptorium` and `book-translator`, so the keys of those tools work here; `VNO_SHARED_KEYS=0` turns that off. The Models page says when a key comes from another store. Studio tokens (`PIXEL_STUDIO_MCP_TOKEN`, `CHIPTUNE_STUDIO_MCP_TOKEN`, `VIBETTS_MCP_TOKEN`) are looked up the same way.

A job that needs Pixel Studio, Chiptune Studio or ComfyUI starts it when it is down (from the creative hub's `services.json`; `config/autostart.md`, `VNO_AUTOSTART=0` turns it off). VibeTTS, Scriptorium and Strata are never started.

Google Flow (through the hub's `flow-music-mcp`) can make a project's images (`art.provider: flow`, free), voices and music: see `docs/mcp-guide.md`, "Google Flow".

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
  - library and projects: `vno_list_books`, `vno_set_library`, `vno_import`, `vno_list_projects`, `vno_get_project`, `vno_update_settings`, `vno_delete_project`, `vno_languages`, `vno_fonts_fetch`
  - story (no book folder): `vno_create_project`, `vno_get_story`, `vno_story_edit`, `vno_book_update`, `vno_character_set`, `vno_character_remove`, `vno_place_set`, `vno_place_remove`, `vno_chapter_add`, `vno_chapter_update`, `vno_chapter_remove`, `vno_scene_add`, `vno_scene_update`, `vno_scene_remove`, `vno_beat_add`, `vno_beat_update`, `vno_beat_remove`, `vno_image_set`, `vno_image_remove`, `vno_sound_set`, `vno_sound_remove`
  - pipeline and queue: `vno_run_pipeline`, `vno_plan`, `vno_status`, `vno_wait`, `vno_pause_all`, `vno_resume_all`, `vno_stop_now`, `vno_clear_queue`
  - model work done by the client (`client/claude-code`): `vno_client_tasks`, `vno_get_task`, `vno_submit_task`, `vno_release_task`
  - editions: `vno_add_edition`, `vno_edition_set`, `vno_get_edition`, `vno_update_beat`, `vno_align_report`
  - assets, music and staging: `vno_asset_list`, `vno_asset_set`, `vno_asset_replace`, `vno_asset_import`, `vno_asset_regen`, `vno_asset_pick`, `vno_asset_lock`, `vno_asset_unlock`, `vno_asset_generate`, `vno_set_music`, `vno_set_cues`
  - voice: `vno_voice_status`, `vno_voice_plan`, `vno_voice_set`, `vno_voice_preview`, `vno_voice_generate`, `vno_voice_import`
  - generators and build: `vno_studios_status`, `vno_comfy_status`, `vno_comfy_free`, `vno_themes`, `vno_build`, `vno_lint`, `vno_android_preflight`, `vno_android_build`, `vno_renpy_config_get`, `vno_renpy_config_set`
- Only one engine can use a data folder: `engine.lock` in it names the running one (its pid and MCP url). A second `yarn engine -- <command>`, `yarn mcp` or app start says "VN Studio is already running on this data folder (pid N). Use its MCP at <url> or close it." and exits with 1. A lock left by a process that died is replaced.

### Headless mode (no window)

```
yarn mcp                          # = yarn build:engine && node out/engine/index.js --mcp-only   (port from config/mcp.md, 7459)
yarn mcp --port 7500              # another port
<VN Studio.exe> --mcp-only        # the packaged app: no window, no tray
```

It prints `MCP listening on http://127.0.0.1:<port>/mcp` and runs until Ctrl+C, serving every tool with no Electron. It serves even when `config/mcp.md` has `enabled: false`. If the port is taken, or the data folder is in use by another engine, it prints why and exits with 1.

## Providers

`config/providers.md` lists the model providers (its text below the frontmatter documents every field). Besides the seed ones (DeepSeek, OpenRouter, Anthropic, Gemini, LM Studio, Strata, Ollama, `acp`, `client`) you can add your own:

- **Add provider** (Models page, under the provider list) takes any OpenAI-compatible server: a name, the base URL, an optional API key, **Free (local)** (no key needed, no budget, never paid), **Send JSON schema** (off by default: leave it off for servers that reject a bad JSON answer), **Parallel** (a number, or `auto`), **Enabled**, and a **Test** button that calls `GET /models` and says how many models answered. It is saved in `config/providers.md` as an entry with `custom: true` and `name`; only such entries get **Edit** and **Remove** (remove also deletes the stored key and clears the provider from `config/models.md` and `config/settings.md`). Comments and hand edits in the file are kept.
- The key goes to the Windows credential store as `CUSTOM_<ID>_API_KEY` (the id is the name as a slug: `ACP proxy (home)` is `acp-proxy-home`), never into a file. Settings > Provider API key lists every key name the providers use, custom ones too.
- A custom provider is its own group in the fallback order (Models page: one row each, with its default model and up and down buttons) and its id works as an alias in `config/roles.md`, like `strata`: `acp-proxy-home` stands for the group default in `config/settings.md` (`group_defaults`), else its first ticked model. Detect models, Tick and "Add a model by its id" work as for any provider; tick **vision** when adding a model that accepts images, so the art-critic is offered it.
- The seed `acp` entry (off, `http://127.0.0.1:7461/v1`, free, text only) is for the ACP proxy (`api-acp-proxy`: Antigravity, Codex and Claude over ACP). Start the proxy with `PROXY_IGNORE_SAMPLING=1` (VN Studio sends `temperature`, `max_tokens` and `stream_options`) and a `PROXY_TIMEOUT_MS` that covers your longest request. It has no vision, so it cannot serve the art-critic. Using Antigravity's models through a proxy may break Google's terms: see the creative-hub `ROADMAP.md`, "Antigravity models and the ACP proxy". Older data folders get the entry once at the next start (deleted later, it stays gone).
- The `client` provider has named clients, one model each: `claude-code` and `antigravity` (both `vision: true`). A task made for `client/antigravity` is only handed to an MCP client that asks for it (`vno_get_task {client: "antigravity"}`); `vno_get_task` without `client` means `claude-code`. See `docs/mcp-guide.md`, "Antigravity CLI as a client".
- `config/settings.md` keeps the default model of each group in `group_defaults` (`paid`, `strata`, `lmstudio`, a custom provider's id). The older `default_paid_model`, `default_strata_model` and `default_lmstudio_model` are still read and are replaced by `group_defaults` the next time the app saves the settings.

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
