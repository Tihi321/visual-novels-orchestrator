# VNO-14: more puzzle kinds (HUB-10 phase 3)

Plan: `C:\projects\Personal\creative-hub\.claude\tickets\HUB-10-puzzle-visual-novels\plan.md`, section "Phase 3: more puzzle kinds". Order (Q5): bigger Murdle, Knights and Knaves, testimony, Puzzle Baron logic grids. Q8: portraits and item pictures in the grid headers now (from existing sprites and insert images). One commit per kind (`VNO-14: <kind>`). Branch: the shared `VNO-10-19_hub-roadmap`.

Each kind: a Python module in `templates/puzzles/game/python-packages/vno_puzzles/` (generator, solver, texts, play helpers, flavour check), a screen in `templates/puzzles/game/vno_puzzle.rpy`, the schema in `src/shared/puzzle.ts`, the tools (`vno_puzzle_*` take `kind`), Python tests (200 seeds per band unique and deducible, or exactly one clash for testimony), and a lint-clean `renpy-integration` case. The user plays one puzzle of each kind before it is done.

## Checklist

- [x] 1. Bigger Murdle: size 3 or 4, a fourth category (motive), attribute clues (an item pointed at by a trait), the search-based `count_solutions` (brute force kept as the oracle), the fast deduction closure used by the generator, pictures in the grid headers (generic scrolling staircase grid).
- [x] 2. Knights and Knaves.
- [x] 3. Testimony (Ace Attorney): press, present, court record with evidence pictures, penalty bar.
- [x] 4. Puzzle Baron logic grids: an ordinal category, neither / oneof / before / after / apart clues.
- [ ] The user plays one puzzle of each kind.
