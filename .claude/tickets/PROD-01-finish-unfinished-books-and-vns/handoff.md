# PROD-01 handoff — finish the unfinished books and their VN games

Last updated: 2026-10-27 13:25 (Europe/Warsaw). Read this with `plan.md` and `run-log.md` in
the same folder. The production is still running: the Scriptorium and VN Studio engines and
three Windows scheduled tasks keep working while no session is open.

**Resuming in a new thread:** this file is the entry point. Ask the agent to continue PROD-01,
run `node scripts/prod-status.mjs` and pick up at "What to do next". Do not re-decide the
model/spend choices below; they were agreed with the user on 2026-10-26. The machine must be
awake for the engines and scheduled tasks to work (it slept overnight on 2026-10-26/27, so
nothing advanced between 23:46 and 09:20; on AC power it does not sleep).


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
- Scriptorium repo: `C:\projects\Personal\scriptorium` (only config/prompt changes, not
  committed there; see "Changes outside this repo").
- Data folders: `C:\Users\Infplane\Scriptorium` (books) and `C:\Users\Infplane\VisualNovels`
  (VN projects). Neither is in git.
- Creative hub: `C:\projects\Personal\creative-hub` (`scripts\hub.ps1` starts/stops services;
  logs in `creative-hub\logs`).

## Helper scripts in this repo (all Node 24: `fnm exec --using=24 node scripts/<name>.mjs`)

- `scripts/mcp-call.mjs` — minimal MCP Streamable-HTTP client for the engines (7341
  Scriptorium, 7459 VN Studio, 7462 flow-music-mcp). `--list` shows a server's tools.
  Example: `node scripts/mcp-call.mjs --url http://127.0.0.1:7341/mcp --tool factory_status`.
- `scripts/prod-status.mjs` — compact status of both apps (`all`, `books`, `vn`); book rows say
  `PAUSED` when a book is paused.
- `scripts/prod-wait.mjs` — watches the five books, one line per stage change, exits 0 when all
  five publish, 1 when one is rejected/failed. Run it as a background job instead of polling.
- `scripts/prod-watch.mjs` — the production watchdog: adapts a published book
  (`adapt_book`, visual-novel), imports each published adaptation into VN Studio, applies the
  production settings and starts its pipeline once. State `.claude/temp/prod01/watch-state.json`,
  log `watch.log`. The scheduled task runs it with `--once` every 5 minutes.
- `scripts/scriptorium-nudge.mjs` — restarts Scriptorium only when its scheduler is idle while
  jobs are queued or books are unfinished (`nudge.log`; it logs only when it acts).
- `scripts/service-guard.mjs` — restarts flow-music-mcp / VN Studio / Scriptorium when their
  MCP port does not answer (`service-guard.log`).
- `scripts/dup-check.mjs` — 8-word-shingle overlap between adjacent chapters of every book; the
  detector for the duplicated-climax defect. Give a slug for one book.
- `scripts/shot-game.mjs` — serves `~/VisualNovels/projects/<slug>/game` on a free port and
  screenshots it with headless Chrome into `.claude/temp/prod01/<slug>-title.png`.

## Changes outside this repo (not in git)

- `~/Scriptorium/config/providers.md`: `lmstudio/minicpm-v-4.7-35b-a3b` (vision) present;
  nail's `reasoning_effort: none`.
- `~/Scriptorium/config/settings.md`: fallbacks are **deepseek/deepseek-flash, then
  lmstudio/gemma-4-e4b-it-ultra-uncensored-heretic**; `fallback_shared: true`;
  `lmstudio_parallel: 2`, `lmstudio_context: 131072`, `lmstudio_ttl_minutes: 28800`.
- `~/Scriptorium/config/budget.md`: daily cap 20 USD, monthly 40.
- `~/Scriptorium/config/factory.md`: `paused: false`, `max_books_in_progress: 5`.
- `~/Scriptorium/agents/*.md`: the 21 per-agent `model: deepseek/...` overrides are cleared so
  agents follow the role/fallback chain.
- `~/Scriptorium/prompts/writer/{draft_chapter,rewrite_chapter,draft_chapter_vn,rewrite_chapter_vn}.md`:
  a hard "never repeat a scene/beat/line from another chapter" rule.
- `~/VisualNovels/config/providers.md`: the MiniCPM (vision) entry.
- `~/Scriptorium/books/the-silent-summit/chapters/ch-04.md`: **hand-trimmed** on 2026-10-27
  (see "Known problems" 1). Backup of the old chapter:
  `.claude/temp/prod01/backups/ch-04-before-trim.md`.

## Services and automation (leave running)

- Scriptorium headless, Electron, MCP `http://127.0.0.1:7341/mcp` (data `~/Scriptorium`).
- VN Studio headless, Node, MCP `http://127.0.0.1:7459/mcp` (data `~/VisualNovels`).
- ComfyUI 8188, Chiptune Studio 7458, flow-music-mcp 7462 (Flow signed in; stop/start via
  `pwsh -File C:\projects\Personal\creative-hub\scripts\hub.ps1 status|stop|start`).
