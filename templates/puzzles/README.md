# Puzzle library (phase 1, proof of concept)

Logic puzzles for visual novels: a generator and solver in Python, and the Ren'Py screens that play them. A normal build does not include it: the build copies `game/` into a book that has a puzzle beat (VNO-13), with `vno_puzzles_data.rpy` written from the book's puzzles. `poc/` is never copied into a book. Plan: the hub ticket HUB-10, `C:\projects\Personal\creative-hub\.claude\tickets\HUB-10-puzzle-visual-novels\plan.md`. VN Studio ticket: `.claude/tickets/VNO-12-puzzles-poc/`.

```
game/python-packages/vno_puzzles/   the library (pure Python, standard library only)
  model.py      the data format, helpers (cell keys, truth of a clue in a solution)
  solver.py     count_solutions (brute force) and deduce (human-style steps)
  generator.py  generate(kind, size, seed, band) and verify(puzzle)
  text.py       canonical English sentences, the PoC names, the sentences of the hints
  play.py       game-time helpers (cycle_mark, auto_cross, check_accusation, check_marks, hint)
  verify.py     check_text: does the prose still mean the same clues (the flavour check)
  cli.py        JSON in and out: generate, solve, check, check-text, render-text
game/vno_puzzle.rpy                 the screens vno_murdle and vno_accuse, the label vno_puzzle_play
poc/puzzle_poc.rpy                  the proof of concept story: intro, a puzzle, an accusation, "another puzzle"
poc/puzzle_poc_test.rpy             a Ren'Py test case (scripts/puzzle-poc.ts --selftest)
```

## What a puzzle is

Plain JSON-shaped data (no classes), so it goes to and from the engine as JSON and Ren'Py saves and rolls it back in `default` variables. Items are abstract ids (`s1`, `w2`, `p3`); `names` and `text` are a separate layer a model can rewrite without touching the logic.

```json
{ "format": 1, "kind": "murdle", "size": 3, "seed": 1234, "band": "medium",
  "categories": [ { "key": "suspect", "items": ["s1","s2","s3"] }, { "key": "weapon", "items": ["w1","w2","w3"] }, { "key": "place", "items": ["p1","p2","p3"] } ],
  "solution": { "s1": { "weapon": "w2", "place": "p3" } },
  "clues": [ { "id": "c1", "type": "not", "a": "s1", "b": "p1" }, { "id": "c2", "type": "either", "a": "w1", "b": ["p1","p2"] }, { "id": "c3", "type": "is", "a": "w3", "b": "s3" } ],
  "murder": { "place": "p3", "answer": { "suspect": "s1", "weapon": "w2", "place": "p3" } },
  "difficulty": { "steps": 27, "score": 40, "rules": { "clue": 6, "elim": 11, "last": 7, "trans": 3 } },
  "steps": [ { "rule": "clue", "clue": "c1", "cell": ["s1","p1"], "value": "no" } ],
  "names": { "s1": "Colonel Ash" }, "text": { "c1": "Colonel Ash was not in the library." } }
```

- A cell is a pair of items of two categories; it is "yes" when they belong to the same person in the solution. Cell keys are `a|b` with the earlier category first (`s1|w2`). Marks are `{cell: "yes" | "no"}`; a blank cell has no entry.
- Clues: `is(a, b)`, `not(a, b)`, `either(a, [b1, b2])` (a goes with one of two items of one category). The murder note names the place; the answer is who was there and with what.
- The generator proves that a puzzle has exactly one solution (brute force over all assignments), can be solved by deduction alone (rules `clue`, `elim`, `last`, `either`, `trans`, cheapest first, one cell per step), is minimal for its band, and is in its band. `easy`: no `either` or `trans` step. `medium`: needs `either` or `trans`. `hard`: at least 3 `trans` steps and no `is` clue. The score weights are `clue 1, elim 1, last 2, either 2, trans 3`.
- Deterministic: only `random.Random(seed)`, never the global `random`. The same seed gives the same puzzle in Ren'Py's Python 3.12 and in Python 3.13.
- The library never changes a value it is given (it returns new dicts), so Ren'Py's rollback always finds the old value intact.

## Run the tests

The SDK's Python has no `unittest`, so the tests are plain functions with `assert` and a small runner:

```
C:\projects\Local\renpy\renpy-8.5.3-sdk\lib\py3-windows-x86_64\python.exe tests\puzzles\test_vno_puzzles.py
py tests\puzzles\test_vno_puzzles.py
```

`yarn test` runs the first of these (`tests/puzzles.test.ts`) and lints the proof of concept game with the real Ren'Py (`tests/renpy-integration.test.ts`).

## Try the game

```
npx tsx scripts/puzzle-poc.ts --lint --play     builds into .claude/temp/puzzle-poc/, lints, opens the game
npx tsx scripts/puzzle-poc.ts --selftest        Ren'Py's test runner clicks through the screens (a window opens for a few seconds)
```

Controls: a click cycles a cell blank, then ✗, then ✓; a right click (or long press) sets ✗; a ✓ fills ✗ along its row and column of the block (switch it off with the Auto-✗ button). Hint, Undo, Clear, Accuse, Give up. After two wrong accusations a hint is offered.
