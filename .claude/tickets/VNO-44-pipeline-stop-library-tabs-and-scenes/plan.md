# VNO-44: Stop Pipeline, AI Asset Prompt Suggestion, Library Split Tabs, Scenes Tab & Duplicate Sprite Fix

- **Branch**: `VNO-44_pipeline-stop-library-tabs-and-scenes` (base: `master`)

## Implementation Checklist

- [x] Phase 1: Fix Duplicate Character Sprites & Stage Transitions (`src/engine/game/emit.ts`, `src/engine/game/player-runtime.ts`, `src/engine/game/stage.ts`, `tests/stage-duplicate-sprites.test.ts`)
- [x] Phase 2: Stop Running Pipeline (`src/engine/queue/scheduler.ts`, `src/engine/engine.ts`, `src/engine/vn/service.ts`, `src/shared/protocol.ts`, `src/renderer/ui/book/PipelineTab.tsx`)
- [x] Phase 3: AI Prompt Generation in Regenerate Modal (`src/shared/protocol.ts`, `src/engine/vn/service.ts`, `src/renderer/store/vn.ts`, `src/renderer/ui/book/AssetsTab.tsx`)
- [x] Phase 4: Library Split Views (Tabs), Finished Filter & Format Badge (`src/renderer/ui/LibraryPage.tsx`, `src/renderer/lib/pipeline.ts`)
- [x] Phase 5: Scenes Tab (Inspect & Tweak Scenes) (`src/shared/protocol.ts`, `src/engine/vn/service.ts`, `src/renderer/ui/BookPage.tsx`, `src/renderer/ui/book/ScenesTab.tsx`, `src/renderer/lib/stage-preview.ts`)
- [x] Verification: Full test suite (`npm test`, 71 test files, 995 tests passing), clean typecheck (`npm run typecheck`), and production build (`npm run build`)

## Overview

This plan covers five user-requested improvements and bug fixes across the engine, web player runtime, and renderer UI:

1. **Stop Running Pipeline**: Allow stopping an active pipeline run for a project from the `Pipeline` tab, aborting any in-flight jobs for that book and clearing its queued jobs.
2. **AI Prompt Generation in Regenerate Modal**: Allow generating or refining an asset prompt with AI (with deterministic fallback when no LLM is reachable) directly inside the `Regenerate` modal in the `Assets` tab—including for assets that start with an empty prompt (such as `sfx_*` or unplanned assets).
3. **Library Split Tabs, Project Status Filter & Format Badge**:
   - Split the `Library` page into top-level tabs: **Projects** and **Scriptorium Books** (which also houses **Import a book folder**).
   - Add sub-filter tabs inside **Projects** to view **All**, **In progress**, and **Finished** projects separately.
   - Display the project's format/type badge (e.g., `visual-novel`, `choice-visual-novel`, `mystery-puzzle-visual-novel`) on each `ProjectCard`.
4. **Scenes Tab (View & Tweak Scenes)**:
   - Add a **Scenes** tab in `BookPage` alongside `Pipeline`, `Editions`, `Assets`, `Look`, `Voice`, and `Build`.
   - Provide a visual 16:9 stage preview (background, 3 character slots `left` / `center` / `right`, CG/insert overlay) and beat-by-beat inspector.
   - Allow tweaking scene settings (transition, pause, music, ambience) and cast/beat cues (character slot positions `left` / `center` / `right`, cast list, beat expression, CG, SFX, ambience) and rebuilding the novel.
5. **Fix Duplicate Character Sprite Bug on Stage ("2 of the same chars here are shown")**:
   - Fix three interacting bugs in `src/engine/game/emit.ts`, `src/engine/game/player-runtime.ts`, and `src/engine/game/stage.ts` that caused a character (e.g. Inspector Nada Ferluga in `the-trap-room-at-the-lanterna` `ch01.s03.b011`) to appear duplicated in two stage slots simultaneously when shifting slots while another character entered with a non-neutral expression.

---

## Root Cause Analysis: Duplicate Character Sprites on Stage

Inspection of `the-trap-room-at-the-lanterna` (`ch01.s03.b003` → `ch01.s03.b011` → `ch01.s03.b012`) revealed three bugs working together:

