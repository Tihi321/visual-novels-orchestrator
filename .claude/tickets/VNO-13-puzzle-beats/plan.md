# VNO-13: puzzle beats (HUB-10 phase 2)

VN Studio integration of the puzzle library of VNO-12. Plan: `C:\projects\Personal\creative-hub\.claude\tickets\HUB-10-puzzle-visual-novels\plan.md`, section "Phase 2: VN Studio integration". Q1 = Python, one copy (the engine runs the library with the SDK's Python through `runSdkPython`); one `vno_puzzle_generate` call must return in under 2 s. Branch: the shared `VNO-10-19_hub-roadmap`.

## Checklist

- [x] `src/shared/puzzle.ts`: the zod schemas (core, generated, proof, entry, edition words, read-back).
- [x] `src/shared/vn.ts`: `puzzleBeatSchema` (`type: 'puzzle'`), `VnBook.puzzles`, `Edition.puzzles`, `hasText`/`TextBeat` (every site that read `b.text` of a non-cast beat now skips a puzzle beat).
- [x] `src/engine/vn/story.ts`: beat input `{puzzle: key}`, ops `puzzle.set` and `puzzle.remove`, `validateBook` (key known or a warning, one beat per puzzle, `clueAt` before the puzzle beat, links, names and text complete, onFail chapter), `syncEdition` keeps the words of a puzzle that is still there.
- [x] `src/engine/puzzles/python.ts` (the bridge), `cli.py` commands `check-text` and `render-text`, `verify.py` (the truth-table check).
- [x] `src/engine/mcp/tools-puzzle.ts`: `vno_puzzle_generate`, `vno_puzzle_set`, `vno_puzzle_get`, `vno_puzzle_check_text`, `vno_puzzle_remove`; `vno_edition_set {puzzles}`; `vno_beat_add {puzzle}`.
- [x] Ren'Py: `src/engine/renpy/puzzles.ts` (`vno_puzzles_data.rpy`, translatable strings), `emit.ts` (`call vno_puzzle_play(...)`, `if not _return: jump ch_NN`, `$ vno_clue_found(...)`), `build.ts` (the library is copied only for a book with a puzzle beat), `vno_puzzle.rpy` (found clues, onFail, hints, translated clue text with `text_strikethrough`).
- [x] `assets/derive.ts`: an item linked to an image makes its `cg_<key>` asset.
- [x] Tests: `vn-puzzle-story`, `renpy-puzzle-emit`, `puzzle-python` (bridge and tools), Python tests for `check-text`, a case in `renpy-integration`.
- [x] Docs: `docs/mcp-guide.md` "Puzzles", `docs/protocol.md`, the MCP `INSTRUCTIONS`, `README.md`, `templates/renpy/README.md`, `templates/puzzles/README.md`, `ROADMAP.md`.
- [ ] The user plays a book with a puzzle (the scene, the puzzle, a wrong and a right answer, the next scene; with `onFail: chapter` the bad ending; the Croatian edition shows translated clues).

## Left out on purpose

The `puzzle-writer` and `puzzle-reader` agents with seed roles (see the changelog): the model that writes the flavour and a separate reader are the MCP client (or a subagent), driven by `vno_puzzle_get` (`readBackTask`) and `vno_puzzle_check_text`. Android packaging of `python-packages` is not checked.
