# VNO-12: puzzle proof of concept (HUB-10 phase 1)

VN Studio part of hub ticket HUB-10. The full plan, with the data format, the solver rules, the generator steps and the screens, is `C:\projects\Personal\creative-hub\.claude\tickets\HUB-10-puzzle-visual-novels\plan.md`, section "Phase 1: proof of concept". This ticket implements exactly that section. Branch: the shared `VNO-10-19_hub-roadmap` (not `VNO-12_puzzles-poc`).

User decisions (all open questions take the plan's recommendation): Q1 Python, one copy (the same package runs in the game and, in phase 2, in the engine through the SDK's Python); Q2 retry as often as wanted, a hint is offered after 2 wrong accusations; Q3 a fixed puzzle per book (the PoC still has "another puzzle"); Q4 only the accusation is submitted; Q5 order of the kinds in phase 3: bigger Murdle, Knights and Knaves, testimony, Puzzle Baron grids; Q6 the puzzle core comes from VN Studio (`vno_puzzle_generate`), Scriptorium keeps it as `bible/puzzles.md`; Q7 click cycles blank, no, yes; right click or long press sets no; yes fills no along its row and column (a preference, on by default), plus Undo and Clear; Q8 names in the headers first.

## Checklist

- [x] `templates/puzzles/game/python-packages/vno_puzzles/`: `model.py`, `solver.py` (brute-force `count_solutions`, `deduce` with the rules clue, elim, last, either, trans), `generator.py`, `text.py`, `play.py`, `cli.py`, `__init__.py`.
- [x] `templates/puzzles/game/vno_puzzle.rpy`: screens `vno_murdle`, `vno_accuse`, `vno_cell`; label `vno_puzzle_play`.
- [x] `templates/puzzles/poc/puzzle_poc.rpy` (and `puzzle_poc_test.rpy`, a Ren'Py test case), `templates/puzzles/README.md`.
- [x] `scripts/puzzle-poc.ts` (`buildPuzzlePoc`, `--lint`, `--play`, `--selftest`).
- [x] `src/engine/renpy/run.ts`: `sdkPython`, `runSdkPython`.
- [x] Tests: `tests/puzzles/test_vno_puzzles.py` (16 plain tests, SDK Python 3.12 and system Python 3.13), `tests/puzzles.test.ts`, a case in `tests/renpy-integration.test.ts`.
- [x] `README.md` (Scripts), `ROADMAP.md`.
- [ ] The user plays it (`npx tsx scripts/puzzle-poc.ts --play`): one puzzle per band, a wrong accusation, a hint, undo, a save and a load in the middle of a puzzle. Notes go into `changelog.md`.

Not changed: `templates/renpy/`, `build.ts`, `emit.ts`, `story.ts`, the story schema, the MCP tools.
