# PROD-01 handoff — finish the unfinished books and their VN games

Last updated: 2026-10-27 09:55 (Europe/Warsaw). Read this with `plan.md` and `run-log.md` in
the same folder. The production is still running: the Scriptorium and VN Studio engines and
three Windows scheduled tasks keep working while no session is open.

**Resuming in a new thread:** the session goal is paused; this file is the entry point. Ask
the agent to continue PROD-01, run `node scripts/prod-status.mjs` and pick up at "What to do
next". Do not re-decide the model/spend choices below; they were agreed with the user on
2026-10-26. The machine must be awake for the engines and scheduled tasks to work (it slept
overnight on 2026-10-26/27, so nothing advanced between 23:46 and 09:20).


## The request

"Check books that are not done, finish to end, and use all local except images" — later
amended: text agents may use DeepSeek (paid), images Google Flow (free cloud), music/SFX/
ambience/voice local. Then: "slowly finish, make handoff and commit all and push, so we can
continue tomorrow."

## Ticket and repositories

- Ticket: `.claude/tickets/PROD-01-finish-unfinished-books-and-vns/` (`plan.md`, `run-log.md`,
  this file).
- VN Studio repo (this one): `C:\projects\Personal\visual-novels-orchestrator`, branch
  `master`, remote `git@github.com:Tihi321/visual-novels-orchestrator.git`.
- Scriptorium repo: `C:\projects\Personal\scriptorium` (only a config/prompt change, not
  committed there; see "Changes outside this repo").
- Data folders: `C:\Users\Infplane\Scriptorium` (books) and `C:\Users\Infplane\VisualNovels`
  (VN projects). Neither is in git.
- Creative hub: `C:\projects\Personal\creative-hub` (`scripts\hub.ps1` starts/stops services;
  logs in `creative-hub\logs`).

## What was changed in this repo (new files, one commit)

Scripts, all runnable with Node 24 (`fnm exec --using=24 node scripts/<name>.mjs`):

- `scripts/mcp-call.mjs` — minimal MCP Streamable-HTTP client used to drive Scriptorium
  (7341), VN Studio (7459) and flow-music-mcp (7462) without an MCP link.
  Example: `node scripts/mcp-call.mjs --url http://127.0.0.1:7341/mcp --tool factory_status`.
- `scripts/prod-status.mjs` — compact status of both apps (`all`, `books`, `vn`).
- `scripts/prod-watch.mjs` — the production watchdog: when one of the five books publishes it
  calls `adapt_book` (format `visual-novel`); when such an adaptation publishes it imports it
  into VN Studio, applies the project settings (noir theme, Flow illustrated art, ComfyUI
  ACE-Step music/ambience, Chiptune SFX, voices off, DeepSeek text agents) and starts the
  pipeline once. State: `.claude/temp/prod01/watch-state.json`, log `watch.log`. Supports
  `--once` (used by the scheduled task).
- `scripts/scriptorium-nudge.mjs` — restarts Scriptorium only when its scheduler is idle
  (no running job) while jobs are queued or books are unfinished. Log:
  `.claude/temp/prod01/nudge.log`.
- `scripts/service-guard.mjs` — starts flow-music-mcp / VN Studio / Scriptorium again when
  their MCP port does not answer. Log: `.claude/temp/prod01/service-guard.log`.
- `scripts/dup-check.mjs` — 8-word-shingle overlap between adjacent chapters of every book in
  `~/Scriptorium/books`; the detector for the duplicated-climax writer defect below.

## Changes outside this repo (not in git)

- `~/Scriptorium/config/providers.md`: added `lmstudio/minicpm-v-4.7-35b-a3b` (vision) and
  kept gemma; nail's `reasoning_effort` is `none`.
- `~/Scriptorium/config/settings.md`: fallbacks are **deepseek/deepseek-flash, then
  lmstudio/gemma-4-e4b-it-ultra-uncensored-heretic**; `fallback_shared: true`;
  `lmstudio_parallel: 2`, `lmstudio_context: 131072`, `lmstudio_ttl_minutes: 28800`.
- `~/Scriptorium/config/budget.md`: **daily cap raised from 5 to 20 USD** (monthly 40 stays).
  User allowed DeepSeek on 2026-10-26. Spend at handoff: **5.19/20 today, 12.11/40 month**.
- `~/Scriptorium/config/factory.md`: `paused: false`, `max_books_in_progress: 5`.
- `~/Scriptorium/agents/*.md`: cleared 21 per-agent `model: deepseek/...` overrides so agents
  follow the role/fallback chain. `editor-in-chief` has `model: null`.
