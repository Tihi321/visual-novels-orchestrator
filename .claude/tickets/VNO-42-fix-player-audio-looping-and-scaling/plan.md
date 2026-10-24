# VNO-42: Fix Web Player Music Looping, Audio Continuity, and Responsive Stage Scaling

Branch: `VNO-42_player-audio-and-scaling` (cut from `master`).

## Context & Problem Statement
In the standalone HTML5 Visual Novel web player (`src/engine/game/player-runtime.ts` and `src/engine/game/emit.ts`):
1. **Music stops playing**:
   - `<audio id="vno-audio-music">` lacked a default `loop` attribute.
   - In `playMusic()`, when `loopStart` was not set or <= 0, `loop` was never enabled on the element; once the track completed, playback terminated permanently.
   - When `loopStart` was set, only an `ontimeupdate` event (~250ms interval) was checking `duration - 0.1s`; if the audio ended between intervals, `ended` fired without an `ended` listener, stopping playback.
   - In `src/engine/game/emit.ts`, `sceneMusic` did not fall back to `cues.chapters[ch.n]?.music`, emitting `music: null` for all scenes that relied on chapter-level music cues. In addition, `defaultCues` was not passed `musicIds` in `buildGameData`.
   - Browser autoplay restrictions prevented audio until first user gesture, but no global unlock listener resumed deferred audio on user click/tap.
2. **Stage and image scaling is not responsive**:
   - `#vno-stage` had `transform-origin: center center`, while `handleResize()` set `dom.stage.style.left = ((ww - 1920 * scale) / 2) + 'px'`, which is the offset formula for `transform-origin: 0 0`.
   - The conflict between center-origin scaling and top-left pixel placement pushed `#vno-stage` diagonally down-and-right on any viewport smaller than 1920×1080 (such as standard laptops, ultrawide cropped windows, or mobile), causing severe clipping and asymmetric letterboxing.
   - No `ResizeObserver` was attached, missing container/iframe resizes.
   - `.vno-bg` and `.vno-cg-overlay` lacked `background-repeat: no-repeat`, and `.vno-slot` had a hard-coded 480px width constraint that clamped wider character sprites.

---

## Checklist

- [x] **1. Audio Looping, Autoplay Unlocking & Cue Continuity (`src/engine/game/player-runtime.ts` & `src/engine/game/emit.ts`)**:
  - [x] Add `loop` attribute to `<audio id="vno-audio-music">` in the HTML template.
  - [x] Update `playMusic(trackId, loopStart)`:
    - If the same track is already playing and unpaused, keep playing smoothly.
    - Default `loopStart` to `item.loopStartSec` when available on the track metadata.
    - Reset `currentTime = 0` when starting a new track.
    - If `loopStart > 0`, configure `ontimeupdate` (with threshold `0.25s`) and an `onended` handler that seeks back to `loopStart` and calls `.play()`.
    - If no `loopStart`, set `dom.audioMusic.loop = true`.
    - Catch deferred autoplay rejections cleanly.
  - [x] Add user-gesture unlock listener (`click`, `pointerdown`, `keydown`) that automatically resumes pending background music if the browser blocked initial autoplay.
  - [x] In `src/engine/game/emit.ts`, ensure `sceneMusic` falls back to `cues.chapters[ch.n]?.music ?? null`, matching Ren'Py's chapter music continuity, and pass `musicIds` to `defaultCues`.
  - [x] Support explicit music stop when a scene defines `music === null && scene.musicExplicitNull` while maintaining chapter continuity when omitted.

- [x] **2. Responsive Stage Centering & Image Scaling (`src/engine/game/player-runtime.ts`)**:
  - [x] Update `#vno-stage` CSS to:
    - `top: 50%; left: 50%; transform: translate(-50%, -50%) scale(1); transform-origin: center center;`
  - [x] Update `handleResize()` to set `dom.stage.style.transform = 'translate(-50%, -50%) scale(' + scale + ')'` and `dom.stage.style.left = '50%'`, `dom.stage.style.top = '50%'`.
  - [x] Attach a `ResizeObserver` on `#vno-container` alongside `window.addEventListener('resize', handleResize)` and `orientationchange`.
  - [x] Add `background-repeat: no-repeat` and ensure `background-size: cover; background-position: center` on `.vno-bg` and `.vno-cg-overlay`.
  - [x] Expand `.vno-slot` max-width and sizing (`width: min(640px, 35%)`) so character sprites scale naturally without distortion.

- [x] **3. Automated Test Suite & Verification (`tests/renpy-template.test.ts` & full test run)**:
  - [x] Add unit tests verifying:
    - `handleResize` correctly computes transform `translate(-50%, -50%) scale(...)` for wide, standard, and tall screen dimensions.
    - Music loops infinitely by default when `loopStart` is absent, and jumps to `loopStart` when defined.
    - Chapter music fallback in `emit.ts` populates `scene.music`.
    - Autoplay unlock on first user click.
  - [x] Run `yarn test` (all 69 files / 981 tests pass).
  - [x] Run `yarn typecheck` (exit 0) and `yarn lint` (exit 0).

- [x] **4. Changelog & Handoff**:
  - [x] Create `.claude/tickets/VNO-42-fix-player-audio-looping-and-scaling/changelog.md`.
