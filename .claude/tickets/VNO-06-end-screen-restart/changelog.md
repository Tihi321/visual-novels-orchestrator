# VNO-06 changelog

## 2026-10-20: "Start again" on the end screen crashed the game

Branch `VNO-06_end-screen-restart` from master 73778e1. Uncommitted.

**Symptom.** The user played the hub test game `quarter-tone-test` to the end and clicked "Start again". Ren'Py stopped with `renpy.game.JumpOutException: start` at `call screen the_end()`.

**Cause.** The `the_end` screen in `templates/renpy/game/screens.rpy` used the action `Start()`. `Start()` only works from the main menu: it jumps out of the menu context. Inside the game there is no such context, so the exception is never caught. Ren'Py lint does not run actions, so it passed.

**Fix**
- `templates/renpy/game/screens.rpy`: "Start again" now uses `action Jump("start")`, with a comment saying why. The main menu's own `Start()` (line 302) is correct and was left alone.
- `tests/renpy-template.test.ts` (new): the `the_end` screen uses `Jump("start")` and has no `Start()` action.

**Verification**
- `yarn test`: 46 files, 558 passed.
- `yarn lint`: ok.
- `quarter-tone-test` was rebuilt with `vno_build`. Its `screens.rpy` has the fix, and Ren'Py lint is clean.
- Not checked: clicking "Start again" in the game. The user still has to play it.
- Games built before this fix keep the bug until they are rebuilt.
