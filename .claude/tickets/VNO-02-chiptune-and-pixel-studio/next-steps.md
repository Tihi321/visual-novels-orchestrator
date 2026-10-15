# VNO-02: what remains and what to do next

Written 2026-10-15, after VNO-02 was implemented and committed. Implementation details are in [changelog.md](changelog.md); the resume point for a new session is [handoff.md](handoff.md).

## 1. Still to do for VNO-02 itself

Everything in the plan is built. These items are left before VNO-02 counts as fully done.

### 1a. Push and merge (needs the user's go-ahead)
| Order | Repo | Branch | Commit | Merge into |
| --- | --- | --- | --- | --- |
| 1 | midi-generator | `MDI-03_vn-studio-music` | `02c867b` | `master` |
| 2 | pixel-art-generator | `PAR-05_vn-studio-art` | `2ddfe83` | `master` |
| 3 | visual-novels-orchestrator | `VNO-02_chiptune-pixel-studio` | `7de17cd` + docs commit | `master` |

- Merge the studios first. VN Studio calls their new MCP tools at runtime, although it builds without them.
- No branch is pushed yet.

### 1b. Manual QA not yet done
- [ ] **Loop seam by ear.**
  1. Build the soother game (`VNO_DATA=.claude/temp/e2e-vno02`).
  2. `vno run` it.
  3. Let a chapter track loop: no click or gap at the loop point. The file length is already confirmed to equal `loopEndSec`.
- [ ] **Ctrl+S by hand in Pixel Studio**: "Open in Pixel Studio" from the asset card, edit a pixel, press Ctrl+S. A new custom, locked version appears and the game rebuilds. So far this was only tested through the window's MCP `save_document`.
- [ ] **Ctrl+S by hand in Chiptune Studio**: the same with a music track. Loop points come through the `.json` sidecar.
- [ ] **VN Studio UI by eye**:
  - The Look tab's new controls.
  - The Generators page: four status cards with start hints.
  - The asset card's "Open in …" buttons, warnings, and the "edited by hand" pill.
- [ ] **`pixel-studio-draw`** with an LLM running (LM Studio or Strata): agent-drawn 64x96 sprites, with the step and time caps honoured.
- [ ] **Packaged studio exe** with `--mcp-only`, and the `exe` override in `config/studios.md`.
- [ ] **`yarn test:electron`** in midi-generator (not run; it passed in pixel-art-generator).

### 1c. Small known gaps
- [ ] Song file extensions: generated versions store `v<n>.ctune`, round-trip versions `v<n>.song`. Use `.ctune` everywhere (VN Studio `src/engine/vn/roundtrip.ts`).
- [ ] VN Studio does not send `PIXEL_STUDIO_MCP_TOKEN` / `CHIPTUNE_STUDIO_MCP_TOKEN`. The headless servers have no auth by default, so this only matters if a token is set. Add a `token` field in `studios.md` and send it as a Bearer header from `mcp-http.ts`.
- [ ] Pixel Studio cannot import WebP. VN Studio always passes PNG, so only direct MCP users are affected.
- [ ] A stale `cues.json` keeps its old music mapping until the stage step runs again (seen on the VNO-01 data). Invalidate the stage cues when the music assets change.

## 2. Recommended next work (in priority order)

1. **Auto-start the studios from VN Studio.**
   - Today the user has to run `yarn build && yarn mcp` in each studio repo.
   - Add "Start" buttons on the Generators page, and an option to auto-launch on demand in the pipeline, the same way the VibeTTS headless launch could work. VN Studio spawns `<exe|yarn> --mcp-only`, waits for the "MCP listening" line, and stops the studio on exit.
   - This is the biggest usability gain, since the pixel and chiptune paths are otherwise silently skipped (fallback) or fail.
2. **Close the manual QA list (1b), then merge (1a).** About an hour of hands-on checking. This finishes VNO-02 properly.
3. **Better chiptune music.**
   - Let the composer agent refine `compose_track` output with `write_pattern` / `write_melody` when an LLM is available. Give each chapter its own motif and a 1-2 bar intro (the contract already allows it).
   - Add a "variation" track per mood, so chapters sharing a mood do not sound identical.
   - Map scene mood from the stage director to `compose_track` moods (tense → `mysterious-calm`, bedtime → `lullaby`).
4. **Better pixel art presets.**
   - Ordered dither on 320x180 backgrounds looked busy. Default backgrounds to `dither: none` with `maxColors` around 24, and sprites to `outline: true`.
   - Add per-theme palette presets (storybook → endesga-32, retro → pico-8, gameboy → gb-4).
   - Run a side-by-side comparison of a few soother backgrounds to pick the defaults.
5. **End-to-end test for the round trip.** A Playwright test that opens an asset in the studio window, presses Ctrl+S, and asserts the new VN Studio version. This would replace manual QA items 1b-2 and 1b-3 for the future.
6. **Clean up the small gaps (1c).** One small ticket: `.ctune` naming, the optional token, and cue invalidation.
7. **Later.**
   - Spritesheet and animation support through Pixel Studio frames (idle blink, talking mouth) using `export_spritesheet` and Ren'Py ATL.
   - Chiptune stems for dynamic music layers.
