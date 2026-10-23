# VNO-13 changelog (2026-10-22): puzzle beats

HUB-10 phase 2. A story can stop for a logic puzzle: code makes and proves it, a model writes only the flavour, a separate read-back checks that the prose still means the same clues, and the build writes a game that plays it, also in a translated edition.

## What it does

- **Story data** (`src/shared/puzzle.ts`, `src/shared/vn.ts`): a `puzzle` beat `{id, type: 'puzzle', puzzle: key, ...cues}`; `VnBook.puzzles: PuzzleEntry[]` = `{key, kind, data (the core), names, text, links?, clueAt?, onFail?, hints?, verified}`; `Edition.puzzles: {key: {names, text}}`. Every place that read the text of a beat now uses `hasText` (a cast and a puzzle beat have none): emit, align, fixes, import, service, the agents, the renderer.
- **Story ops** (`story.ts`): beat input `{puzzle: key}` (alone on its beat, cues allowed); `puzzle.set` (needs core, names, text and `verified` for a new one; a change of text without a new `verified` marks the prose unchecked) and `puzzle.remove` (refused while a beat plays it, unless `force`). `validateBook`: a puzzle beat that names a puzzle not made yet is a warning (the build skips it), a puzzle played by two beats, a link to something the book does not have, `clueAt` at a missing beat or not before the puzzle beat, a missing name or clue text, an `onFail` chapter that is not there are errors. `syncEdition` keeps the words of a puzzle, item and clue that are still there.
- **Python bridge** (`src/engine/puzzles/python.ts`): `generatePuzzle`, `solvePuzzle`, `renderPuzzleText`, `checkPuzzleText` run `vno_puzzles/cli.py` with the SDK's Python (`runSdkPython -I`), JSON in and out, parsed with the zod schemas, 30 s timeout. Without the SDK: "the puzzle tools need the Ren'Py SDK ... set sdkPath in config/renpy.md".
- **Tools** (`mcp/tools-puzzle.ts`): `vno_puzzle_generate` (nothing saved; core + canonical English names and sentences; about 0.2 s), `vno_puzzle_set` (generate or data; proves it first and refuses a core that is not unique or needs a guess; canonical text follows renamed items; hand-written prose stays unchecked), `vno_puzzle_get` (core, words, canonical text, `readBackTask` for a separate reader), `vno_puzzle_check_text`, `vno_puzzle_remove`; `vno_edition_set {puzzles}`; `vno_beat_add {puzzle}`.
- **The flavour check** (`verify.py`): each read-back clue `{id, type, a, b}` (names or ids) must be true in exactly the same assignments as the original clue (truth table over all 36 assignments); the cheap check first (the reader's names are in the clue's prose); then the read-back set must still give one solution that deduction finds. Passing sets `verified.textChecked`; an edition's words are checked with `lang` and set nothing.
- **Ren'Py**: `emit.ts` writes `call vno_puzzle_play("key", vno_puzzle_data["key"])`, `if not _return: jump ch_NN` for `onFail: chapter`, and `$ vno_clue_found(key, clue)` after the beat where a clue is found; `renpy/puzzles.ts` writes `game/vno_puzzles_data.rpy` (names and clue texts as `_("...")`, the rest plain data; no seed or band, so the corner label of the PoC does not show); the translatable strings include the names and clue texts, so an edition's words land in `tl/<language>/`; `build.ts` copies `templates/puzzles/game/` only into a book that has a puzzle beat. `vno_puzzle.rpy` lists only the clues found, strikes a clue through with `text_strikethrough` (so the text still matches its translation), reads `onFail` (`maxTries` default 3 for continue and chapter) and `hints`, and sets `vno_puzzle_failed[key]`.
- **Assets**: an item linked to an image of the book makes the `cg_<key>` asset even when no beat shows it.

## The puzzle core that Scriptorium (SCP-18) receives

`vno_puzzle_generate` answers `{seed, band, core, names, text, difficulty, ms, next}`. The core is the object below (`steps` is the list of 27 deduction steps `{rule, cell: [a, b], value: "yes" | "no", clue?, from?}`); `names` and `text` are the canonical English flavour. Item ids: `s1..sN` suspects, `w1..wN` weapons, `p1..pN` places. Clue types: `is` (a goes with b), `not`, `either` (a goes with one of the two items in the array b). `murder.answer` is the culprit; `solution` is who has what and where.

