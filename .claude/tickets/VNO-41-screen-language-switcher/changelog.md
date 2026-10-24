# Changelog — VNO-41: Persistent Per-Screen Language Switcher Dropdown

## 2026-10-24 — `VNO-41`

**Summary:** Added an always-accessible stage HUD language dropdown (`#vno-lang-bar` / `#vno-stage-language`) to the HTML5 Web Player so players can switch between any built edition language from any screen, immediately updating the active screen in place and continuing in the selected language from that point onward.

- **Repository:** `visual-novels-orchestrator`
- **Branch:** `VNO-41_screen-language-switcher` (cut from `origin/master` `79c8a19`)
- **Commit status:** committed and pushed to `origin/VNO-41_screen-language-switcher`

### Files Changed
- `src/engine/game/emit.ts`:
  - Deduplicated `allLangs` in `buildGameData` so `gameData.languages` always starts with `book.primaryLang` followed by unique edition language codes in order.
  - Added `speakerAliasKey?: string` to `GameDataSceneBeat` and populated `${b.speakerKey}#${aliasIdx}` when a `line` beat uses a character alias (`aliasIndex(char, b.speakerLabel) > 0`), enabling localized alias names when switching languages on any dialogue beat.
- `src/engine/game/player-runtime.ts`:
  - `generateIndexHtml`: Added `#vno-lang-bar` (`#vno-lang-bar-label` + `<select id="vno-stage-language">`) inside `#vno-stage`, plus stable element IDs for modal screen headers and preference labels (`#vno-history-title`, `#vno-prefs-title`, `#vno-about-title`, `#vno-about-book-title`, `#vno-pref-label-*`).
  - `generatePlayerCss`: Styled `.vno-lang-bar`, `.vno-lang-bar-label`, and `.vno-lang-select` at `z-index: 200` with `pointer-events: auto` and RTL mirroring (`[dir="rtl"] .vno-lang-bar { right: auto; left: 28px; }`) so the dropdown sits above fullscreen cards, overlays, and modal screens.
  - `generatePlayerJs`:
    - Stopped event propagation (`click`, `mousedown`, `mouseup`, `touchstart`, `keydown`) on `#vno-lang-bar` so opening or changing the dropdown never advances dialogue or dismisses a chapter title card.
    - Populated and synchronized both `#vno-stage-language` and `#vno-pref-language` from `gameData.languages`, starting with `gameData.primaryLang`.
    - Implemented `switchLanguage(langCode)`, `applyLanguageTypography()`, `updateUiStrings()`, `formatBeatHtml()`, `getLocalizedCharacterName()`, and `refreshActiveScreens()` to immediately re-render the active screen (Main Menu, Chapter Title Card, Dialogue & Narration beats with HTML emphasis and localized character aliases, Branching Choices using `ch.number + ':' + i`, Interactive Puzzles preserving `struckClues`, History log entries, Save/Load screen, Preferences, About, and Ending Card) and continue in the selected language for all subsequent beats, scenes, and chapters.
    - Exposed `switchLanguage` and `getLanguages` on `window.VNOEngine`.
- `tests/renpy-template.test.ts`:
  - Added tests verifying `#vno-lang-bar` / `#vno-stage-language` HTML and CSS emission (`z-index: 200`, RTL rule).
  - Added a multi-language (`de`, `en`, `hr`) DOM runtime test harness verifying live language switching from the Main Menu, Chapter Card, Dialogue beat (with character alias and markdown emphasis), Narration beat, History screen, Interactive Puzzle screen (preserving struck clues), Branching Choice screen, and Ending screen, and confirming that the selected language continues to be active on subsequent beats and chapters.
- `ROADMAP.md`:
  - Documented `VNO-41` under the current branch status and "Done".
- `.claude/tickets/VNO-41-screen-language-switcher/plan.md`:
  - Recorded branch `VNO-41_screen-language-switcher` and marked all checklist items `[x]` with verification results.

### Deviations from Plan
- The custom `implementer` agent definition lacked write/command tools in the current session, so per the `implement` skill fallback rule, the bounded implementation slice was delegated via `TypeName: "self"` with the `implementer` bounded-worker rules inlined. No functional or scope deviations from the plan.

### Verification
- **Passed:**
  - `yarn test` — 69 test files passed, 976 tests passed (0 failures).
  - `yarn typecheck` — exited 0 with no errors.
  - `yarn lint` — exited 0 with no errors.
- **Not run:**
  - Manual interactive play session in an external browser / Electron window (automated DOM runtime harness tested the generated `index.html`, `player.css`, and `player.js` across all screens).

### Follow-ups & Known Limitations
- Built projects created before `VNO-41` should click **Build** once in the **Build** tab to regenerate `game/index.html`, `game/player.css`, `game/player.js`, and `game/game-data.js` with the persistent stage language dropdown.
