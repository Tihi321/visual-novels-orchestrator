# VNO-20 and VNO-21 changelog

## 2026-10-23 (later still): VNO-25 to VNO-27, found by the hub's puzzle production

Same branch `VNO-20-23_fixes`. Committed, not pushed. Evidence: the hub's `runs/the-winter-garden-clock.md` "Found" and `.claude/temp/hub10-p5/`.

| Ticket | Commit | Files | What changed |
|---|---|---|---|
| VNO-25 | 2630bd7 | `templates/puzzles/game/python-packages/vno_puzzles/testimony.py`, `tests/puzzles/test_testimony.py`, `tests/fixtures/puzzles/testimony-medium-4.json` | New `repeats(p)` finds repeated statements, press lines that only repeat, and evidence items with the same fact. The generator gives each statement, press line and evidence item its own key and re-rolls a core that repeats; two new vocabulary keys (`window`, `shoes`). Tested over 107 seeds per band, including the production's seeds. |
| VNO-26 | bf7f6de | `templates/puzzles/game/python-packages/vno_puzzles/knights.py`, `tests/puzzles/test_knights.py` | Every Knights and Knaves speaker gets a statement (a silent one gets a true one before minimising, the minimiser never drops a speaker's last statement, a final re-roll guard). Seed 517353379 was silent before (1101 of 1331 sampled puzzles had a silent speaker). Uniqueness and deduction proofs unchanged. |
| VNO-27 | 9201770 | `docs/mcp-guide.md`, `docs/protocol.md` | `CLUE:` ids per puzzle kind (Murdle/logic `c1..` + `murder`/`intro`; Knights and Knaves `intro`, `t1..`; testimony `e1..`, `intro`). A K&K `CLUE:` line only replaces a statement's words (all show from the start); `t1.press` cannot be a `CLUE:` id. |
| docs | addc9ba | `ROADMAP.md`, `plan.md`, `tests/renpy-puzzle-emit.test.ts` | Done lines; the emit test reads the solution from the regenerated fixture instead of hard-coded ids. |

Verification: puzzle library tests with the SDK's Python 3.12.7 (testimony 14, knights 13, vno_puzzles 26, logic), `yarn typecheck`, `yarn lint` pass. Full `yarn test` after the last commit (run by the orchestrator while three productions loaded the machine): 915 of 916; the failing `tests/scheduler.test.ts` "runs a job end to end" passed 3 of 3 when run alone and the branch does not touch the scheduler: a timing flake under load. Not run: `renpy lint` (no Ren'Py output changed); the production's puzzles were made on master (before this fix).

## 2026-10-23 (later): VNO-22 to VNO-24, found by the hub's HUB-07 live run

Same branch, renamed `VNO-20-23_fixes`. Committed, not pushed.

| Ticket | Commit | Files | What changed |
|---|---|---|---|
| VNO-22 | 7189617 | `src/engine/studios/flow.ts`, `tests/studios-flow-client.test.ts`, `tests/flow-generate.test.ts` | `chrome_running: false` from `flow_status` is an unknown sign-in (`signedIn: null`, no hint), so the generate pre-check goes on and the first Flow call opens Chrome; Chrome up and `signed_in: false` still blocks. |
| VNO-23 | f0e0006 | `seed/config/studios.md`, `tests/seed-files.test.ts` (new) | The seeded `flowRepo` had a form feed for the backslash and `f`; now `C:\projects\Personal\flow-music-mcp`. A test fails on any control character in a seed file and checks an unedited damaged copy is refreshed at start. No other damage found. |
| VNO-24 | ed752bb | `src/engine/voice/flow.ts`, `tests/voice-flow-jobs.test.ts`, `tests/flow-fakes.ts` | `parseRetryDelayMs` reads Google's retry time ("retry in 21h21m47.5s", "retry in 45s", `retryDelay`). A 429 whose retry time is at least 5 minutes and longer than the retry schedule stops the voice job at once: that clip and the rest fail without more calls, with one message naming the reset time; clips already made stay. |
| docs | 84a3aec, 0ebb153 | `ROADMAP.md`, `plan.md` | VNO-22 to VNO-24 done. |

Verification: `yarn test` 916 passed, `yarn typecheck`, `yarn lint` clean (after the last commit). Live: VNO-22 and VNO-23 were seen in the hub run (`creative-hub/runs/hub07-flow-test.md`) on master, not yet re-run on this branch; VNO-24 not seen live with the fix (needs another exhausted quota).

## 2026-10-23: the two findings of the hub run fixed

Branch `VNO-20-21_fixes` (from master 2f22db1), one commit per ticket. Committed, not pushed.

| Ticket | Commit | Files | What changed |
|---|---|---|---|
| VNO-20 | c08ba1f | `src/engine/comfy/client.ts`, `tests/comfy-client.test.ts` | While waiting for a ComfyUI prompt that is not in `/history`, the client checks `/queue` and the history once more; in neither, it throws `LostPromptError`. `runGraph` submits a lost prompt once more, and a second loss fails the job with a clear message. ComfyUI not answering for longer than `unreachableTimeoutMs` (default 300 s) fails the wait instead of hanging until the 30-minute job timeout. |
| VNO-21 | d8cb752 | `src/shared/ui-strings.ts`, `tests/languages.test.ts`, `tests/renpy-tl.test.ts`, `docs/mcp-guide.md` | 33 Croatian strings for Ren'Py's stock help, keyboard, mouse, gamepad and sync screens added to the built-in `hr` table. Language-neutral strings (Enter, Ctrl, Tab, `<`, `>`, the date format, the Ren'Py credit) stay as they are. |
| docs | e164957 | `ROADMAP.md`, this ticket's `plan.md` | VNO-20/21 done; "Where it stands" corrected (VNO-10 to VNO-19 merged, PR #11). |

## Deviations

- VNO-21: the cause was not a stale project. A rebuild already refills the strings from the built-in table each time; the 46 English strings of `the-clockless-god-3` were Ren'Py's stock help and sync screen strings, which the 49-string table never had. The project data was only read.

## Verification

- Run: `yarn test` (910 tests), `yarn typecheck`, `yarn lint`, all pass. New tests: a prompt lost once is submitted again and succeeds, lost twice fails; still queued is not lost; unreachable past the bound fails; an older-style partial hr stub gets every built-in hr string; every `_()` string of the template screens is in the hr table or a neutral list.
- Not run: `renpy lint` (only translation string content changed), a live ComfyUI crash, a rebuild of `the-clockless-god-3` in the app.

## Follow-ups

- The other 35 languages still stop at 49 strings, so their help screens stay English.
- `seed/config/languages.md` still says "49 strings" (left: seed edits refresh into users' data folders).
