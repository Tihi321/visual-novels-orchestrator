# PROD-01 handoff — finish the unfinished books and their VN games

Last updated: 2026-10-26 23:45 (Europe/Warsaw). Read this with `plan.md` and `run-log.md` in
the same folder. The production is still running: the Scriptorium and VN Studio engines and
three Windows scheduled tasks keep working while no session is open.

**Resuming tomorrow:** the session goal is disarmed; a new session starts with this file. Say
"continue PROD-01" to the agent, then run `node scripts/prod-status.mjs` and pick up at
"What to do next". Do not re-decide the model/spend choices below; they were agreed with the
user on 2026-10-26.


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

## State at handoff

Scriptorium: **29 published**, `reviewing: 1` (`echoes-in-the-deep`), `rewriting: 1`
(`the-salt-line`, whole-book rewrite, chapters 4-11 were queued/starting),
`running: 3` jobs at the time of writing.

The five stalled books:

| Book | State | Score |
|---|---|---|
| circuit-breaker | published (`out/circuit-breaker.epub`) | 7.33 |
| the-silent-signal | published | 7.85 |
| the-silent-summit | published | 7.15 |
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

## Known problems and their state

1. **Writer repeats the climax chapter** (chapter N and N+1 nearly the same) — seen in
   the-silent-summit ch 3/4, the-silent-signal ch 7/8, echoes ch 7/8 and circuit-breaker-2
   ch 7/8. Mitigations already in place: the prompt rule above, hand edits of the-silent-signal
   ch 7 and echoes ch 7, and `scripts/dup-check.mjs`.
   **Open:** the published **the-silent-summit still has ch 4/5 overlap (26.6%)**; it scored
   7.15 so the reviewers passed it. Fix by `reopen_book {book:"the-silent-summit",
   mode:"rewrite", chapters:[5]}` with a no-duplication note, then let it republish (needs 2-3
   review rounds). Only do this after echoes and the-salt-line are through, or it competes for
   slots.
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

## What to do next (tomorrow)

1. `node scripts/prod-status.mjs` (after `fnm exec --using=24 …`) — see what is still running.
2. Check `~/Scriptorium/books/the-silent-signal-2` style adaptations and the `watch.log` for
   the two new adaptations (`echoes-in-the-deep-2`, `the-salt-line-2` once their sources
   publish); the watchdog imports and starts their pipelines automatically.
3. Poll the two remaining VN pipelines (`vno_list_projects` via `scripts/mcp-call.mjs`, or
   `node scripts/prod-status.mjs vn`). Flow images are the long pole (~230 assets per book,
   ~50 s an image, serialized).
4. When each project has `build: done` and `lint: done`, verify: `build.json` (`ok: true`,
   `placeholders: []`), `lint.json` (`ok: true`), and take a title-screen screenshot with
   headless Chrome against a local static server (the pattern is in the run log).
5. Review a sample of character sheets, backgrounds, CGs and the cover per project; regenerate
   bad ones with `vno_asset_regen`.
6. Fix the-silent-summit ch 4/5 (problem 1) if time allows.
7. Update `run-log.md` (spend, publish scores, game stats, what was checked), ask the user to
   play the four finished games, then close the goal.

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
