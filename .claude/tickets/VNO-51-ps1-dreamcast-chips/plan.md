# VNO-51: PS1 and Dreamcast chips and synth moods

Branch `VNO-51_ps1-dreamcast-chips`. From hub ticket HUB-18 (section 1). Chiptune Studio (MDI-10) added the chips `ps1` and `dreamcast` and the `compose_track` moods `synthwave`, `outrun`, `darkwave` and `dreamwave`; VN Studio had five chips hard-coded and accepted only calm moods at 100 bpm at most.

- `src/shared/vn.ts`: `CHIPS` gets `ps1` and `dreamcast` appended (zod `music.chip`, the Look tab select and `vncli settings --chip` follow).
- `src/engine/studios/chip-plan.ts`: `SYNTH_MOODS` (dreamwave, synthwave, darkwave, outrun) and `MUSIC_MOODS`; a synth mood may go to `MAX_SYNTH_BPM` 118, a calm one stays at 100; a synth genre (neon, 80s, synthwave, ...) plans `dreamwave` first and rotates dreamwave, synthwave, darkwave, dreamwave, ambient; `chipFor` takes `genreText` (synth: dreamcast, 90s / PS1: ps1, else snes). A book that matches neither keeps exactly its old plan.
- `src/engine/vn/agents/composer.ts`: chips and moods for the prompt come from `CHIPS` and `MUSIC_MOODS`.
- `seed/prompts/composer/plan_music.md`: which chip and which synth mood fit which book, synth tempo 80 to 110. No seed-history change: unedited data folders already have their copied hash recorded in `.seed-hashes.json`.
- `vncli.ts` help line, `vno_update_settings` text, `docs/mcp-guide.md`: the seven chips and the four synth moods.
- Tests: `tests/chip-plan.test.ts` (merge, clamp, fallback, old plan pinned, zod schema), `tests/chiptune-sfx.test.ts` (compose_sfx passes `chip: dreamcast`).
- Verify: `typecheck`, `lint`, `test`.
