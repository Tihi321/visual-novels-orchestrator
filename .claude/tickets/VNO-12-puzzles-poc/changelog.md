# VNO-12 changelog (2026-10-22): puzzle proof of concept

HUB-10 phase 1. A 3x3 Murdle puzzle (who, with what, where) made and proved by Python code, played on one Ren'Py screen. Nothing in a normal build, the story schema or the tools changed.

## What it is

- **`templates/puzzles/game/python-packages/vno_puzzles/`**, pure Python, standard library only:
  - `generate(kind="murdle", size=3, seed, band)`: random solution, a pool of every true clue (`is`, `not`, `either`), clues added until `count_solutions == 1` and `deduce` solves it (band rules), then every clue that is not needed is dropped (in random order), then the result must be in the asked band. `PuzzleError` names the seed and band after `max_tries`.
  - `count_solutions`: brute force over all (3!)^2 = 36 assignments. `deduce`: a grid of 27 cells and the rules clue, elim, last, either, trans (cheapest first, one cell per step, every step recorded with its reason); `solved` only when every cell is known with no guessing and equals the solution.
  - `play.py`: `cycle_mark`, `set_mark`, `auto_cross`, `check_accusation`, `check_marks`, `hint` (a wrong mark first, then the first deduction step the grid does not show yet, then "make your accusation"). Every helper returns a new value and never changes its argument.
  - `cli.py`: `generate`, `solve`, `check`, JSON in and out (phase 2 reads it through `runSdkPython`).
- **`vno_puzzle.rpy`**: `screen vno_murdle` (clue list with strike-through, the L-shaped grid of 96 px cells, Hint, Undo, Clear, Accuse, Give up, the Auto-x toggle, the seed and band in a corner, the score line with `config.developer`), `screen vno_accuse`, `label vno_puzzle_play` (endless retries, a hint offered after 2 wrong accusations, `renpy.block_rollback()` after the result). The check and cross marks use `DejaVuSans.ttf`.
- **`poc/puzzle_poc.rpy`**: three lines of intro, the puzzle (seed 1, medium), the reply naming the culprit, and a menu: another puzzle (easy, medium, hard), the same puzzle again, back to the main menu.
- **`scripts/puzzle-poc.ts`**: `buildPuzzlePoc(dir, sdkPath)` builds the base game with the real `buildGame` (a one-line story, placeholders), copies the library in and jumps to the PoC. `--lint`, `--play`, `--selftest`.
- **`src/engine/renpy/run.ts`**: `sdkPython(sdkPath)` and `runSdkPython(sdkPath, args, {input, timeoutMs})` for phase 2.

## Measured (200 seeds per band, 600 puzzles)

| band | clues | score | rule mix | time for 200 (SDK Python 3.12 / Python 3.13) |
|---|---|---|---|---|
| easy | 6 to 9 | 32 to 36 | clue, elim, last only | 1.4 s / 1.3 s |
| medium | 5 to 6 | 37 to 43 | at least one either or trans step; 189 of 200 have an `is` clue | 0.9 s / 0.8 s |
| hard | 6 | 40 to 44 | at least 3 trans steps, no `is` clue | 0.7 s / 0.6 s |

All 600 are unique, deducible without guessing, minimal for their band and in it. Every puzzle takes 27 steps (the whole grid: three 3x3 blocks); the bands differ by rule mix and score, not by length. The score ranges of medium and hard overlap (40 to 43), so the band is decided by the rules, not by the score. 100 generations take 0.5 s (limit 10 s). Seeds give the same puzzles in Python 3.12.7 and 3.13 (a fingerprint test).

## Deviations from the plan

- `either` clues are allowed in every band, `is` clues in easy and medium (at most one added by the generator for medium, then minimisation may keep or drop it), none in hard.
- Minimality is judged with the band's own rules: an easy puzzle is minimal when no clue can be dropped and still be solved with clue, elim and last only (dropping could otherwise make it solvable only with trans). Medium and hard use all rules.
- The unique-puzzle-that-needs-a-guess case exists at 3x3 with these clue types (found by search, kept as `GUESS_CLUES` in the tests): `deduce` says not solved, so the generator would reject it.
- Added beyond the plan: `puzzle_poc_test.rpy` and `--selftest` (Ren'Py's own test runner clicks Start, Hint, Accuse and Back and checks the state; it passed), a fingerprint test across Python versions, and the case in `tests/renpy-integration.test.ts` (the plan left that file alone in phase 1; it was asked for).
- A real bug found by the self-test: `call screen vno_accuse` can return a non-dict (an Enter key activates the focused button), so the label checks `isinstance(_return, dict)`.
- Branch: the shared `VNO-10-19_hub-roadmap`, not `VNO-12_puzzles-poc`.

## Verification

- Python tests: 16 tests, 0 failed, under the SDK Python 3.12.7 and under system Python 3.13.12.
- `yarn test`: 63 files, 834 tests pass (828 before this ticket, 6 new in `tests/puzzles.test.ts` and `tests/renpy-integration.test.ts`; the 16 Python tests run inside one of them). `yarn typecheck` and `yarn lint`: clean.
- The PoC game lints clean (`renpy lint`, no messages), also as a case in `tests/renpy-integration.test.ts`. The 9 existing Ren'Py lint cases stay clean.
- `npx tsx scripts/puzzle-poc.ts --selftest`: passed (the screens render, the Hint, Accuse and Back buttons work, the library imports from `python-packages`).
- `git diff` shows no change under `templates/renpy/`, in `build.ts`, `emit.ts` or `story.ts` from this ticket.

Not verified: **the user has not played it yet** (grid readability, click feel, usefulness of the hints, whether the bands feel different, a save and load in the middle of a puzzle, undo). A mark the player sets with a right click or a long press was not exercised by a test (the self-test does not click a cell). Phone layout and Android packaging of `python-packages` are phase 2.

## The user's play notes

(to fill in after `npx tsx scripts/puzzle-poc.ts --play`)