- `~/Scriptorium/prompts/writer/{draft_chapter,rewrite_chapter,draft_chapter_vn,rewrite_chapter_vn}.md`:
  added a hard "never repeat a scene/beat/line from another chapter" rule.
- `~/VisualNovels/config/providers.md`: added the MiniCPM entry (vision); DeepSeek is the
  provider used by the VN project settings the watchdog applies.

## Services and automation (leave running)

- Scriptorium headless, Electron, MCP `http://127.0.0.1:7341/mcp` (data `~/Scriptorium`).
- VN Studio headless, Node, MCP `http://127.0.0.1:7459/mcp` (data `~/VisualNovels`).
- ComfyUI 8188, Chiptune Studio 7458, flow-music-mcp 7462 (Flow signed in; stop via
  `pwsh -File C:\projects\Personal\creative-hub\scripts\hub.ps1 status|stop`).
- LM Studio headless (`"…\LM Studio\LM Studio.exe" --headless` with `ELECTRON_RUN_AS_NODE`
  removed); only the small gemma model is loaded as a fallback — DeepSeek does the text.
- Scheduled tasks (user session, survive this session):
  - `VNO-PROD01-watch` — `node scripts/prod-watch.mjs --once`, every 5 minutes.
  - `VNO-PROD01-nudge` — `node scripts/scriptorium-nudge.mjs`, every 10 minutes.
  - `VNO-PROD01-guard` — `node scripts/service-guard.mjs`, every 10 minutes: starts
    flow-music-mcp (7462), VN Studio (7459) or Scriptorium (7341) again when one is found
    down. flow-music-mcp was crash-looping at handoff (prints "MCP listening" then exits
    within a minute); the guard restarts it, and it answered `flow_status` (Chrome up) after
    the restart. If a VN pipeline fails its art stage because Flow was down, restart Flow,
    then continue that project from `art` with `vno_run_pipeline {slug, from: "art"}`.
  Query: `schtasks /Query /TN VNO-PROD01-watch /V /FO LIST`.
  Remove: `schtasks /Delete /TN <name> /F`.

## State at handoff (2026-10-27 09:55)

Scriptorium: **28 published** (the-silent-summit was reopened, so it counts as reviewing),
`reviewing: 2` (`echoes-in-the-deep`, `the-silent-summit` round 4),
`rewriting: 1` (`the-salt-line`), 29 jobs queued. Two reviewers run at a time on gemma (see
the review-family note below), which is the current slow lane.

The five stalled books:

| Book | State | Score |
|---|---|---|
| circuit-breaker | published (`out/circuit-breaker.epub`) | 7.33 |
| the-silent-signal | published | 7.85 |
| the-silent-summit | reopened round 4 for the ch 5 duplicate; reviewing now | was 7.15 |
| echoes-in-the-deep | reviewing (duplication fixed by hand in ch 7) | — |
| the-salt-line | rewriting (reviewers requested all chapters) | — |

Adaptations (Scriptorium `adapt_book`, linear): **circuit-breaker-2** (8.57),
**the-silent-signal-2** (8.93), **the-silent-summit-2** (8.79) published. Adaptations of
echoes and the-salt-line do not exist yet — the watchdog creates them when the source books
publish.

VN Studio games — **four finished**, build and lint clean:

| Project | Blocks | Words | Images | Chapters |
|---|---|---|---|---|
| the-local-patch-2 | 725 | 8,887 | 50 | 5 |
| circuit-breaker-2 | 982 | 15,531 | 54 | 10 |
| the-silent-signal-2 | 976 | 15,219 | 46 | 10 |
| the-silent-summit-2 | 731 | 14,553 | 35 | 8 |

Game entry points: `C:\Users\Infplane\VisualNovels\projects\<slug>\game\index.html`.
The Local Patch title screen was verified in headless Chrome; the screenshot is
`.claude/temp/prod01/patch2-title.png` (gitignored).

## Important decisions (do not re-litigate)

- Text agents: DeepSeek first, local gemma fallback. The local 35B models were unusable here
  (two of them exceed the 31.6 GB RAM; throughput collapsed to 0.18 tokens/s and LM Studio
  crashed once). Do not switch back to MiniCPM/nail for this production.
- Images: Google Flow only (free, ~50 s an image, one image at a time per lane).
- Audio: local — ComfyUI ACE-Step for music and ambience, Chiptune Studio for SFX. Voices are
  **off** for every project (a novella has 1,000+ lines); offer them separately if the user
  wants them later.
- Daily DeepSeek cap 20 USD, monthly 40. Do not raise the monthly cap without asking.
- VN projects use noir theme, illustrated style, 3 music tracks, `sfxEngine: chiptune`,
  `ambienceEngine: ace-step-v1-instrumental`.