1. **Non-neutral expressions omitted from `gameData.characters[key].sprites` in [`src/engine/game/emit.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/game/emit.ts#L618-L628)**:
   - `buildGameData` computed character expressions as:
     ```ts
     const expressions = [...new Set([...(book.expressions ?? ['neutral']), ...(c.expressions ?? [])])]
     ```
   - When `book.expressions` is `undefined` in `vn.json` (which means "use the standard 8 `CANONICAL_EXPRESSIONS`", per [`expressionsOf`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/vn/expressions.ts#L10-L13)), `buildGameData` only emitted `sprites.neutral` into `game-data.json`!
   - When `signora_livia_brandolin` entered at `left` on `ch01.s03.b011` with lookahead expression `happy` (from `ch01.s03.b012`), `char.sprites['happy']` was `undefined`.
2. **Moving a character between slots does not clear their previous slot in [`src/engine/game/player-runtime.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/game/player-runtime.ts#L1536-L1556)**:
   - In `ch01.s03.b003`, `inspector_nada_ferluga` was in `left` (`dom.slotLeft`).
   - In `ch01.s03.b011`, the 3-character cast placed `signora_livia_brandolin` in `left`, `inspector_nada_ferluga` in `center`, and `luka_bencic` in `right`.
   - Because `inspector_nada_ferluga` stayed on stage, she was not in `stage.hides`; `stage.shows` rendered her into `dom.slotCenter` without clearing her old `<img>` from `dom.slotLeft`.
   - At the same time, `signora_livia_brandolin` failed to render into `dom.slotLeft` because `char.sprites['happy']` was missing and had no fallback to `char.sprites['neutral']`. Thus `dom.slotLeft` kept Nada's sprite while `dom.slotCenter` also rendered Nada's sprite.
3. **Scene transitions do not clear stage slots in [`src/engine/game/player-runtime.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/game/player-runtime.ts#L1406-L1439)**:
   - [`planScene`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/game/stage.ts#L67-L76) starts every scene with an empty `currentShown` map (matching Ren'Py's `scene bg_*` behavior), but `playScene` in `player-runtime.ts` never cleared `dom.slotLeft`, `dom.slotCenter`, `dom.slotRight`, or `dom.cgLayer`.

---

## Implementation Plan

### Phase 1: Fix Duplicate Character Sprites & Stage Transitions

#### 1.1 [`src/engine/game/emit.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/game/emit.ts)
- In [`buildGameData`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/game/emit.ts#L618-L628):
  - Import `expressionsOf` from `../vn/expressions`.
  - Compute each character's expressions as the union of `expressionsOf(book, c)` and any expression present for `c.key` in `inp.used.sprites` (and `neutral`), so every generated sprite expression is present in `gameData.characters[c.key].sprites`.

#### 1.2 [`src/engine/game/player-runtime.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/game/player-runtime.ts)
- In [`playScene`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/game/player-runtime.ts#L1406-L1439):
  - Clear `dom.slotLeft.innerHTML = ''`, `dom.slotCenter.innerHTML = ''`, `dom.slotRight.innerHTML = ''`, and hide `dom.cgLayer` (`dom.cgLayer.classList.add('vno-hidden')`, `dom.cgOverlay.classList.add('vno-hidden')`, `dom.insertCard.classList.add('vno-hidden')`) when starting a new scene.
- In [`applyStagePlan`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/game/player-runtime.ts#L1515-L1575):
  - Before rendering each `item` in `stage.shows` into its target `slotEl`:
    1. Call `clearSlotByChar(item.charKey)` if `item.charKey` is currently rendered in any slot other than `slotEl`, guaranteeing a character can never appear in two slots at once.
    2. Resolve the sprite path with fallback: `const spriteRel = char.sprites && (char.sprites[item.expression] || char.sprites['neutral'] || Object.values(char.sprites)[0])`.
    3. If `slotEl` currently shows a different character (`existingImg.getAttribute('data-char') !== item.charKey`) and `spriteRel` is still unavailable, clear `slotEl.innerHTML = ''` so the previous occupant does not remain in that slot.

#### 1.3 [`src/engine/game/stage.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/game/stage.ts)
- In [`planScene`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/game/stage.ts#L67-L116):
  - Deduplicate `beat.cast` by `charKey` (keeping the first occurrence) so a malformed cast beat with duplicate character keys cannot place the same character twice.
  - Ensure `slotOf` resolves slot collisions when `cues?.casts?.[beat.id]` assigns two characters in the same cast beat to the same `StageSlot` (falling back to the remaining free slot among `left`, `center`, `right`).

#### 1.4 Unit Tests
- Add tests in `src/engine/game/__tests__/` verifying:
  - `buildGameData` includes all `CANONICAL_EXPRESSIONS` and used sprite expressions even when `book.expressions` is `undefined`.
  - `planScene` and `player-runtime` moving a character from `left` to `center` while a 3rd character enters `left` clears `left` and never duplicates the character.

---

### Phase 2: Stop Running Pipeline

#### 2.1 [`src/engine/queue/scheduler.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/queue/scheduler.ts)
- Add `stopBook(book: string, reason = 'stopped'): number` on [`Scheduler`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/queue/scheduler.ts#L64-L152):
  - Iterates `this.running.values()`, aborts any running job where `rj.job.data.book === book`, and returns the count of aborted running jobs.

#### 2.2 [`src/engine/engine.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/engine.ts) & [`src/engine/vn/service.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/vn/service.ts)
- Add `stopBook?: (slug: string, reason?: string) => number` to [`VnDeps`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/vn/service.ts#L101-L119) and wire `stopBook: (slug, reason) => this.scheduler.stopBook(slug, reason)` in [`Engine`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/engine.ts#L228-L242).
- Also cancel any pending client tasks for `slug`'s jobs in `this.deps.registry.clientQueue` when stopping.
- Add `async stopPipeline(slug: string): Promise<{ stoppedRunning: number; droppedQueued: number }>` to [`VnService`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/vn/service.ts):
  1. Calls `await this.clearQueue(slug)` first so no newly freed dependent jobs can start as running jobs abort.
  2. Calls `this.deps.stopBook?.(slug, 'stopped')` to abort running jobs for `slug`.
  3. Calls `await this.clearQueue(slug)` once more to sweep any jobs enqueued right before abort and mark any `running` or `queued` pipeline steps in `pipeline.json` as `{ status: 'skipped', at: nowIso(), note: 'stopped' }`, emitting `pipeline.progress` for each stopped step.
  4. Emits `project.loaded` and `project.updated` for `slug`.
- Handle `{ type: 'stopPipeline'; slug: string }` in `VnService.handle(cmd)`.

#### 2.3 [`src/shared/protocol.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/shared/protocol.ts) & [`src/renderer/ui/book/PipelineTab.tsx`](file:///c:/projects/Personal/visual-novels-orchestrator/src/renderer/ui/book/PipelineTab.tsx)
- Add `{ type: 'stopPipeline'; slug: string }` to `VnCommand` in [`src/shared/protocol.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/shared/protocol.ts#L298-L333).
- In [`PipelineTab.tsx`](file:///c:/projects/Personal/visual-novels-orchestrator/src/renderer/ui/book/PipelineTab.tsx#L83-L103):
  - When `running` is true (or `detail.jobs.running + detail.jobs.queued > 0`), render a **Stop pipeline** button next to `Run pipeline` / `Run all again` that dispatches `send({ type: 'stopPipeline', slug })`.

---

### Phase 3: AI Prompt Generation in Regenerate Modal

#### 3.1 Protocol & Store ([`src/shared/protocol.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/shared/protocol.ts), [`src/renderer/store/vn.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/renderer/store/vn.ts))
- Add to `VnCommand`:
  ```ts
  | { type: 'suggestAssetPrompt'; slug: string; id: string; instructions?: string }
  ```
- Add to `EngineEvent`:
  ```ts
  | { type: 'asset.prompt.suggested'; slug: string; id: string; prompt: string; source: 'ai' | 'fallback' }
  ```
- In [`src/renderer/store/vn.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/renderer/store/vn.ts):
  - Add `promptSuggestions: Record<string, { prompt: string; source: 'ai' | 'fallback'; rev: number }>` to `VnData` (keyed by `${slug}:${id}`) and handle `asset.prompt.suggested` in `reduceVn`.

#### 3.2 Backend Handler ([`src/engine/vn/service.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/vn/service.ts))
- Implement `async suggestAssetPrompt(slug: string, id: string, instructions?: string): Promise<{ prompt: string; source: 'ai' | 'fallback' }>`:
  - Loads `book`, `settings`, and `assets.json` entry `id`.
  - Computes the deterministic baseline prompt using [`fallbackPrompt(entry, book, { pixel: settings.art.style === 'pixel', stylePrompt: settings.art.stylePrompt })`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/assets/derive.ts#L287-L336).
  - Gathers asset-specific story context from `book`:
    - `background`: place name, looks, scene description, time of day, style prefix.
    - `sheet` / `sprite`: character name, visual looks, expression, framing rules.
    - `cg` / `cover`: image entry description, display mode (`full` / `insert`), involved character looks, scene context, or `coverBrief`.
    - `music`: book title, genre, format, style, chapter titles/summaries.
    - `sfx` / `ambience`: sound entry kind and description from `book.sounds`, plus the dialogue/narration beats where the sound is triggered in `book.chapters`.
  - Picks role `'art-director'` for image kinds (`IMAGE_KINDS`) or `'composer'` for audio kinds (`AUDIO_KINDS`) and checks `this.deps.router.candidates(role, { projectModel: settings.models[role] })` (filtering out `client/...` models unless no other model exists so the UI button responds immediately without parking in MCP client queue).
  - Calls `this.deps.router.chat(...)` with a focused system + user prompt asking for a concise, vivid generation prompt tailored to the asset kind and engine (incorporating `instructions` if the user provided hints or an existing draft).
  - If the LLM call succeeds, formats the prompt (ensuring required style/framing prefix for image assets) and returns `{ prompt, source: 'ai' }`. If no direct LLM model is configured/reachable, returns `{ prompt: baseline, source: 'fallback' }`.
  - If `entry.prompt` was empty in `assets.json`, persists the suggested prompt to `assets.json` and emits `asset.updated`.
  - Emits `{ type: 'asset.prompt.suggested', slug, id, prompt, source }`.

#### 3.3 UI in Regenerate Modal ([`src/renderer/ui/book/AssetsTab.tsx`](file:///c:/projects/Personal/visual-novels-orchestrator/src/renderer/ui/book/AssetsTab.tsx))
- In [`RegenerateDialog`](file:///c:/projects/Personal/visual-novels-orchestrator/src/renderer/ui/book/AssetsTab.tsx#L392-L454):
  - Add a **"Generate with AI"** button in the `Prompt` field header (and an optional compact hint input or ability to use current text as guidance).
  - While waiting for `asset.prompt.suggested`, show `Generating prompt…` on the button.
  - When `promptSuggestions[`${slug}:${asset.id}`]` updates, populate the `Prompt` textarea with the generated prompt so the user can inspect/edit it and click **Regenerate**.

---

### Phase 4: Library Split Views (Tabs), Finished Filter & Format Badge

#### 4.1 [`src/renderer/ui/LibraryPage.tsx`](file:///c:/projects/Personal/visual-novels-orchestrator/src/renderer/ui/LibraryPage.tsx)
- **Top-level Tabs**:
  - Add a tab bar at the top of `LibraryPage`:
    - **Projects (`projectList.length`)**
    - **Scriptorium Books (`books?.length ?? 0`)**
  - When **Projects** is active:
    - Show a secondary segmented filter bar:
      - **All (`projectList.length`)**
      - **In progress (`inProgress.length`)**
      - **Finished (`finished.length`)**
    - Define `isProjectFinished(p: ProjectSummary): boolean` as `p.pipeline?.steps.build?.status === 'done'`.
    - Render the filtered project grid (or a tailored empty state with a button to switch to the **Scriptorium Books** tab if no projects exist yet).
  - When **Scriptorium Books** is active:
    - Render the **Scriptorium books** section and the **Import a book folder** section.
- **Project Type / Format Badge on `ProjectCard`**:
  - In [`ProjectCard`](file:///c:/projects/Personal/visual-novels-orchestrator/src/renderer/ui/LibraryPage.tsx#L140-L185):
    - Display `project.format` (e.g., `visual-novel`, `choice-visual-novel`, `mystery-puzzle-visual-novel`) as a badge alongside `project.kind` (`choice` / `linear`), `project.genre`, and a `Built` badge when `isProjectFinished(project)` is true.

---

### Phase 5: Scenes Tab (Inspect & Tweak Scenes)

#### 5.1 Protocol & Service Support ([`src/shared/protocol.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/shared/protocol.ts), [`src/engine/vn/service.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/vn/service.ts))
- Extend `ProjectDetail` in [`src/shared/protocol.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/shared/protocol.ts#L76-L86):
  - Include `cues: Record<string, SceneCues>` (from `this.store.loadCues(slug)`) so the renderer has the exact transitions, pauses, and cast slot mappings (`left` / `center` / `right`) for every scene and cast beat.
- Add commands to `VnCommand` in [`src/shared/protocol.ts`](file:///c:/projects/Personal/visual-novels-orchestrator/src/shared/protocol.ts):
  ```ts
  | {
      type: 'updateSceneCues'
      slug: string
      scenes?: { id: string; transition?: 'dissolve' | 'fade' | 'none' | null; pause?: number | null }[]
      casts?: { beatId: string; slots: Record<string, 'left' | 'center' | 'right'> }[]
      rebuild?: boolean
    }
  | {
      type: 'updateSceneStory'
      slug: string
      scenes?: { id: string; placeKey?: string | null; time?: string | null; music?: string | null; ambience?: string | null; description?: string }[]
      beats?: {
        id: string
        cast?: string[]
        speakerKey?: string | null
        expression?: string
        image?: string | null
        sfx?: string | null
        ambience?: string | null
      }[]
      rebuild?: boolean
    }
  ```
- In [`VnService.handle`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/vn/service.ts#L1633-L1765):
  - Handle `updateSceneCues`: calls `await this.setCues(cmd.slug, { scenes: cmd.scenes, casts: cmd.casts })`, emits `project.loaded` with the updated `detail(cmd.slug)`, and if `cmd.rebuild` is true, calls `await this.enqueueBuild(cmd.slug)`.
  - Handle `updateSceneStory`: calls `await this.editStory(cmd.slug, { scenes: cmd.scenes, beats: cmd.beats })`, emits `project.loaded` and `assets.listed`, and if `cmd.rebuild` is true, calls `await this.enqueueBuild(cmd.slug)`.

#### 5.2 Scenes Tab UI ([`src/renderer/ui/BookPage.tsx`](file:///c:/projects/Personal/visual-novels-orchestrator/src/renderer/ui/BookPage.tsx), [`src/renderer/ui/book/ScenesTab.tsx`](file:///c:/projects/Personal/visual-novels-orchestrator/src/renderer/ui/book/ScenesTab.tsx))
- Add `{ id: 'scenes', label: 'Scenes' }` to `TABS` in [`BookPage.tsx`](file:///c:/projects/Personal/visual-novels-orchestrator/src/renderer/ui/BookPage.tsx#L15-L23) and render `<ScenesTab slug={slug} detail={detail} />`.
- Create [`src/renderer/ui/book/ScenesTab.tsx`](file:///c:/projects/Personal/visual-novels-orchestrator/src/renderer/ui/book/ScenesTab.tsx) with:
  1. **Chapter & Scene Navigator**:
     - Filter by chapter or search scene ID / place; list each scene (`ch01.s01`, place name, time badge, beat count, cast icons).
  2. **Interactive 16:9 Stage Preview**:
     - Renders the scene's background asset (`scene.backgroundId`), any active CG/insert (`cg_<key>`) on the selected beat, and the 3 stage slots (`left`, `center`, `right`) populated with the actual character sprites (`sprite_<charKey>_<expression>`) computed by [`planScene(scene, cues[scene.id])`](file:///c:/projects/Personal/visual-novels-orchestrator/src/engine/game/stage.ts#L67-L116) at the currently selected beat!
     - Shows the dialogue box overlay at the bottom of the preview with the selected beat's speaker and text, plus Previous / Next beat scrubber buttons.
  3. **Scene Settings Bar**:
     - Edit scene **Transition** (`default`, `dissolve`, `fade`, `none`), **Pause** (`0`–`5`s), **Place** & **Time**, **Music** (`chapter default`, `silence`, or `music_01`…), and **Ambience** (`continue`, `silence`, or `amb_*`).
  4. **Cast & Beat Tweaker**:
     - For `cast` beats (and quick jump to the active `cast` beat governing the current dialogue line):
       - Visual slot editor for the characters in the cast (up to 3): assign each character to `left`, `center`, or `right` (automatically swapping if another character occupies that slot so duplicates are impossible), or add/remove characters from the cast beat.
     - For any beat:
       - If it's a `line` beat, change `speakerKey` or `expression` (from the character's available expressions).
       - Edit beat cues: **CG / Insert (`image`)**, **Sound Effect (`sfx`)**, and **Ambience (`ambience`)**.
     - **Save** and **Save & Rebuild Game** actions.

---

## Verification Plan

1. **Automated Unit Tests (`npm test`)**:
   - Run existing and new unit tests covering:
     - `emit.ts` (`buildGameData` character expression sprite emission when `book.expressions` is undefined).
     - `stage.ts` & `player-runtime.ts` (slot moves, scene transitions clearing slots, cast deduplication).
     - `scheduler.ts` & `service.ts` (`stopBook` and `stopPipeline` aborting running jobs and clearing queued jobs).
     - `service.ts` (`suggestAssetPrompt` returning AI/fallback prompts and persisting when empty).
     - `vn.ts` store reducer (`asset.prompt.suggested` event handling).
2. **Typecheck & Build (`npm run typecheck` / `npm run build`)**:
   - Verify clean TypeScript compilation across `main`, `preload`, `renderer`, `engine`, and `shared`.
3. **Existing Project Fix Verification**:
   - Rebuild `the-trap-room-at-the-lanterna` (or verify against its `vn.json` and `cues.json`) to confirm `game-data.json` includes all 8 canonical expressions for `signora_livia_brandolin`, `inspector_nada_ferluga`, etc., and `player.js` clears slots on move and scene change.
