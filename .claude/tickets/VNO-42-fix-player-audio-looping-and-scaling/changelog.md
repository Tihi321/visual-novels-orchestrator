# Changelog: VNO-42 - Fix Web Player Music Looping, Audio Continuity, and Responsive Stage Scaling

**Date**: 2026-10-24  
**Ticket ID**: VNO-42  
**Summary**: Resolved music termination issues with looping, seamless rewinding, chapter-cue fallback, and gesture unlocking; fixed viewport stage scaling and background image distortion with proportional transform centering.

---

### Repository: `visual-novels-orchestrator`
- **Branch**: `VNO-42_player-audio-and-scaling`
- **Commit Status**: Committed to `VNO-42_player-audio-and-scaling` and pushed

#### Files Changed
1. **`src/engine/game/player-runtime.ts`**:
   - Added `loop` attribute to `<audio id="vno-audio-music">` by default.
   - Fixed `#vno-stage` CSS positioning: set `top: 50%`, `left: 50%`, `transform: translate(-50%, -50%) scale(1)`, and `transform-origin: center center`.
   - Updated `handleResize()` to apply `translate(-50%, -50%) scale(...)` with `left = '50%'` and `top = '50%'`, preventing offset drift and diagonal cutoff on non-1080p viewports.
   - Added container `ResizeObserver` and window `orientationchange` listeners to immediately react to browser resizing and iframe layout changes.
   - Added `setupAutoplayUnlock()` listening for `click`, `pointerdown`, and `keydown` to automatically resume deferred background audio once the user interacts with the page.
   - Enhanced `playMusic(trackId, loopStart)` to:
     - Check `item.loopStartSec` when `loopStart` is not explicitly passed.
     - Reset `currentTime = 0` on track start and clean up previous listeners.
     - Enable `loop = true` when no loop point is specified.
     - Bind `ontimeupdate` (with 0.25s threshold) and `onended` rewinding to `loopStart` when `loopStart > 0`.
   - Added `stopMusic()` helper, called when `scene.music === null && scene.musicExplicitNull`.
   - Added `background-repeat: no-repeat` to `.vno-bg` and `.vno-cg-overlay`.
   - Updated `.vno-slot` width to `min(640px, 35%)` to allow character sprites to scale proportionally without being squeezed into 480px.

2. **`src/engine/game/emit.ts`**:
   - Updated `buildGameData` so `scene.music` falls back to `cues.chapters[ch.n]?.music ?? null` when not overridden on the scene level, matching Ren'Py audio continuity.
   - Passed `musicIds` to `defaultCues` in `buildGameData` and `emitProject` so rotation tracks are registered.
   - Added `musicExplicitNull: stagePlan.music === null` to `GameDataScene` to distinguish intentional silence from omitted scene cues.
   - Exported `music` and `musicLoopStartSec` on `GameDataChapter` interface.

3. **`tests/renpy-template.test.ts`**:
   - Extended `FakeElement` with `loop` and `onended`.
   - Extended `fakeWindow` with listener tracking and `dispatchEvent`.
   - Added comprehensive test suite `VNO-42: Web Player Audio Continuity and Responsive Stage Scaling`:
     - Verified responsive scaling computes `translate(-50%, -50%) scale(...)` at 50% left/top for ultrawide (1024×380), standard (1920×1080), and portrait mobile (800×1200).
     - Verified music loops infinitely when `loopStart` is absent.
     - Verified music with `loopStartSec > 0` rewinds via both `ontimeupdate` and `onended`.
     - Verified user interaction unlock on first tap/click.
     - Verified chapter music fallback in `buildGameData` and explicit silence flag.

---

### Deviations From Plan
- When `playMusic` is called without an explicit `loopStart` parameter, it now automatically reads `item.loopStartSec` from track metadata in `gameData.audio.music[trackId]`, ensuring main menu and chapter music seamlessly loop using their configured cue loop points.
- Passed `musicIds` to `defaultCues` in `emit.ts` so default chapter music assignments are populated even when custom cues are omitted.

---

### Verification
- **Unit tests**: `yarn test tests/renpy-template.test.ts` (14/14 tests pass).
- **Full test suite**: `yarn test` (69/69 test files pass, 981 tests pass).
- **Typecheck**: `yarn typecheck` (exit 0, clean).
- **Linter**: `yarn lint` (exit 0, clean).
- **Checks not run**: Manual browser run with physical audio hardware in an external browser session (automated DOM audio lifecycle tests run and passed).

---

### Follow-ups
None. Ready to merge into `master`.