- **Reviews deliberately avoid the writer's model family** (`avoid_family: deepseek` on review
  jobs). With DeepSeek + gemma available, the reviews therefore run on **gemma at 2 concurrent
  requests**, which is slow but keeps the quality gate independent. Do not remove gemma from
  the fallbacks to speed reviews up unless the user accepts self-review by DeepSeek.

## Known problems and their state

1. **Writer repeats the climax chapter** (chapter N and N+1 nearly the same) — seen in
   the-silent-summit ch 3/4, the-silent-signal ch 7/8, echoes ch 7/8 and circuit-breaker-2
   ch 7/8. Mitigations already in place: the prompt rule above, hand edits of the-silent-signal
   ch 7 and echoes ch 7, and `scripts/dup-check.mjs`.
   **In progress:** the published the-silent-summit had ch 4/5 duplicated (chapter 4 absorbed
   the cave discovery). Chapter 5 was hand-trimmed and then reopened for a full rewrite
   (`reopen_book {book:"the-silent-summit", mode:"rewrite", chapters:[5]}` round 4) with a
   note listing what chapter 4 already covers. It is reviewing now; it should republish. If it
   rejects, `reopen_book` again with the same note.
   **Do not hand-edit published chapters before a rewrite** — use `reopen_book`; hand edits
   are only for text the reviewer flags and must be followed by a review round.
2. **Scriptorium scheduler stalls** — it stops dispatching while jobs are queued/books are
   unfinished; a restart requeues everything (this happened twice, also losing a publish job).
   The nudge task restarts it when idle. If `prod-status` shows no running jobs with work
   left and the nudge has not fired, restart manually:
   `pwsh -File C:\projects\Personal\creative-hub\scripts\hub.ps1 stop scriptorium -Force`
   then `… start scriptorium -Force`.
3. LM Studio had to be started with `--headless`; a GUI start quits immediately in this
   environment. If the API is down, relaunch it and let the engine load gemma only if
   DeepSeek is unavailable.
4. Do not run `lms load` for a model the engine also loads (`load_models: true`); that created
   a duplicate 24 GB instance and swapped the machine to a crawl.

## What to do next (new thread)

1. `fnm exec --using=24 node scripts/prod-status.mjs` — see what is still running. If the
   machine slept, start the stack first: LM Studio headless (`…\LM Studio.exe --headless` with
   `ELECTRON_RUN_AS_NODE` removed), then
   `pwsh -File C:\projects\Personal\creative-hub\scripts\hub.ps1 start comfyui chiptune-studio flow-music-mcp vn-studio scriptorium -Force`.
2. Watch `the-silent-summit` republish after its ch 5 rewrite (round 4). If rejected, reopen
   again with the same note; if published, confirm ch 4/5 no longer overlap
   (`node scripts/dup-check.mjs the-silent-summit`).
3. Wait for `echoes-in-the-deep` and `the-salt-line` to publish; the watchdog then creates
   their adaptations (`echoes-in-the-deep-2`, `the-salt-line-2`), and imports + starts each VN
   pipeline when the adaptation publishes — verify in `watch.log` and `vno_list_projects`.
4. Poll the two remaining VN pipelines (`node scripts/prod-status.mjs vn`). Flow images are the
   long pole (~230 assets per book, ~50 s an image, serialized through one Flow lane).
5. When each project has `build: done` and `lint: done`, verify `build.json` (`ok: true`,
   `placeholders: []`), `lint.json` (`ok: true`), and take a title-screen screenshot with
   headless Chrome against a local static server (pattern in the run log).
6. Review a sample of character sheets, backgrounds, CGs and the cover per project; regenerate
   bad ones with `vno_asset_regen`.
7. Update `run-log.md` (spend, publish scores, game stats, what was checked), ask the user to
   play the games, then close the goal.

## Verification commands used in this session

```
fnm exec --using=24 node scripts/prod-status.mjs
fnm exec --using=24 node scripts/mcp-call.mjs --url http://127.0.0.1:7341/mcp --tool factory_status
fnm exec --using=24 node scripts/mcp-call.mjs --url http://127.0.0.1:7459/mcp --tool vno_list_projects
fnm exec --using=24 node scripts/dup-check.mjs
schtasks /Query /TN VNO-PROD01-watch /V /FO LIST
```

No `yarn test`, `yarn typecheck` or `yarn lint` was run: this production changed only new
`.mjs` helper scripts and documentation in this repo, not `src/`. The engines were rebuilt at
start (`yarn build:engine`), and their pipelines/builds/lints are the checks that matter here.
