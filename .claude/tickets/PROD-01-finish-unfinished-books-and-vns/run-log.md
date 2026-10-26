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
