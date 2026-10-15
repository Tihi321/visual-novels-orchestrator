# VN Studio

An Electron + TypeScript desktop app that takes a visual-novel book written in [Scriptorium](../scriptorium) (or any folder in the same format), has a small team of AI agents plan and generate its art, music and optional voice with ComfyUI, and builds a Ren'Py game for desktop and Android.

- Books are English or Croatian. A translated edition you wrote yourself reuses every asset and only replaces the text. There is no machine translation.
- Models: local ones (LM Studio, Strata) plus every Scriptorium provider (DeepSeek, Anthropic, Gemini, OpenRouter, other OpenAI-compatible APIs). Pick the models on the Models page and a model per agent on the Agents page.
- The engine core (model router, job queue, agents) is a plain copy of Scriptorium's. The plan is in `.claude/tickets/VNO-01-visual-novel-studio-scriptorium-book-ren/plan.md`.

Status: Phase 0 (app shell, model layer, vision-capable messages). Library, Book and ComfyUI pages are placeholders.

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

`yarn engine -- mcp` serves the same operations as MCP tools on stdio (`vno_list_books`, `vno_import`, `vno_list_projects`, `vno_run_pipeline`, `vno_status`, `vno_asset_list`, `vno_asset_replace`, `vno_asset_regen`, `vno_build`, `vno_lint`, `vno_add_edition`): `claude mcp add vn-studio -- yarn --cwd <repo> engine -- mcp`. The engine protocol for the UI is in `docs/protocol.md`.

## Data folder

Default `~/VisualNovels`; override with `--data <dir>` or the `VNO_DATA` environment variable. It is created from `seed/` at start and existing files are never overwritten.

```
config/      providers.md, roles.md, models.md, settings.md, budget.md (YAML frontmatter, reloaded live)
agents/      one file per agent: role, name, model override
prompts/     <role>/<task>.md prompt templates
projects/    <slug>/ project.md, vn.json, editions/<lang>.json, assets.json, assets/, voice/, game/
jobs/        queued, running, done, failed
logs/        per agent, and spend rows
```

`config/settings.md` has `scriptoriumData` (default `~/Scriptorium`): the Library lists the books in its `books/` folder.

## Layout

- `src/engine`: headless engine (models, budget, queue, agents, logs, store, `vn/` pipeline handlers)
- `src/main`, `src/preload`: Electron main and the `window.vnstudio` bridge
- `src/renderer`: React UI (Library, Book, Models, Agents, ComfyUI, Settings)
- `src/shared`: protocol, schemas, markdown helpers, and `vn.ts` (the VN data contract)
- `seed/`: default config, agents and prompts
