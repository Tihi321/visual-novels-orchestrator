# VNO-40: Custom Visual Novel, Children's Story & Interactive Puzzle Web Engine

Branch: `VNO-40_custom-vn-engine` (cut from `master` `2f22db1`).

## Checklist (VN Studio, VNO-40)

Verified 2026-10-24: `yarn test` 69 files / 974 tests pass, `yarn typecheck` exit 0, `yarn lint` exit 0.

- [x] **Native TypeScript Puzzle & Quiz Engine (`src/shared/puzzles/` & `src/engine/puzzles/python.ts`)**:
  - Ported all Python puzzle modules (`model.py`, `solver.py`, `generator.py`, `flavour.py`, `knights.py`, `testimony.py`, `logic.py`, `play.py`, `text.py`) to pure TypeScript (`prng.ts`, `model.ts`, `solver.ts`, `generator.ts`, `flavour.ts`, `knights.ts`, `testimony.ts`, `logic.ts`, `play.ts`, `text.ts`, `index.ts`).
  - Fixed VNO-36 in `src/shared/puzzles/testimony.ts` (`generateTestimony` excludes all statements' main keys when picking press keys, and `repeats` checks cross-statement press collisions).
  - Added first-class `'quiz'` (Multiple-Choice Question / Children's Story Quiz) puzzle kind (`quizQuestionSchema`, `quizCoreSchema` in `src/shared/puzzle.ts`, and `src/shared/puzzles/quiz.ts` with `generateQuiz`, `solveQuiz`, `checkQuiz`, `hintQuiz`, and flavour read-back verification).
  - Replaced external SDK Python subprocess execution in `src/engine/puzzles/python.ts` with in-process TypeScript execution (~3.9s for 1,000 puzzles across 200 seeds × 5 kinds).
- [x] **Custom HTML5/TypeScript Visual Novel & Puzzle Web Engine (`src/engine/game/`)**:
  - Implemented `stage.ts`, `images.ts`, `fonts.ts`, `rtl.ts`, `escape.ts`, `tl.ts`, `puzzles.ts`, `emit.ts`, `build.ts`, `lint.ts`, `run.ts`, and `player-runtime.ts`.
  - `player-runtime.ts` emits a standalone, zero-dependency, Capacitor-ready HTML5 web bundle (`index.html`, `player.css`, `player.js`, `game-data.json`, and `game-data.js` for zero-CORS `file://` execution).
  - Supports 1920×1080 responsive letterboxed stage, pixel-art nearest-neighbour mode, background transitions (`dissolve`, `fade`, `none`), 3-slot character sprites (`left`, `center`, `right`), full-screen CGs and centered inserts (`42%` y-offset), typewriter dialogue with `**bold**` and `*italic*`, per-character name colors and aliases, 37 languages & live edition switching, custom `@font-face` per script, and RTL layout mirroring (`ar`, `he`, `fa`).
  - Web Audio / HTML5 Audio mixer supporting `music` (track continuity + `loopStartSec` seamless intro+loop), looped `ambience`, one-shot `sfx`, and per-beat localized `voice` playback.
  - Full VN screens: Main Menu, Chapter Card, Quick Menu, Rollback state stack, scrollable History log, 9-page + Auto + Quick Save/Load (`localStorage`), Preferences, Choice Menus, and Ending screen.
  - Interactive screens for all 5 puzzle/activity kinds (`murdle`, `logic`, `knights`, `testimony`, `quiz`) plus `window.VNOEngine.registerPuzzleKind` and `window.VNOEngine.registerBeatHandler` plugin hooks for custom children's story interactions and puzzle logic.
  - Native game linter (`src/engine/game/lint.ts`) validating built bundles, scenes, beats, choices, puzzles, images, audio, and translations in milliseconds without external SDKs.
- [x] **Remove Legacy Ren'Py & Android Tooling**:
  - Deleted `src/engine/renpy/`, `templates/renpy/`, `templates/puzzles/`, and `docs/android.md`.
  - Removed `TASKS.android`, `androidPreflight`, `androidBuild`, `vno_android_preflight`, `vno_android_build`, and the CLI `android` command.
  - Updated `src/renderer/ui/book/BuildTab.tsx` and `src/renderer/ui/RenpySettings.tsx` to remove the Android card and Ren'Py SDK path input while keeping screen resolution and image format settings.
- [x] **Tests, Typecheck & Lint**:
  - Migrated all test suites to `src/engine/game/` and `src/shared/puzzles/`, running unconditionally without `sdkExists` skips.
  - 69 test files / 974 tests pass, `yarn typecheck` and `yarn lint` clean.

---

## Context

VN Studio previously relied on an external Ren'Py 8.5.3 SDK installation (`C:/projects/Local/renpy/renpy-8.5.3-sdk`), its bundled Python interpreter for generating and proving puzzles (`templates/puzzles/game/python-packages/vno_puzzles/`), and RAPT/JDK 21 for Android builds.

The user requested:
1. Replacing the current Ren'Py engine with our own in-house engine on its own git branch.
2. Completely removing the current Ren'Py engine and Android RAPT tooling (Capacitor can wrap the web bundle whenever mobile builds are needed).
3. Supporting every feature currently used by the orchestrator (scenes, backgrounds, sprites, expressions, transitions, CGs, inserts, dialogue, choices, endings, music with `loopStartSec`, SFX, ambience, per-beat voice, 37 languages, editions, RTL, script fonts, 5 themes including `storybook` for children's stories, save/load/rollback/history/preferences, and all logic puzzle types).
4. Making it easy to extend with new puzzle logic, multiple-choice questions (`quiz`), and children's story activities.
5. Using Gemini Flash subagents during implementation.

---

## Architecture

### 1. Native TypeScript Puzzle & Quiz Engine (`src/shared/puzzles/` & `src/engine/puzzles/`)
- `src/shared/puzzles/prng.ts`: Deterministic `SeededRandom` (Mulberry32) with `randint`, `randrange`, `choice`, `sample`, `shuffle`.
- `src/shared/puzzles/model.ts`, `solver.ts`, `generator.ts`, `flavour.ts`: Murdle 3×3 / 4×4 grids, motives, traits, deduction loop, minimality, and difficulty band scoring (`easy`, `medium`, `hard`).
- `src/shared/puzzles/knights.ts`: Knights & Knaves boolean claim AST, truth table + step deduction solver, generator (preserving VNO-26 every-speaker-speaks invariant), and flavour read-back checker (preserving VNO-29 intro rule check).
- `src/shared/puzzles/testimony.ts`: Ace Attorney cross-examination generator and solver (preserving VNO-25 non-repeating keys and fixing VNO-36 so press keys never collide with any statement's main key).
- `src/shared/puzzles/logic.ts`: Multi-category ordinal Logic Grid (Puzzle Baron) generator, solver, and staircase play helpers.
- `src/shared/puzzles/quiz.ts`: Multiple-choice question / quiz engine (`kind: 'quiz'`) with 2–6 options per question, 1–10 questions per quiz, band scaling, hints, and flavour read-back checking.
- `src/shared/puzzles/play.ts` & `text.ts`: Polymorphic interactive play helpers (`cycleMark`, `setCross`, `autoCross`, `checkAccusation`, `checkSolution`, `hint`, `checkKnights`, `hintKnights`, `checkPresent`, `hintTestimony`, `checkLogic`, `hintLogic`, `checkQuiz`, `hintQuiz`) and canonical prose rendering.
- `src/engine/puzzles/python.ts`: Runs `generatePuzzle`, `solvePuzzle`, `renderPuzzleText`, `checkPuzzleText`, and `runPuzzleCli` in-process in pure TypeScript.

### 2. Custom HTML5/TypeScript VN & Puzzle Web Engine (`src/engine/game/`)
- `build.ts` & `emit.ts`: Compiles `VnBook`, `Edition[]`, `Theme`, `StageCues`, images (`sharp`), audio, voice clips, fonts, and puzzles into `<projectDir>/game/` containing the standalone web player (`index.html`, `player.css`, `player.js`, `game-data.json`, `game-data.js`) alongside compatibility script artifacts.
- `player-runtime.ts`: Self-contained browser/Electron/Capacitor runtime player with:
  - 1920×1080 letterboxed stage, transitions, 3-slot sprites, CGs, inserts.
  - Typewriter dialogue, markdown emphasis, character colors & aliases, RTL layout, and live language switching.
  - Audio mixer (`music` with `loopStartSec`, `ambience`, `sfx`, `voice`).
  - Save/Load (9 pages + Auto + Quick in `localStorage`), Rollback stack, History log, Preferences, Main Menu, Chapter Cards, Choices, and End Screen.
  - Built-in interactive screens for `murdle`, `logic`, `knights`, `testimony`, and `quiz`, plus `window.VNOEngine.registerPuzzleKind` and `window.VNOEngine.registerBeatHandler`.
- `lint.ts` & `run.ts`: Native TypeScript game linter and browser/Electron game launcher.