- LM Studio headless (`"…\LM Studio\LM Studio.exe" --headless` with `ELECTRON_RUN_AS_NODE`
  removed); only gemma is needed, as the review lane.
- Scheduled tasks (user session, survive a session): `VNO-PROD01-watch` (5 min),
  `VNO-PROD01-nudge` (10 min), `VNO-PROD01-guard` (10 min). Query:
  `schtasks /Query /FO CSV /NH | Select-String PROD01` (querying by `/TN "\VNO-PROD01-watch"`
  also works; the leading backslash matters). Remove: `schtasks /Delete /TN <name> /F`.
  Their log timestamps are UTC (local = UTC+1).

## State at handoff

Scriptorium: **all five production books are published**; what is left is the two adaptations:
- `echoes-in-the-deep-2` — reviewing (10/10 chapters, 26,130 words, one review job left).
- `the-salt-line-2` — drafting (DeepSeek), created by the watchdog after the-salt-line
  published at 13:15 today.

Published books: circuit-breaker 7.33, the-silent-signal 7.85, **echoes-in-the-deep 8.38**,
**the-silent-summit 8.31** (republished today after the ch 4/5 fix), **the-salt-line ~8.1**
(11 chapters, 34,477 words; published 13:15 today), plus 25 older.

Adaptations: **circuit-breaker-2** 8.57, **the-silent-signal-2** 8.93, **the-silent-summit-2**
8.79 published; **echoes-in-the-deep-2** and **the-salt-line-2** in progress (above).

VN Studio — **four production games finished**, build `ok`, 0 placeholders, lint clean:

| Project | Blocks | Words | Images | Chapters |
|---|---|---|---|---|
| the-local-patch-2 | 725 | 8,887 | 50 | 5 |
| circuit-breaker-2 | 982 | 15,531 | 54 | 10 |
| the-silent-signal-2 | 976 | 15,219 | 46 | 10 |
| the-silent-summit-2 | 731 | 14,553 | 35 | 8 |

Games: `C:\Users\Infplane\VisualNovels\projects\<slug>\game\index.html`. All four verified with
`build.json`/`lint.json`; title screenshots in `.claude/temp/prod01/` (`patch2-title.png`,
`circuit-breaker-2-title.png`, `the-silent-signal-2-title.png`, `the-silent-summit-2-title.png`).

## Important decisions (do not re-litigate)

- Text agents: DeepSeek first, local gemma fallback. The local 35B models were unusable here
  (two exceed the 31.6 GB RAM; throughput collapsed to 0.18 tokens/s).
- Images: Google Flow only (free, ~50-90 s an image, one at a time per lane).
- Audio: local — ComfyUI ACE-Step for music and ambience, Chiptune Studio for SFX. Voices are
  **off** for every project; offer them separately if the user wants them.
- Daily DeepSeek cap 20 USD, monthly 40. Do not raise the monthly cap without asking.
- VN projects: noir theme, illustrated style, 3 music tracks, `sfxEngine: chiptune`,
  `ambienceEngine: ace-step-v1-instrumental`.
- **Reviews no longer have to run on gemma.** The user allowed paid and OpenRouter models on
  2026-10-27, so the two adaptations' reviews are set per book with `set_book_model`:
  `deepseek/deepseek-v4-pro` for the review roles, `deepseek/deepseek-flash` for copy-editor
  and line-editor. That lifts concurrency from 2 (gemma) to 4-5 and drains the queue in
  minutes. **Use DeepSeek for review JSON, not the free OpenRouter reasoning models**: nemotron
  3 ultra returned no parseable JSON twice on a copy-editor review and failed a whole book,
  which then needs `retry_book`. A book model set with `set_book_model` goes first in the
  router, so `avoid_family: deepseek` (a preference, not a filter) does not demote it. New
  review jobs still default to gemma unless a book model says otherwise.

## Known problems and their state

1. **Writer repeats the climax chapter.** The-silent-summit was the worst case and it was
   **structural, not the model's habit**: chapter 4's round-3 rewrite had absorbed all of
   chapter 5's outline beats, so every rewrite of chapter 5 re-told chapter 4 (28 of 55
   paragraphs, 23.6% shingle overlap). **Fixed by hand on 2026-10-27:** chapter 4 was trimmed
   back to its outline ("Tremor" ends at the ice cave **blocked by the plug**) with ~1,000 new
   words, chapter 5 keeps the bell/logbook/burning/confession material, and the book is clean
   (max adjacent overlap 1.8%). Reviews had passed the duplicate pair 9/9, so `dup-check` is the
   only reliable detector — **run it on every book before a publish decision matters**.
