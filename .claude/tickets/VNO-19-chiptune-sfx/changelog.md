# VNO-19 changelog (2026-10-22)

## Behaviour

- `sound.sfxEngine: "chiptune"` makes `sfx_<key>` with Chiptune Studio `compose_sfx` (with a file path, ogg) instead of needing an imported file. The sound is picked from the key, then the description, among the studio's sfx names (coin, door, footstep, chime, thunder ...); no match uses `blip` and adds a warning to the version.
- `sound.ambienceEngine: "chiptune"` makes `amb_<key>` as a `compose_sfx` ambience loop (wind, rain, waves, cave, night, fire, machine, drone; 60 s unless `sizes.ambienceSeconds`, clamped 4..120; loop 0 to end). The default (a ComfyUI music engine) is unchanged.
- Neither is a default, also not for pixel books (a default would change existing projects and need the studio running).
- The chip is `music.chip` when set. The native song is saved next to the file (`v<n>.song`), like a track.
- Imported/locked files are never overwritten; every run is a new version; a studio that is down fails the asset with its start hint.
- `vno_update_settings` accepts `sound: {sfxEngine, ambienceEngine}` (it was described but missing from the schema).

## Files

- `src/engine/studios/chiptune.ts` (`composeSfx`), `src/engine/studios/music.ts` (`makeChiptuneSound`, shared `keepRendered`), `src/engine/studios/chip-sound.ts` (new), `src/engine/assets/generate.ts`, `src/shared/vn.ts` (comment), `src/engine/mcp/tools.ts`, `src/engine/mcp/tools-story.ts` (descriptions), `docs/mcp-guide.md`.
- Tests: `tests/chiptune-sfx.test.ts` (new), `tests/studio-fakes.ts` (fake `composeSfx`).
- `ROADMAP.md`.

## Verification

`yarn test`: 57 files, 752 tests pass (742 before; 10 new). `yarn typecheck` and `yarn lint`: clean. Not run: a live call to a running Chiptune Studio (the argument shape follows its `docs/llm-guide.md` and MDI-05 changelog); no UI picker exists for these settings.
