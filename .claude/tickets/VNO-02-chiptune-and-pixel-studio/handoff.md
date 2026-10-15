# Handoff: VNO-02, Chiptune Studio and Pixel Studio for VN Studio

Updated 2026-10-15, after implementation. The original pre-implementation handoff is superseded.

## Where things stand
- VNO-02 is **implemented and verified**:
  - Unit tests and live integration pass in all three repos.
  - **Nothing is committed or pushed.**
- Documents:
  - Plan with checklist and integration note: [plan.md](plan.md)
  - Shared MCP contract: [contracts.md](contracts.md)
  - What changed: [changelog.md](changelog.md)

| Repo | Branch | Base | Status |
| --- | --- | --- | --- |
| `C:\projects\Personal\visual-novels-orchestrator` | `VNO-02_chiptune-pixel-studio` | `origin/master` a72c21b (VNO-01 merged) | uncommitted; 436 tests pass |
| `C:\projects\Personal\midi-generator` | `MDI-03_vn-studio-music` | `origin/master` 425bd0b | uncommitted; 829 tests pass; ticket `.claude/tickets/MDI-03-vn-studio-music/` |
| `C:\projects\Personal\pixel-art-generator` | `PAR-05_vn-studio-art` | `origin/master` 3f2cf19 | uncommitted; 363 tests pass; ticket `.claude/tickets/PAR-05-vn-studio-art/` |

## How to run it
- **Start the studios headless:**
  - `cd <repo> && yarn build && yarn mcp`
  - Ports: Pixel Studio 7457, Chiptune Studio 7458.
  - Stopping the background `yarn` can leave the Electron child process holding the port. Kill it by port.
- **Live test data:** `.claude/temp/e2e-vno02`, a copy of e2e-data, slug `the-soother-that-fell-into-dragon-land`. Example commands:
  - `VNO_DATA=.claude/temp/e2e-vno02 node out/engine/index.js studios status`
  - `… settings <slug> --style pixel --pixel-provider pixel-studio --pixel-size 320x180 --dither ordered`
  - `… generate <slug> --only <id> --force`
  - `… run <slug> --from stage --force`
  - `… studio open <slug> <assetId> --wait`
- **MCP probe script** (from this session's scratchpad, may be gone): a small Node client using `@modelcontextprotocol/sdk` from a studio repo's node_modules. Import it with `pathToFileURL` on Windows.

## Still open
- Manual checks:
  - Listen for the loop seam in `vno run`.
  - Press Ctrl+S by hand in the studio windows.
  - Check the VN Studio Look tab and Generators page by eye.
  - Run `pixel-studio-draw` with an LLM running.
- Minor follow-ups (in the changelog):
  - The song file extensions differ (`.ctune` vs `.song`).
  - Studio MCP tokens are not sent.
- Next step: commit each repo on its branch and open PRs, when the user asks.
