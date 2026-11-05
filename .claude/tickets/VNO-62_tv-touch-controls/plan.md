# VNO-62 TV and touch controls for the HTML5 Web Player (VN Studio)

Branch: `VNO-62_tv-touch-controls` (from `master`). Ticket of the hub task HUB-27, task T1.

The plan is `C:\projects\Personal\creative-hub\.claude\tickets\HUB-27-vn-tv-touch-controls\plan.md` (research next to it in `research.md`). Read these parts of it:

- "Scope" items 1 to 4 (language picker, voice stop and mute, D-pad in the player, touch).
- "Player and bridge key contract" (the `data-vno-nav` flag, `window.VNO_NAV`, key handling rules).
- Acceptance A1, A4 (the vitest part) and A5.

## T1 checklist

- [x] Language picker `#vno-picker` replaces the three `<select>`s (same ids, now buttons)
- [x] Voice stop and mute in the top-right HUD, Preferences "Voices" row, `settings.voiceMuted`
- [x] D-pad: one `document` key handler, layers, Back keys, pause menu `#vno-pause-menu`, history for Android Back, focus on open, 700 ms OK grace, `vno-kb` focus ring
- [x] Touch: rotate hint, `--vno-hud-k`, tap anywhere advances, `touch-action`, hover under `@media (hover: hover)`
- [x] `PLAYER_UI_KEYS` and Croatian strings (`src/shared/ui-strings.ts`)
- [x] Tests (`tests/renpy-template.test.ts`): A1, A4 (vitest part), A5
- [x] `ROADMAP.md` row
