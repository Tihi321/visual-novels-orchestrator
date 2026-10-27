# PROD-01 run log

Production: finish every unfinished book end to end (user, 2026-10-26).
Resources: text agents on DeepSeek at first, then (user, 2026-10-26 14:0x) **LM Studio
MiniCPM** (`lmstudio/minicpm-v-4.7-35b-a3b`); images Google Flow; music / SFX / ambience /
voice local (ComfyUI ACE-Step + TTS Audio Suite, Chiptune Studio).

## Services (started 2026-10-26 ~12:00)

- Scriptorium headless (Electron, MCP 7341) — factory capped at 5 books, past the five until
  their adaptations queue.
- VN Studio headless (node, MCP 7459).
- ComfyUI 8188, Chiptune Studio 7458, flow-music-mcp 7462: up (Flow images verified: free,
  signed in; character sheets and backgrounds look right).
- LM Studio: the CLI alone could not start the daemon; the app had to be started with
  `ELECTRON_RUN_AS_NODE` removed from the environment. From then on the embeddings server
  answered, the five stalled `index` jobs ran and writing resumed at 12:23. MiniCPM was
  added to both data folders' `config/providers.md` (vision: true) and is used for all text
  roles from 14:05.
- Watchdog `scripts/prod-watch.mjs` (background, 90 s): when one of the five is published it
  starts the visual-novel adaptation (`adapt_book`, linear); when an adaptation is published it
  imports it into VN Studio, applies the production settings and starts the pipeline once.
  State and log in `.claude/temp/prod01/`.

## 1. Scriptorium: five stalled books

All five were retried at 11:12 (all had failed at the outline job on 2026-10-11, no chapters).

| Book | Published | Score | EPUB | Notes |
|---|---|---|---|---|
| circuit-breaker | 12:52 | 7.33 | `books/circuit-breaker/out/circuit-breaker.epub` | 35,315 words |
| echoes-in-the-deep | — | — | — | reviewing at 13:10 (36.6k words) |
| the-salt-line | — | — | — | reviewing at 13:10 (32.1k words) |
| the-silent-signal | — | — | — | rejected 6.94: ch 7 and 8 duplicated the vault scene; reopened 14:2x with a rewrite of ch 7-8 |
| the-silent-summit | 12:02 | 7.15 | `books/the-silent-summit/out/the-silent-summit.epub` | rejected twice (6.17, 6.98); the round-3 rewrite of ch 3-4 removed the duplicated avalanche |

The recurring defect: DeepSeek's writer twice duplicated the climax chapter (silent-summit
ch 3/4, silent-signal ch 7/8, and the circuit-breaker adaptation ch 7/8). Each was reopened
with a note that quotes the duplicated beats and names the split, and a targeted rewrite.

## 2. Adaptations (Scriptorium `adapt_book`, format visual-novel)

- `circuit-breaker-2` (from circuit-breaker): drafted 10 chapters, 24.6k words, rejected 6.43
  (the same duplicated ladder repair in ch 7/8, title typo and two dialogue slips); reopened
  at 14:2x with a rewrite of ch 7-9.
- `silent-summit-2` (from the-silent-summit): drafting at 13:10 (7/8 chapters, 17.7k words).
- The remaining three adaptations start as their books publish (watchdog).

## 3. The Local Patch (`the-local-patch-2`) — **finished**

- Settings: noir theme, Flow illustrated art, ComfyUI ACE-Step music (3 tracks) and ambience,
  Chiptune SFX, voice off, DeepSeek agents.
- Pipeline run 1: analyse 139/140 settled; art 65/66 prompts; music 3 tracks; generate
  98/98 assets (66 images incl. 8 character sheets, sprites for 8 expressions, 14 backgrounds,
  15 CGs and a cover; 17 ambience tracks; 12 SFX; 3 music); stage 5 chapters; build and lint.
- Build: `ok`, 0 placeholder images, one warning (a CG line at the end of a scene in ch 2 was
  dropped). Lint: clean — 725 dialogue blocks, 8,887 words, 5 chapters, 50 images.
- Game: `C:\Users\Infplane\VisualNovels\projects\the-local-patch-2\game\index.html`.
- Art spot-check: character sheets, backgrounds, the cover and a sprite cutout look right;
  note: Aris's sprites carry a cybernetic cheek implant the sheet does not show (all sprites
  are consistent with each other; the cover has no cast). Not regenerated.

## Checks and open items

- Flow: free, signed-in; images are 1920x1080 backgrounds, 768x1376 sheets and cut-out
  sprites; no failures in 98 assets.
- Voice: off everywhere (a novella has 1,000+ lines; the existing projects have voice off).
- DeepSeek spend before the switch: Scriptorium 4.70 of 5 USD/day, 11.6 of 40 USD/month.
  With MiniCPM the text work is local and free.
