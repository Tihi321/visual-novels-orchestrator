# VNO-15: puzzle script lines (HUB-10 phase 4, VN Studio side)

Plan: `C:\projects\Personal\creative-hub\.claude\tickets\HUB-10-puzzle-visual-novels\plan.md`, "Phase 4" and "The script lines". Branch: the shared `VNO-10-19_hub-roadmap`. The Scriptorium side is SCP-18 (`mystery-puzzle-visual-novel`, its `docs/visual-novel.md` "Puzzles"), written in parallel; the format below is the one that document has.

## Checklist

- [x] 1. `src/engine/vn/script.ts`: `CLUE_RE`, `EVIDENCE_RE`, `PUZZLE_RE`, `TESTIMONY_RE`, `END_TESTIMONY_RE` (the regular expressions of the Scriptorium doc, Croatian keywords too), checked after the cue lines and before `ON SCREEN` and the speaker line; `CLUE:` and `EVIDENCE:` are narration beats, `EVIDENCE:` also an `insert` picture, `PUZZLE:` a `puzzle` beat, a testimony block's statements are speaker lines; `ParsedChapterScript.puzzleLines` says which beat each became.
- [x] 2. `src/engine/vn/reader.ts` reads `bible/puzzles.md` (the format `mystery-puzzle-visual-novel` is listed); `src/engine/vn/puzzle-import.ts` puts the bible's cores and the lines together: story words, `clueAt` (the beat of each `CLUE:` or `EVIDENCE:` line), links (portraits, places, evidence pictures), warnings that name the chapter; `import.ts` makes `book.puzzles` and the pictures.
- [x] 3. Import-time proof: `importBook {prove}` (the service passes the puzzle library; none without the SDK) sets `verified.unique/deducible`; a story word that is not the canonical sentence leaves `textChecked` false, with a warning.
- [x] 4. Editions: `align.ts` gives the edition's `puzzles` words from the translated lines (by clue id) and its `bible/puzzles.md`.
- [x] 5. Fixture `tests/fixtures/books/mystery-puzzle/` (a murdle and a testimony), tests (`tests/vn-puzzle-import.test.ts`), a lint-clean `renpy-integration` case, docs (`docs/mcp-guide.md`).
- [ ] The read-back check of the story's own words runs in the hub (it needs a reader): not part of the import.
- [ ] The user plays a puzzle book made from a Scriptorium book.
