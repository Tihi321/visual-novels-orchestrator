# Handoff: VNO-02, Chiptune Studio and Pixel Studio for VN Studio

Updated 2026-10-15, after implementation and commit. This supersedes the earlier handoffs.

## Where things stand
- VNO-02 is **implemented, verified and committed** in all three repos.
- **Nothing is pushed or merged.**
- The remaining work and recommendations are in **[next-steps.md](next-steps.md)**: the merge order, the manual QA list, the small gaps, and the recommended next tickets.
- Other documents:
  - [plan.md](plan.md): plan, checklist and live integration note.
  - [contracts.md](contracts.md): the shared MCP contract.
  - [changelog.md](changelog.md): files changed and verification.

| Repo | Branch | Base | Commit | Tests |
| --- | --- | --- | --- | --- |
| `C:\projects\Personal\midi-generator` | `MDI-03_vn-studio-music` | `origin/master` 425bd0b | `02c867b` | 829 pass |
| `C:\projects\Personal\pixel-art-generator` | `PAR-05_vn-studio-art` | `origin/master` 3f2cf19 | `2ddfe83` | 363 pass |
| `C:\projects\Personal\visual-novels-orchestrator` | `VNO-02_chiptune-pixel-studio` | `origin/master` a72c21b | `7de17cd` + a docs commit | 436 pass |

Merge order: midi-generator, then pixel-art-generator, then visual-novels-orchestrator.

## What's done
- **Chiptune Studio:**
  - Headless `yarn mcp` on port 7458.
  - New tools: `compose_track`, `render_audio` (ogg that ends exactly at the loop end), and song tools.
  - Calm moods and soft presets.
  - Export on save, with a `.json` loop sidecar.
- **Pixel Studio:**
  - Headless `yarn mcp` on port 7457.
  - New tools: `import_image` (downscale, palette, dither, cleanup, outline), exact-size `export_png` / `export_many`, `draw_sprite_from_reference`, and document tools.
  - Export on save.
- **VN Studio:**
  - Music provider comfy or chiptune, with Ren'Py `<loop S>`.
  - Pixel Studio pixelate with a sharp fallback.
  - Draw mode.
  - "Open in" round trip.
  - Look tab and Generators page.
  - Seed refresh.
- **Live-tested** on the soother book: pixel art, fallback, music loops, Ren'Py lint, and the round trip for both studios. The round trip was driven through the windows' MCP save tools.

## How to run it
- **Start a studio headless:**
  - `cd <studio repo> && yarn build && yarn mcp`
  - Stopping the background `yarn` can leave the Electron child holding the port. Kill it by port (`Get-NetTCPConnection -LocalPort 7457`).
- **Live test data:** `.claude/temp/e2e-vno02`, a copy of e2e-data, slug `the-soother-that-fell-into-dragon-land`. Example commands:
  - `VNO_DATA=.claude/temp/e2e-vno02 node out/engine/index.js studios status`
  - `… settings <slug> --style pixel --pixel-provider pixel-studio --pixel-size 320x180 --dither ordered`
  - `… generate <slug> --only <id> --force`
  - `… run <slug> --from stage --force`
  - `… studio open <slug> <assetId> --wait`
- **Local services:**
  - ComfyUI at `127.0.0.1:8188`.
  - Ren'Py SDK at `C:\projects\Local\renpy\renpy-8.5.3-sdk`.
  - ffmpeg on PATH.
  - Usually no LLM is running, so agents use their deterministic fallbacks.
- **MCP probe from Node:** load `@modelcontextprotocol/sdk` from a studio repo's node_modules. On Windows, import it via `pathToFileURL(require.resolve(...)).href`.
- **Gotcha:** the shell tool mangles backslashes in heredocs. Write file content with the Write and Edit tools.

## Next step
1. With the user's OK, push the three branches and open PRs.
2. Do the manual QA in next-steps.md §1b.
3. Merge in the order above.
4. Then pick the next ticket from next-steps.md §2. The recommendation is auto-starting the studios from VN Studio.