```json
{"format":1,"kind":"murdle","size":3,"seed":1,"band":"medium",
 "categories":[{"key":"suspect","items":["s1","s2","s3"]},{"key":"weapon","items":["w1","w2","w3"]},{"key":"place","items":["p1","p2","p3"]}],
 "solution":{"s1":{"place":"p1","weapon":"w1"},"s2":{"place":"p3","weapon":"w2"},"s3":{"place":"p2","weapon":"w3"}},
 "clues":[{"id":"c1","type":"not","a":"s2","b":"w1"},{"id":"c2","type":"either","a":"p2","b":["w1","w3"]},{"id":"c3","type":"either","a":"s2","b":["p2","p3"]},{"id":"c4","type":"not","a":"s3","b":"w1"},{"id":"c5","type":"is","a":"s3","b":"p2"}],
 "murder":{"place":"p1","answer":{"suspect":"s1","weapon":"w1","place":"p1"}},
 "difficulty":{"steps":27,"score":37,"rules":{"clue":5,"elim":14,"last":6,"trans":2}},
 "steps":[...]}
names: {"s1":"Colonel Ash","s2":"Doctor Birch","s3":"Miss Cole","w1":"rope","w2":"candlestick","w3":"poison","p1":"library","p2":"kitchen","p3":"garden"}
text:  {"c1":"Doctor Birch did not have the rope.","c2":"Either the rope or the poison was in the kitchen.","c3":"Doctor Birch was either in the kitchen or the garden.","c4":"Miss Cole did not have the rope.","c5":"Miss Cole was in the kitchen.","murder":"The body was found in the library."}
```

What comes back into VN Studio from a Scriptorium book is `puzzle.set` data: the same core, with `names` (the story's names for the items) and `text` (the prose of each clue, planted in a `CLUE:` line of the chapter) and `clueAt` (clue id -> beat id). The prose is then read back and checked (`vno_puzzle_check_text`).

## Deviations from the plan

- **No `puzzle-writer` / `puzzle-reader` agents or seed roles.** The model that writes the names and the clue prose, and the separate reader that writes the clues back, are the MCP client (or a subagent of it): `vno_puzzle_get` returns `readBackTask` (the prose and the names, never the structured clues) for the reader, `vno_puzzle_check_text` takes its answer. The check itself (truth table, uniqueness, deducibility) is the same code. Pipeline agents with roles can be added later without changing the tools.
- A puzzle beat that names a puzzle not made yet is a warning, not an error, so `vno_create_project` can place the beat first and `vno_puzzle_set` can follow (the acceptance order of the plan). The build skips such a beat with a warning.
- `clueAt` lives on the puzzle entry (clue id -> beat id), not as an `at` field inside the core, so the core stays what the library made. The data file gets `at` on the clue.
- `size` is 3 (the library makes 3x3 puzzles so far). `kind` is `murdle`.
- The hint sentences and the library's buttons and narrator lines are English in every language; the names and clue texts are translated. (Hints use the book's clue prose of the primary language.)
- `vno_android_preflight` and the APK were not checked for `python-packages` (the plan lists it as a manual check).

## Verification

- `yarn test`: 66 files, 861 tests pass (834 before this ticket: 27 new). `yarn typecheck`, `yarn lint`: clean.
- New tests: `vn-puzzle-story` (schemas, ops, validation, edition sync, the image asset follow-up), `renpy-puzzle-emit` (the call lines, onFail, clue found, the data file, translatable strings), `puzzle-python` (the bridge contract with the real SDK Python, `generate` under 2 s, `check-text` passes a faithful read-back and a paraphrase and catches a flipped clue type, a swapped name and an either clue that lost an option, the tools end to end, an edition checked with `lang`), the Python tests for `check-text` and `render-text` (20 tests, SDK Python 3.12 and system Python 3.13), and a `renpy-integration` case: a book with a puzzle beat, a clue found earlier, `onFail: chapter` and an HR edition with translated clues builds, the `tl/croatian` file holds the clue and name strings, and `renpy lint` is clean; a book with no puzzle has neither the library nor the data file.
- By hand with Ren'Py's test runner on that built game: the clue found earlier is listed, three wrong accusations end the puzzle (`maxTries` 3, a hint offered after the second) and the player lands in chapter 2; `renpy.translate_string` of the stored clue and name gives the Croatian words.
- Not verified: **the user has not played it**; the translated words on screen (Ren'Py translates displayed text by its own rule; only the strings table was checked); Android packaging; a puzzle with an image link in the grid (names only in this phase).

## The user's play notes

(to fill in)