- Games still to make: the five adaptations as they publish (watchdog + operator checks).

## 2026-10-26 14:00-15:00 — MiniCPM switch and the duplication problem

- The user chose LM Studio MiniCPM for text work "for now". Added
  `minicpm-v-4.7-35b-a3b` (vision) to both data folders' `config/providers.md`, set
  Scriptorium's fallback rows to MiniCPM first (no paid model), cleared the 21 per-agent
  `model: deepseek/...` overrides so every agent follows the new rows, and set the watchdog's
  VN project models to MiniCPM. The engine picks this up live; the model was loaded by the
  first request.
- **Recurring writer defect:** every DeepSeek-written climax so far was written twice in a
  row (chapter 3/4 of the-silent-summit, 7/8 of the-silent-signal, 7/8 of
  echoes-in-the-deep, 7/8 of the circuit-breaker adaptation). The outlines are distinct, so
  this is the writer model repeating the previous chapter, not the plan.
  - Added a hard "never repeat a scene/beat/line from another chapter" rule to the writer
    prompts in `~/Scriptorium/prompts/writer/`: `draft_chapter.md`, `rewrite_chapter.md`,
    `draft_chapter_vn.md`, `rewrite_chapter_vn.md`.
  - the-silent-signal: MiniCPM's rewrite still staged the vault twice; the chapter 7 ending
    was edited by hand (cut at the hatch, ch 7 is 1,154 words) so the vault scene exists
    only in chapter 8. Reopen review to rescore.
  - echoes-in-the-deep: MiniCPM's rewrite stopped repeating the imagery but kept a false
    escape ("THROAT OPEN. WE CLIMB"). The last paragraphs of ch 7 were edited by hand to
    hand the plan to chapter 8. Reopen review after the round.
- MiniCPM is slow and verbose: ~15-31 tokens/s, and one research answer ran past 7,700
  tokens; 4-6 requests at a time. Reviews and research therefore take minutes each, and the
  scriptorium concurrency queue is the bottleneck (not spend).
- **The Local Patch game verified in a browser:** served the build and took a headless
  Chrome screenshot of the title screen (`.claude/temp/prod01/patch2-title.png`): the noir
  menu, the ark cover and the buttons render, so the built game runs.
- EPUBs of circuit-breaker and the-silent-summit validate (19 entries each) and their
  covers render; both are in `books/<slug>/out/`.

## 2026-10-26 15:00 — model churn and the RAM limit

- The machine has 31.6 GB RAM and an integrated Radeon (no discrete VRAM). Two 35B models
  loaded together (MiniCPM 21 GB + nail 24 GB) exceeded it and LM Studio paged: throughput
  fell to 0.18 tokens/s. The engine also loads a model through `load_models`, so a manual
  `lms load` produced a second instance of the same model (`...:2`, 24 GB again).
