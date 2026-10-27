# PROD-01 handoff — finish the unfinished books and their VN games

Last updated: 2026-10-27 12:25 (Europe/Warsaw). Read this with `plan.md` and `run-log.md` in
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

Scriptorium: **29 published**; in progress:
- `the-silent-summit` — reviewing round 4; **all 12 round-4 reviews are written and the book is
  at the publisher** (decision any minute). Chapter 4 was trimmed by hand first (see "Known
  problems" 1), so the reviews and the decision are on the fixed text.
- `the-salt-line` — reviewing after a full rewrite (11/11 chapters); 18 review jobs queued and
  running two at a time (one repeated line was hand-edited out of chapter 4; see 1).
- `echoes-in-the-deep-2` — the adaptation of the published echoes-in-the-deep, reviewing
  (10/10 chapters, 26,709 words; 6 review jobs queued).

Published books: circuit-breaker 7.33, the-silent-signal 7.85, the-silent-summit 7.15 (will be
rescored when round 4 publishes), **echoes-in-the-deep 8.38** (2026-10-27 10:59), plus 25 older.

Adaptations: **circuit-breaker-2** 8.57, **the-silent-signal-2** 8.93, **the-silent-summit-2**
8.79 published; **echoes-in-the-deep-2** writing; the-salt-line-2 does not exist yet (the
watchdog creates it when the source publishes).

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
- **Reviews deliberately avoid the writer's model family** (`avoid_family: deepseek`), so they
  run on **gemma at 2 concurrent requests** — ~7 minutes per review job, and it is the slow
  lane. Do not remove gemma from the fallbacks to speed reviews up unless the user accepts
  self-review by DeepSeek.

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
5. **Open art issue, not fixed:** circuit-breaker-2's Sol character sheet and sprite show the
   bible's short-cropped hair but a beige work shirt and grey trousers, while the cover/title
   art and all six Sol CGs show long dark hair and the navy coverall. Flow time is being kept
   for the remaining pipelines; regenerate the sheet + sprite (then the CGs and cover) only if
   the user wants it.
6. **Windows sandbox note:** processes started from a session run at Low integrity, and only the
   workspace root carried a Low integrity label, so writes inside workspace subfolders failed
   with EPERM. `.claude/temp/prod01` is now labelled Low and the `.claude` chain got a
   full-control entry for the user (recovery backups in
   `C:\Users\Infplane\prod01-acl-recovery`). The session is on danger-full-access, so this is
   moot unless the policy is tightened again.

## What to do next (new thread)

1. `fnm exec --using=24 node scripts/prod-status.mjs` — see what is running. Start the stack
   first if a service is down (`hub.ps1 start comfyui chiptune-studio flow-music-mcp vn-studio
   scriptorium -Force`; LM Studio headless only if reviews stall on a provider error).
2. Wait for `the-silent-summit` (round 4, fixed chapter 4) and `the-salt-line` to publish —
   `node scripts/prod-wait.mjs --minutes 90` as a background job. Check `watch.log` for
   `ADAPTED`; if a book is rejected, reopen it with a note that names the chapters (see plan).
   After each publishes, `node scripts/dup-check.mjs <slug>` and confirm ch 4/5 for the summit.
3. Watch for `echoes-in-the-deep-2` and then `the-salt-line-2`: the watchdog imports each
   published adaptation, applies the settings and starts its pipeline. Verify with
   `node scripts/prod-status.mjs vn` and `watch.log`.
4. Poll the two new pipelines; Flow images are the long pole (~230 assets per book, ~50-90 s
   each, one lane — several hours each). Fix failures with `vno_asset_regen` / restarting from
   a stage (`vno_run_pipeline {slug, from: "art"}`).
5. When a project has `build: done` and `lint: done`, verify `build.json` (`ok: true`,
   `placeholders: []`), `lint.json` (`ok: true`), and take a title screen with
   `node scripts/shot-game.mjs <slug>`; spot-check a character sheet, a background, a CG and
   the cover.
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
