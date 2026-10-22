# Roadmap

What VN Studio still lacks on its own. Work that needs the other tools or a production run (live checks, Flow as a provider, starting the studios, puzzle visual novels) is planned in the creative hub (`C:\projects\Personal\creative-hub\ROADMAP.md`, tickets `HUB-NN` in its `.claude/tickets/`). Finished work is in `.claude/tickets/` (VNO-04 story tools and languages, VNO-05 client provider, VNO-06 end-screen restart, VNO-07 hand-drawn art, VNO-08 the hub roadmap fixes). Fix items on a ticket branch (`VNO-NN_<what>`) cut from `master`.

## Where it stands (2026-10-22, master 7ff8a2d)

- **Merged:** VNO-04 to VNO-08. VNO-08 closed every VN Studio item of the hub roadmap. 717 tests pass; `renpy lint` is clean on all 9 integration cases (Ren'Py 8.5.3).
- **Verified live:** two *Clockless God* VNs (linear and with choices) built from Scriptorium scripts and played by the user; a pixel-art book with Claude as the client for the model roles; story tools with German, English and Arabic editions.
- **Hub tasks that change or use this repo:** HUB-03 (VNO-08 live check), HUB-07 (Flow provider, `VNO-10`), HUB-08 (start the studios, `VNO-11`), HUB-10 (puzzle visual novels, `VNO-12` onwards).

## Tests

- VNO-08 phase 6 has fewer unit tests than planned: story ops and Ren'Py output for media cues are covered by `tests/vn-media-cues.test.ts` and one Ren'Py integration case only.
- The hand-mode test does not cover `key` background removal.
