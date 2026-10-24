# Changelog: VNO-44

- **Date**: 2026-10-24
- **Ticket**: VNO-44
- **Branch**: `VNO-44_pipeline-stop-library-tabs-and-scenes`
- **Commit Status**: Uncommitted (ready on branch)
- **Outcome**: Implemented pipeline stopping from UI/engine, AI-assisted prompt suggestion for asset regeneration with offline fallback, Library top-level tabs (Projects vs. Scriptorium Books) with status filters and format badges, a new interactive Scenes tab with a 16:9 stage preview and scene/cast cue tweakers, and fixed the duplicate character sprite bug on stage.

---

## Changes by File

### 1. Stage & Duplicate Sprite Fixes
- [`src/engine/game/emit.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/game/emit.ts):
  - In `buildGameData`, character expressions now union `neutral`, `expressionsOf(book, c)`, and all used sprite expressions from `inp.used.sprites`, ensuring all 8 canonical expressions are emitted into `gameData.characters[charKey].sprites` even when `book.expressions` is omitted.
- [`src/engine/game/player-runtime.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/game/player-runtime.ts):
  - In `playScene`, clear `dom.slotLeft`, `dom.slotCenter`, and `dom.slotRight` (`innerHTML = ''`) and hide `dom.cgLayer`, `dom.cgOverlay`, and `dom.insertCard` at the start of every scene.
  - In `applyStagePlan`, when placing a character into a slot, any other slot displaying that character (via `data-char` or `alt`) is immediately cleared first.
  - Fall back to `char.sprites[item.expression] || char.sprites['neutral'] || Object.values(char.sprites)[0]`.
  - Add `data-char` attribute to rendered `<img>` elements, and clear `slotEl` if it holds a different character's sprite when no valid sprite path exists.
- [`src/engine/game/stage.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/game/stage.ts):
  - In `planScene`, deduplicate `beat.cast` by `charKey` to prevent duplicate character entries.
  - Resolve slot collisions in `cues.casts[beat.id]` by assigning colliding characters to the first free slot among `['left', 'center', 'right']`.

### 2. Stop Running Pipeline
- [`src/engine/queue/scheduler.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/queue/scheduler.ts):
  - Added `stopBook(book: string, reason = 'stopped'): number` to abort all in-flight jobs belonging to a given book.
  - When abort reason is `'stopped'`, delete the running job file directly instead of requeueing it.
- [`src/engine/engine.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/engine.ts) & [`src/engine/vn/service.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/vn/service.ts):
  - Wired `stopBook` dependency into `VnService`.
  - Implemented `stopPipeline(slug)` in `VnService`: drops queued jobs, aborts running jobs, drops requeued jobs, marks active/queued pipeline steps as `skipped` with note `'stopped'`, and emits updated `project.loaded` and `project.updated`.
- [`src/shared/protocol.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/shared/protocol.ts) & [`src/renderer/ui/book/PipelineTab.tsx`](file:///c:/projects/Personal/visual-novels-orchestrator/src/renderer/ui/book/PipelineTab.tsx):
  - Registered command `{ type: 'stopPipeline'; slug: string }`.
  - Rendered a **Stop pipeline** button in `PipelineTab` when a pipeline run or queued/running jobs are active.

### 3. AI Asset Prompt Suggestion
- [`src/shared/protocol.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/shared/protocol.ts) & [`src/renderer/store/vn.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/renderer/store/vn.ts):
  - Registered command `{ type: 'suggestAssetPrompt'; slug: string; id: string; instructions?: string }`.
  - Registered event `{ type: 'asset.prompt.suggested'; slug: string; id: string; prompt: string; source: 'ai' | 'fallback' }` and updated `reduceVn` to store prompt suggestions by `${slug}:${id}`.
- [`src/engine/vn/service.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/vn/service.ts):
  - Implemented `suggestAssetPrompt(slug, id, instructions)` using the project's configured `art-director` or `composer` model, passing rich story context from `VnBook` with fallback to deterministic prompt generation when LLMs are unreachable or offline.
- [`src/renderer/ui/book/AssetsTab.tsx`](file:///c:/projects/Personal/visual-novels-orchestrator/src/renderer/ui/book/AssetsTab.tsx):
  - Added a **Generate prompt with AI** button in `RegenerateDialog` that fills the prompt textarea with the suggested prompt.

### 4. Library Split Views & Format Badges
- [`src/renderer/lib/pipeline.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/renderer/lib/pipeline.ts):
  - Exported helper `isProjectFinished(project: { pipeline?: PipelineStatus | null }): boolean`.
- [`src/renderer/ui/LibraryPage.tsx`](file:///c:/projects/Personal/visual-novels-orchestrator/src/renderer/ui/LibraryPage.tsx):
  - Split Library into top-level tabs: **Projects** and **Scriptorium Books** (including the book folder import section).
  - Added project status sub-filter tabs: **All**, **In progress**, and **Finished**.
  - Displayed `project.format`, `project.genre`, and a `Built` badge on `ProjectCard`.

### 5. Scenes Tab & Cue Tweaker
- [`src/shared/protocol.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/shared/protocol.ts):
  - Added `cues: Record<string, SceneCuesView>` to `ProjectDetail`.
  - Added commands `updateSceneCues` and `updateSceneStory` with `rebuild?: boolean`.
- [`src/shared/vn.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/shared/vn.ts):
  - Exported `expressionsOf(book, char)`.
- [`src/renderer/lib/stage-preview.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/renderer/lib/stage-preview.ts):
  - Built pure helper `computeStageAtBeat` for computing character slot placements and active CG/inserts across scene beats.
- [`src/renderer/ui/BookPage.tsx`](file:///c:/projects/Personal/visual-novels-orchestrator/src/renderer/ui/BookPage.tsx) & [`src/renderer/ui/book/ScenesTab.tsx`](file:///c:/projects/Personal/visual-novels-orchestrator/src/renderer/ui/book/ScenesTab.tsx):
  - Added **Scenes** tab to `BookPage`.
  - Implemented `ScenesTab` featuring chapter & scene selection, an interactive 16:9 stage preview with character sprites and dialogue overlays, scene property editors (transition, pause, music, ambience), cast beat slot pickers (`left`, `center`, `right`) with auto-swap to prevent slot collisions, beat cue editors (expression, CG, SFX, ambience), and **Save** / **Save & Rebuild** buttons.

---

## Verification
- **Unit Tests**:
  - `tests/stage-duplicate-sprites.test.ts`: 4 passed (4).
  - `tests/pipeline-stop-and-scenes.test.ts`: 6 passed (6).
  - Full suite (`npm test`): **71 test files passed, 995 tests passed**.
- **Type Checking**:
  - `npm run typecheck` passed cleanly with 0 errors across Node and Web tsconfigs.
- **Production Build**:
  - `npm run build` compiled main, preload, and renderer packages cleanly.
