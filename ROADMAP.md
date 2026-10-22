# Roadmap

What VN Studio still lacks on its own. Work that needs the other tools or a production run (live checks, Flow as a provider, starting the studios, puzzle visual novels) is planned in the creative hub (`C:\projects\Personal\creative-hub\ROADMAP.md`, tickets `HUB-NN` in its `.claude/tickets/`). Each item here is a ticket with a plan in `.claude/tickets/VNO-NN-<name>/plan.md`, done in the order below. Finished work is in `.claude/tickets/` (VNO-04 story tools and languages, VNO-05 client provider, VNO-06 end-screen restart, VNO-07 hand-drawn art, VNO-08 the hub roadmap fixes). Work on a ticket branch (`VNO-NN_<what>`) cut from `master`.

## Where it stands (2026-10-22, master 6e25fa0)

- **Merged:** VNO-04 to VNO-09. VNO-08 closed every VN Studio item of the hub roadmap. 717 tests pass; `renpy lint` is clean on all 9 integration cases (Ren'Py 8.5.3).
- **On branch `VNO-17-18_roadmap-tasks` (not merged):** VNO-17 and VNO-18, test-only; 741 tests pass.
- **Verified live:** two *Clockless God* VNs (linear and with choices) built from Scriptorium scripts and played by the user; a pixel-art book with Claude as the client for the model roles; story tools with German, English and Arabic editions.
- **Hub tasks that change or use this repo:** HUB-03 (VNO-08 live check), HUB-06 (CG characters at import, `VNO-16`), HUB-07 (Flow provider, `VNO-10`), HUB-08 (start the studios, `VNO-11`), HUB-10 (puzzle visual novels, `VNO-12` to `VNO-15`). Those numbers are reserved; this roadmap's tickets start at VNO-17.

## Tasks, in order

None open. New work gets the next free number (VNO-19), a plan in `.claude/tickets/VNO-NN-<name>/plan.md` and a row here; when it is done, its changelog sits next to its plan and its row moves to "Done" below.

## Done

- **VNO-17** (2026-10-22): unit tests for media cues and expression sets: story, import, derive, generate, Ren'Py output (snapshots `media-ch01.rpy`, `media-ch02.rpy`), cue precedence and the MCP tools. No bug found.
- **VNO-18** (2026-10-22): the hand-mode test imports a sprite through `vno_asset_import` in both art styles; the flat-colour `key` cuts it out and ComfyUI is never called. 741 tests pass.
- **VNO-16** (2026-10-22): a `CG:` or `INSERT:` image from an imported script gets `characters`: the bible characters whose name or alias is in the cue text (at most 3, in text order), so the art director has their looks and sheets. No match leaves it unset.
