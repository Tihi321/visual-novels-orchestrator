# PROD-01 — finish every unfinished book production

Started 2026-10-26. Request: check the books that are not done, finish them to the end, and
use the local tools for everything except images.

## What is unfinished (checked 2026-10-26)

- **Scriptorium library**: 5 books stuck at `stage: failed` since 2026-10-11, all stopped at
  the outline job with no chapters written:
  `circuit-breaker`, `echoes-in-the-deep`, `the-salt-line`, `the-silent-signal`,
  `the-silent-summit` (all `novella`, 35k target words, prose, so not VN-importable as-is).
- **VN Studio**: 14 projects, 13 with a finished build, 1 unfinished:
  `the-local-patch-2` ("The Local Patch", imported 2026-10-23: 5 chapters, 22 scenes,
  3 characters, 6 places, 15 images, 29 sounds, 140 uncertain items, no pipeline step run,
  no assets).
- Test projects (`hub-06-media-lines`, `hub07-flow-test`, `hub08-13-autostart`,
  `quarter-tone-test`, `vno-media-test`) are finished builds and are left alone.

## Decisions (user, 2026-10-26)

- Finish **both** sides: write the 5 stalled books to published, then adapt them to visual
  novels, import them, and finish their games; also finish `the-local-patch-2`.
- Resources: **text agents = DeepSeek** (paid API, the user's choice), **images = Google
  Flow** (free cloud), **music / SFX / ambience / voice = local** (ComfyUI ACE-Step + TTS
  Audio Suite, Chiptune Studio). No Claude/client model work, no local LLM servers needed.
- Production defaults (hub `make-visual-novel` skill): linear visual novels, English,
  illustrated style, voices **off** unless asked (a novella has >1,000 lines per book; the
  existing projects have voice off). Report this and offer voices afterwards.

## Plan

### A. Write the five stalled books (Scriptorium, `~/Scriptorium`)

1. Save the factory at `paused: true` and `max_books_in_progress: 5` so starting the engine
   cannot pull the 7 unused ideas into new books.
2. Start the Scriptorium engine headless with MCP on 7341 (plain Node: covers stay `pending`
   until an app start draws them; the EPUB is still written).
3. `retry_book` each of the five; then unpause. Five books are in progress against a cap of
   five, so no new book starts.
4. `wait_for_book {slug}` each until `published` (or `rejected`/`failed`); resolve failures
   with `retry_book` / `reopen_book`; check the EPUBs and length gates; write the run log.

### B. Adapt each finished book to a visual novel (Scriptorium)

5. `adapt_book {book, format: "visual-novel"}` per book (linear; a novella has no choices).
6. Wait for the adaptation to publish (it is a `script: true` VN with `vn/pack.json`).

### C. Finish the VN games (VN Studio, `~/VisualNovels`)

7. Start the VN Studio engine headless (`node out/engine/index.js --mcp-only`, port 7459).
8. For `the-local-patch-2` and each adaptation:
   - settings: `art: {provider: "flow", style: "illustrated"}`,
     `music: {provider: "comfy", engine: "ace-step-v1-instrumental", tracks: 2-3}`,
     `sound: {ambienceEngine: "comfy", sfxEngine: "chiptune"}`, voice off;
     models: every role `deepseek/deepseek-flash` (deepseek has no JSON schema; the engine
     repairs JSON itself).
   - `vno_run_pipeline`, `vno_wait` in a loop, fix failures, then `vno_build` + `vno_lint`.
   - Review the character sheets, backgrounds, CGs and cover images; regenerate bad ones.
9. Leave every game built at `~/VisualNovels/projects/<slug>/game/index.html`.

### D. Evidence

- Run logs: `creative-hub/runs/<slug>.md` where writable, else this folder; this plan,
  `run-log.md` with timestamps, job ids, spend, checks and what was not verified.
- Final: list of games with build/lint status, spend per app, and a request for the user's
  play verdict.

## Access notes

- The session file policy is workspace-write; the data folders (`~/Scriptorium`,
  `~/VisualNovels`) and the hub live outside it, so every command that writes there is run
  with an explicit approval (full access for that one command). Engines are started this way
  and then driven over HTTP MCP, so their writes happen in the engine process.
