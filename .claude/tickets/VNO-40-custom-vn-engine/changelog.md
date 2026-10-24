# VNO-40 changelog

## 2026-10-24: Custom HTML5/TypeScript Visual Novel, Children's Story & Interactive Puzzle Web Engine (replacing Ren'Py & Android RAPT)

Branch `VNO-40_custom-vn-engine` (cut from `master` `2f22db1`).

### What changed
- **Native TypeScript Puzzle & Quiz Engine (`src/shared/puzzles/`, `src/shared/puzzle.ts`, `src/engine/puzzles/`):**
  - Ported the entire Python `vno_puzzles` library (`model.py`, `solver.py`, `generator.py`, `flavour.py`, `knights.py`, `testimony.py`, `logic.py`, `play.py`, `text.py`) to pure TypeScript in `src/shared/puzzles/` (`prng.ts`, `model.ts`, `solver.ts`, `generator.ts`, `flavour.ts`, `knights.ts`, `testimony.ts`, `logic.ts`, `quiz.ts`, `play.ts`, `text.ts`, `index.ts`).
  - Added `'quiz'` (multiple-choice questions / children's story quizzes) to `PUZZLE_KINDS`, `quizQuestionSchema`, `quizCoreSchema`, `puzzleCoreSchema`, `readBackClueSchema`, and `readBackTask`.
  - Fixed **VNO-36** in `src/shared/puzzles/testimony.ts`: `generateTestimony` excludes all statement main keys when picking press keys, and `repeats` checks cross-statement press collisions.
  - Rewrote `src/engine/puzzles/python.ts` and `scripts/puzzle-poc.ts` to execute puzzle generation, solving, text rendering, and flavour read-back checking in-process in pure TypeScript with zero Python or Ren'Py SDK dependencies.
- **Custom HTML5/TypeScript Visual Novel & Puzzle Web Engine (`src/engine/game/`):**
  - Created `src/engine/game/` (`build.ts`, `emit.ts`, `stage.ts`, `images.ts`, `fonts.ts`, `rtl.ts`, `escape.ts`, `tl.ts`, `puzzles.ts`, `player-runtime.ts`, `lint.ts`, `run.ts`).
  - `player-runtime.ts` generates a standalone, Capacitor-ready HTML5 web bundle (`index.html`, `player.css`, `player.js`, `game-data.json`, and `game-data.js` for zero-CORS `file://` loading) inside `<projectDir>/game/`.
  - Implemented the 1920×1080 responsive letterboxed stage, nearest-neighbour pixel art scaling, background transitions (`dissolve`, `fade`, `none`), 3-slot sprite staging (`left`, `center`, `right`), full-screen CGs, centered inserts (`42%` y-offset), typewriter dialogue with `**bold**` and `*italic*`, character colors and aliases, 37-language live edition switching, per-script `@font-face` rules, and RTL layout mirroring (`ar`, `he`, `fa`).
  - Implemented the multi-channel audio mixer (`music` with crossfade and `loopStartSec` seamless intro+loop playback, looped `ambience`, one-shot `sfx`, and per-beat localized `voice` playback).
  - Implemented all VN screens (Main Menu, Chapter Card, Quick Menu, Rollback history stack, scrollable History log, 9-page + Auto + Quick Save/Load in `localStorage`, Preferences, Choice branching menus, and The End screen).
  - Implemented interactive puzzle & activity screens for `murdle`, `logic`, `knights`, `testimony`, and `quiz`, plus `window.VNOEngine.registerPuzzleKind(kind, handler)` and `window.VNOEngine.registerBeatHandler(type, handler)` for extensible puzzle logic and children's story interactions.
  - Implemented native TypeScript game linting (`src/engine/game/lint.ts`) and game launching (`src/engine/game/run.ts`).
  - Added `renderThemeCss` to `src/engine/themes/emit.ts`.
- **Removal of Ren'Py SDK & Android RAPT Tooling:**
  - Deleted `src/engine/renpy/` (all 12 files), `templates/renpy/` (all 89 files), `templates/puzzles/` (all 15 files), and `docs/android.md`.
  - Removed `TASKS.android`, `androidPreflight`, `androidBuild`, `vno_android_preflight`, `vno_android_build`, and the CLI `android` command across `src/shared/protocol.ts`, `src/engine/vn/pipeline.ts`, `src/engine/vn/service.ts`, `src/engine/vn/handlers.ts`, `src/engine/vncli.ts`, `src/engine/index.ts`, and `src/engine/mcp/tools.ts`.
  - Updated `src/renderer/ui/book/BuildTab.tsx` and `src/renderer/ui/RenpySettings.tsx` to remove the Android build section and Ren'Py SDK path input while keeping screen resolution and image format configuration.
- **Test Suite Migration:**
  - Updated all 22 engine/puzzle/integration test files to target `src/engine/game/` and `src/shared/puzzles/` and run unconditionally without requiring an external Ren'Py SDK.

### Verification
- `yarn typecheck`: 0 errors (`tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json`).
- `yarn lint`: 0 errors (`eslint .`).
- `yarn test`: 69 test files / 974 tests pass (including 200-seed soundness proofs across all 5 puzzle kinds: `murdle`, `knights`, `testimony`, `logic`, `quiz`, and all 12 full book build + lint integration cases in `tests/renpy-integration.test.ts`).