2. **A paused book looks exactly like a stalled production.** On 2026-10-27 10:00
   echoes-in-the-deep and the-salt-line were both persisted `paused: true`, so their jobs never
   started while only one book ran. Resume with
   `set_book_paused {book, paused: false}`; `prod-status` now prints `PAUSED`. No log records
   who paused them — check `book.md` when a book stops moving.
3. **Scriptorium scheduler stalls** — a nudge restart requeues everything (this happened twice).
   The nudge task restarts the engine when it is idle with work left. If `prod-status` shows no
   running jobs with work left, restart manually:
   `pwsh -File C:\projects\Personal\creative-hub\scripts\hub.ps1 stop scriptorium -Force`
   then `… start scriptorium -Force`.
4. **flow-music-mcp crash-loops** (prints "MCP listening" then exits). The guard restarts it; if
   a pipeline fails its art stage because Flow was down, restart Flow and continue that project
   from `art` with `vno_run_pipeline {slug, from: "art"}`.
5. **Character art consistency: fixed for circuit-breaker-2 on 2026-10-27** (user asked). Its
   Sol sheet had been generated with "simple worn clothes", so the sprite wore a beige shirt
   while the CGs and cover showed the navy coverall. The sheet, sprite, six Sol CGs and cover
   were regenerated with Flow from prompts that carry the bible's look (short-cropped dark
   brown hair, faded navy work coverall, tool belt, boots, pencil behind the ear); the game was
   rebuilt and linted clean and the title screen retaken. Prompts:
   `.claude/temp/prod01/sol-prompts.json`; script `.claude/temp/prod01/regen-sol.mjs`.
   Watch for the same class of defect in the two new games (a sheet prompt that says "simple
   worn clothes" or a CG prompt with no hair/outfit clause).
6. **Windows sandbox note:** processes started from a session run at Low integrity, and only the
   workspace root carried a Low integrity label, so writes inside workspace subfolders failed
   with EPERM. `.claude/temp/prod01` is now labelled Low and the `.claude` chain got a
   full-control entry for the user (recovery backups in
   `C:\Users\Infplane\prod01-acl-recovery`). The session is on danger-full-access, so this is
   moot unless the policy is tightened again.

## What to do next (new thread)

1. `fnm exec --using=24 node scripts/prod-status.mjs` — see what is running. Start the stack
   first if a service is down (`hub.ps1 start comfyui chiptune-studio flow-music-mcp vn-studio
   scriptorium -Force`; LM Studio headless only if a job is still pinned to gemma).
2. **The books are done.** Wait for `echoes-in-the-deep-2` and `the-salt-line-2` to publish:
   `node scripts/prod-wait.mjs --books echoes-in-the-deep-2,the-salt-line-2 --minutes 120
   --exit-on-change` as a background job. If a book lands in `failed`, read
   `~/Scriptorium/jobs/failed/<job>.md` (`failure:` line), point that role at DeepSeek with
   `set_book_model` and `retry_book`.
3. Each published adaptation is imported by the watchdog (5-minute task), gets the production
   settings and starts its pipeline — verify with `node scripts/prod-status.mjs vn`,
   `vno_list_projects` and `watch.log` (`IMPORTED` / `PIPELINE STARTED`).
4. Poll the two pipelines; Flow images are the long pole (~230 assets per book, ~50-90 s each,
   one lane — several hours each). Fix failures with `vno_asset_regen` / restarting a stage
   (`vno_run_pipeline {slug, from: "art"}`). Spot-check a sheet, a background, a CG and the
   cover for the same consistency defects as item 5 below.
5. When a project has `build: done` and `lint: done`, verify `build.json` (`ok: true`,
   `placeholders: []`), `lint.json` (`ok: true`), and take a title screen with
   `node scripts/shot-game.mjs <slug>`.
6. Update `run-log.md` (spend, scores, game stats, what was checked), refresh this file, commit
   and push, then ask the user to play the games and close the goal.

## Verification commands used so far

```
fnm exec --using=24 node scripts/prod-status.mjs
fnm exec --using=24 node scripts/mcp-call.mjs --url http://127.0.0.1:7341/mcp --tool factory_status
fnm exec --using=24 node scripts/mcp-call.mjs --url http://127.0.0.1:7459/mcp --tool vno_list_projects
fnm exec --using=24 node scripts/dup-check.mjs [slug]
fnm exec --using=24 node scripts/shot-game.mjs <slug>
schtasks /Query /FO CSV /NH | Select-String PROD01
```

No `yarn test`, `yarn typecheck` or `yarn lint` was run: this production changed only new
`.mjs` helper scripts and documentation in this repo, not `src/`. The engines' pipelines,
builds and lints are the checks that matter here. Commit `81b1ffc` (2026-10-27) added
`shot-game.mjs`, `prod-wait.mjs`, the `PAUSED` flag in `prod-status` and the run-log entries.