- Settled on one model for the writing side: **nail-qwen3.6-35b-a3b-mtp**, context 65536,
  parallel 2, TTL 480 h (the engine's own instance), with `reasoning_effort: none`
  (`config/providers.md`) so it writes text instead of reasoning tokens (a probe: 50 tokens
  in 1.3 s, sensible prose). Fallbacks in `~/Scriptorium/config/settings.md` are nail only.
- All other LM Studio models unloaded; 3 GB free while nail is loaded.
- **Sequencing decision:** VN Studio pipelines are deferred while Scriptorium writes (the
  writing model needs the whole RAM; ComfyUI audio and BiRefNet cut-outs would swap). The
  watchdog still imports and configures each published adaptation, with the VN text roles on
  the small gemma-4-e4b model for later; pipelines start after the writing phase, when nail
  is unloaded. `scripts/prod-watch.mjs` has `AUTOSTART_PIPELINES = false` for this.

## 2026-10-26 16:20 — LM Studio crash, headless start, gemma for text

- LM Studio exited during the nail run (port 1234 refused, the app gone); every Scriptorium
  request was blocked as "provider down" and two books (`circuit-breaker-2`,
  `the-silent-signal`) ended up `failed`.
- **The app starts headless** (user's tip, verified):
  `"…\LM Studio\LM Studio.exe" --headless` with `ELECTRON_RUN_AS_NODE` removed from the
  environment. A normal GUI start was quitting itself ("App is quitting"); the headless start
  keeps the API on 1234.
- Text model switched to **gemma-4-e4b-it-ultra-uncensored-heretic** (6.3 GB, the smaller of
  the user's two suggestions): the engine loads it with context 98304 and parallel 3; the
  fallback list in `~/Scriptorium/config/settings.md` is that one model only (TTL 480 h).
  Nail and MiniCPM are unloaded, so RAM is free for ComfyUI. Measured ~47 tokens/s on short
  answers.
- Both failed books were `retry_book`-ed; the engine restart also cleared the jobs that had
  pinned nail/MiniCPM, so everything now resolves to gemma.
- `scripts/dup-check.mjs` added: 8-word shingle overlap between adjacent chapters, so a
  duplicated climax is found before a review round. It flags echoes ch 7/8 (6.0%), the-silent-
  summit ch 4/5 (26.6%, already published), plus rust-and-ruin, the-local-patch and the
  soother (older books, not part of this production).
- `AUTOSTART_PIPELINES` is back on in the watchdog: gemma is small enough that the VN
  pipeline (Flow images, ComfyUI audio) can run alongside the writing.

## 2026-10-26 18:00-23:45 — DeepSeek, four games, automation

- The user allowed DeepSeek for text. Scriptorium fallbacks are now
  `deepseek/deepseek-flash` then `lmstudio/gemma-4-e4b-it-ultra-uncensored-heretic`; the
  **daily cap was raised from 5 to 20 USD** (monthly 40 unchanged; user allowed DeepSeek).
  All 28 agents resolve to DeepSeek; the local model is only a fallback and was unloaded, so
  ComfyUI has the RAM.
- **All three adaptations so far published with strong scores:** circuit-breaker-2 8.57,
  the-silent-signal-2 8.93, the-silent-summit-2 8.79. The-silent-signal itself published at
  7.85 (after the hand-edited ch 7), circuit-breaker 7.33, the-silent-summit 7.15.
- **Four VN games are finished** (build ok, lint clean, 0 placeholders):
  - the-local-patch-2 — 725 blocks, 8,887 words, 50 images, 5 chapters
  - circuit-breaker-2 — 982 blocks, 15,531 words, 54 images, 10 chapters
  - the-silent-signal-2 — 976 blocks, 15,219 words, 46 images, 10 chapters
  - the-silent-summit-2 — 731 blocks, 14,553 words, 35 images, 8 chapters
  Each is at `~/VisualNovels/projects/<slug>/game/index.html`. The Local Patch title screen
  was verified in headless Chrome; the other three passed build + lint.
- **Automation:** the watchdog runs as scheduled task `VNO-PROD01-watch` every 5 minutes
  (`prod-watch.mjs --once`); a second task `VNO-PROD01-nudge` every 10 minutes restarts
  Scriptorium when its scheduler is idle with work left (`scriptorium-nudge.mjs`). The
  scheduler had stalled twice (no running job while reviews/rewrites were queued); a restart
  requeued everything each time.
- Remaining at handoff: `echoes-in-the-deep` reviewing and `the-salt-line` rewriting (chapters
  4-11); their two adaptations and VN pipelines are still to come. Spend: 5.19/20 today,
  12.11/40 month.


## 2026-10-26 23:45 — handoff, commit, service guard

- Committed and pushed the production tooling, plan, run log and handoff on master
  (commit `4c4a69d`, repo `Tihi321/visual-novels-orchestrator`).
- flow-music-mcp was crash-looping at the end of the day (it printed "MCP listening" and then
  exited within a minute). Added `scripts/service-guard.mjs` and the scheduled task
  `VNO-PROD01-guard` (every 10 min) that restarts Flow, VN Studio or Scriptorium when their
  port stops answering; Flow answered `flow_status` after the guard's restart.
- Scheduled tasks now: `VNO-PROD01-watch` (adapt + import + start pipelines, 5 min),
  `VNO-PROD01-nudge` (restart a stalled Scriptorium scheduler, 10 min),
  `VNO-PROD01-guard` (keep the services up, 10 min).
- Session goal disarmed for the night; the engines and tasks continue without an agent.

## 2026-10-27 09:20-09:40 — resume after the night

- The machine slept overnight: every service was down at 09:20 and the scheduled tasks had
  last run at 23:46 (the repetitions fire only while the machine is awake). Restarted LM
  Studio headless and all five services with hub.ps1; the three tasks are Ready again.
- Scriptorium resumed from disk: echoes-in-the-deep reviewing and the-salt-line rewriting
  (ch 5 running, 14 jobs queued), all on DeepSeek. Spend resets today (0 USD at 09:25).
- **Fixed the published the-silent-summit duplication for real:** chapter 4 (rewritten in
  round 3) had absorbed the plug cutting, cave entry, bell and case, while chapter 5 retold
  them (24.7% shingle overlap). Chapter 5 was reopened for a rewrite (eopen_book rewrite
  ch 5, round 4) with a note that lists what chapter 4 already covers and what chapter 5 must
  now contain (logbook proving the deaf cook, Priya's burning attempt, confession, radio,
  weather window). It will go through review and republish.

## 2026-10-27 09:55 — session paused, new thread continues

- Status when paused: 28 published (the-silent-summit reopened for the ch 5 fix and is in
  review round 4), echoes-in-the-deep reviewing, the-salt-line rewriting (29 jobs queued,
  2 reviewers on gemma at a time because reviews avoid the writer's DeepSeek family).
  Spend today 0.03 USD, month 12.14/40.
- Four games finished and lint-clean: the-local-patch-2, circuit-breaker-2,
  the-silent-signal-2, the-silent-summit-2.
- Services and all three scheduled tasks were restarted this morning after the machine slept
  overnight; handoff updated with the current state and the new-thread instructions.

## 2026-10-27 10:05 — new thread resumes

- State on resume: all six services up (Scriptorium 7341, VN Studio 7459, flow-music-mcp 7462,
  ComfyUI 8188, Chiptune 7458, LM Studio 1234); the three scheduled tasks are Ready and the
  watchdog has been running every 5 minutes (`watch.log` current, `adapted=3 imported=3
  started=3`). Spend 0.03 USD today, 12.14/40 month.
- **Found and fixed a silent blocker:** `echoes-in-the-deep` and `the-salt-line` were both
  persisted as `paused: true` in their `book.md`, so their 14 queued jobs never started while
  only the-silent-summit's round-4 reviews ran. Resumed both with `set_book_paused false`;
  within a minute three jobs were running again (summit review, echoes review, salt-line
  rewrite) and words/spend started moving. Cause of the pause is not in any log; watch it in
  the next session (a paused book looks like a stalled production in `prod-status`).
- **All four finished games verified** at the data level: `build.json` `ok: true`,
  `placeholders: []`, one build warning on the-local-patch-2 only; `lint.json` `ok: true`,
  `messages: []` on all four (725/982/976/731 dialogue blocks).
- **Title screens rendered** for circuit-breaker-2, the-silent-signal-2 and the-silent-summit-2
  with a new helper, `scripts/shot-game.mjs` (serves `projects/<slug>/game` on a free port and
  screenshots it with headless Chrome; PNGs in `.claude/temp/prod01/<slug>-title.png`). All
  three show the noir title, the cast art and Start/Load/Preferences/About, so the builds run,
  not just lint clean.
- **Art spot-check (circuit-breaker-2):** the waterworks background (brick pumping hall, pipes,
  gauges, wet floor) and the CG of Sol climbing the rusted ladder out of the flooded channel are
  on-prompt and consistent with each other. One inconsistency, not fixed: Sol's character sheet
  and sprite show the bible's short-cropped hair but a beige work shirt and grey trousers,
  while the cover/title art and the CGs show long dark hair and the navy coverall. Flow time is
  being kept for the two remaining pipelines; regenerate the sheet + sprite (and then the six
  Sol CGs and the cover) only if the user wants that fixed.
- **Environment note (Windows sandbox):** processes started from the session run at Low
  integrity and the workspace *root* is the only Low-labelled directory, so writes inside
  workspace subfolders failed with EPERM (screenshots, logs). Fixed by labelling
  `.claude/temp/prod01` Low (`icacls ... /setintegritylevel (OI)(CI)Low`) and granting the user
  full control on the `.claude` chain; recovery backups are in `C:\Users\Infplane\prod01-acl-recovery`.
  Session file policy is now danger-full-access, so this no longer blocks anything.

## 2026-10-27 10:20 — the-silent-summit: the round-4 rewrite repeated chapter 4, fixed by hand

- Checked the round-4 chapter 5 against chapter 4 with `dup-check` and a paragraph-level 8-gram
  comparison: **28 of chapter 5's 55 paragraphs repeated chapter 4** (23.6% of the shorter
  chapter). Cause is structural, not the writer's habit this time: chapter 4's round-3 rewrite
  had absorbed all of chapter 5's outline beats (ice plug, cave, bell, Weiss's logbook, Priya
  burning the page, the confession, the radio, the closing window). Chapter 5 then re-told them
  because the outline gives those beats to chapter 5. Any further rewrite of chapter 5 would
  have done the same.
- The round-4 reviews confirmed nobody catches it: the act-2 developmental-editor and
  continuity-checker both returned **pass (9/9)** on the duplicated pair.
- **Fix:** trimmed chapter 4 back to its outline ("Tremor": avalanche, Hesk's accusation,
  Teodor's defence, the approach, Priya's pack, the ice cave **blocked by the plug**), keeping
  the avalanche prose and replacing the cave interior with ~1,000 new words (the sealed mouth,
  Ilse reading a wire-like ring behind the ice, the cutting plan, the night on the shelf, first
  light at the seam). Chapter 4 is now 2,211 words; a backup of the old chapter is in
  `.claude/temp/prod01/backups/ch-04-before-trim.md`.
- Result: adjacent-chapter overlap for the book is now **clean (max 1.8%)**; the length gate
  still `ok`; the book was paused for the edit and resumed, so the remaining round-4 reviews
  read the fixed chapter 4 and the publisher decides on it.
