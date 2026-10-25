# VNO-48 — changelog

**2026-10-25 — VNO-48: the web player gets a readable theme-aware Preferences screen, separate interface and story
languages, picture-book captions that fit, and a music/voice balance.**

Branch: `VNO-48_player-preferences-and-languages` (cut from `origin/master` = `1e73760`).

## What changed, per file

### `src/shared/ui-strings.ts`
- New `PLAYER_UI_KEYS`: the 44 menu keys the HTML5 player actually asks for, so a build ships only what the runtime uses.
- The Croatian table gained the player-only strings `Text`, `Audio`, `Close`, `Interface Language`, `Story Language`,
  `Story Text Size` (plus `Save Game` / `Load Game`, which the save screen asks for and no table had). Other tables are
  untouched at their 49 core keys; they fall back to the English literal, and `config/languages.md` (`ui`) can override.

### `src/engine/game/emit.ts`
- New `GameDataUiLanguage` and optional `GameData.uiLanguages`: English first with an empty table (the English
  literals), then every registered language whose UI table has at least one player key, filtered to `PLAYER_UI_KEYS`
  and sorted by English name. `editions[lang].ui` is unchanged (Ren'Py/legacy path). The payload is 37 languages /
  ~26 KB.

### `src/engine/game/build.ts`
- `languageWarnings` no longer claims "the menus stay in English" (menus no longer follow the story language): it now
  says the interface has no strings for that language. Same signature.

### `src/engine/themes/emit.ts`
- Exported WCAG helpers `mixHex`, `relativeLuminance`, `contrastRatio`, `readableOn`.
- `parseHex` accepts the `#abc` / `#abcd` shorthand (a `NaN` channel could leak into `rgb(...)` CSS).
- `renderThemeCss` appends ten theme-aware tokens — `--vno-ui-scrim`, `--vno-ui-surface`, `--vno-ui-surface-2`,
  `--vno-ui-text`, `--vno-ui-text-muted`, `--vno-ui-border`, `--vno-ui-control-bg`, `--vno-ui-control-text`,
  `--vno-ui-focus`, `--vno-page-caption-size` — computed from the palette so light and dark themes both stay readable
  (4.5:1 text, 3:1 muted/focus). Existing variables and `themePreviewCss` are untouched.

### `src/engine/game/player-runtime.ts`
- **Preferences screen**: four section cards (Display / Language / Text / Audio), new **Interface language** picker,
  **Story language** picker (the old one), **Story text size** slider (80–140 %, default 100 %), value readouts for all
  ranges, `for=` labels and `aria-describedby`, and real close buttons (`type="button"`, `aria-label="Close"`,
  decorative `×`).
- **Theme-aware styling**: every screen, close button, select, range, language chip and page-menu button now uses the
  `--vno-ui-*` tokens with fallbacks, so the cream Storybook theme gets dark text on a warm panel instead of a white
  `×` on cream and a `#222` select slab; preset widths (`min(1400px, 92%)` / `min(900px, 92%)`) and compact rows keep
  all settings visible without scrolling at 1920×1080 and 1366×768.
- **Language split**: `settings.uiLang` (default `'en'`, remembered), `uiTable()` (uiLanguages → legacy edition table →
  `{}`), `switchUiLanguage()`, `populateUiLanguageSelect()`, `getUiLanguages()`, `state.uiLang`; `switchLanguage()` is
  story-only. `data-ui-lang` is set while `lang`/`dir` keep following the story. A bundle without `uiLanguages` hides
  the interface row and keeps the previous menus-follow-the-story behaviour.
- **Picture-book layout**: the page layer is a flex column (illustration flexible, caption static with a token border
  and `max-height: 46%`, footer static), so a long caption can no longer cover the illustration or push the page
  counter off-screen. The caption (and the visual-novel dialogue) auto-fit: step-down sizing that measures the real
  box and falls back to a scrollable caption strip when even the minimum does not fit.
- **Audio balance**: defaults music 48 / SFX 80 / voice 90, a perceptual `(v/100)^1.6` gain curve, a 180 ms rAF ramp,
  and ducking of music ×0.35 and ambience ×0.7 while a voice clip plays (cleared on `ended`, `stopVoice` and a rejected
  `play()`). Stored settings from before VNO-48 are migrated once (`volMusic = min(value, 60)`, `schema = 2`), and a
  corrupt blob no longer breaks the player.
- **Esc / focus**: Esc closes an open Preferences/Save/History/About screen in both presentations (also when a
  select/input has focus) and focuses the close button; with nothing open the old behaviour stays.

### `tests/*`
- `tests/languages.test.ts`: whitelist keys exist in the Croatian table; the Croatian 49-key core prefix is unchanged.
- `tests/renpy-emit.test.ts`: the `languageWarnings` expectation follows the new wording.
- `tests/player-theme-css.test.ts` (new): tokens on cream and dark themes, contrast ratios, caption-size clamping,
  colour helpers, shorthand hex, `themePreviewCss` untouched.
- `tests/player-ui-language-data.test.ts` (new): `uiLanguages` ordering/content, whitelist-only keys, payload bound.
- `tests/renpy-template.test.ts`: the live-language test now proves the split (story switches change the story only,
  the interface picker changes the menus only, the puzzle labels follow the interface, the ending text the story); the
  picture-book test switches the counter through the interface picker; the layout assertions replace `height: 800px`
  with the flex-column contract; a new VNO-48 block covers the preferences markup/close button, the `ui('…')`-key
  invariant, the legacy `uiLanguages`-less fallback, interface-language persistence, the audio curve + ducking, the
  settings migration (and corrupt JSON), the text-size slider and Esc. The harness can now be seeded with stored
  settings and exposes that storage.

### `docs/protocol.md`, `ROADMAP.md`
- A "The web player's own preferences" section in the build chapter (interface vs story language, `uiLanguages`, audio
  balance/migration, text size) and the VNO-48 rows in the roadmap.

## Deviations from the plan
- The Croatian table gained `Save Game` / `Load Game` — the whitelist contains them and no table had them, so the
  "every whitelist key is in the Croatian table" invariant needed them. Other tables still have exactly 49 keys.
- `parseHex` shorthand support was added by the Lead after the token math produced `NaN` for `#000`/`#fff` fixtures
  (real theme files are validated to the long form).
- Two extra DOM fitter parameters (`scrollHost`, `reservePx`) and subtraction of the container's computed vertical
  padding: without them the fitter over-allows by 20–98 px and a long visual-novel line could paint outside the box.
- Lead polish after the implementer's report: compacted the preference rows/sections, raised the panel to
  `min(900px, 92%)` and centred the caption block, so all settings fit on one screen.
- The test harness gained a `seedStorage` argument and returns `storage` (needed by the migration tests).
- `ROADMAP.md`'s "next free number" note now says VNO-49.

## Verification
- Baseline before the change: 79 test files / 1087 tests passing.
- `node node_modules/vitest/vitest.mjs run` (full suite): **81 files / 1106 tests passing**, exit 0.
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json` → exit 0; `-p tsconfig.web.json` → exit 0.
- `node node_modules/eslint/bin/eslint.js .` → exit 0.
- Browser check (headless Chromium, screenshots in `.claude/temp/player-preview/`): the real generated player, cream
  Storybook-like theme, 3-page picture book with the reported Croatian page and a deliberately long page, at
  1920×1080, 1366×768 and 390×844. Confirmed: the caption no longer covers the illustration or the page counter, the
  long page shrinks instead of overflowing, the Preferences modal shows all rows with a visible close button, themed
  selects/ranges and value readouts, and switching the interface picker re-labels the menus immediately while the
  story text stays in Croatian. A `#prefs` / `#page2` / `ui-hr` hash driver in `.claude/temp/player-preview/` makes
  the states reproducible.
- Not verified: a real `buildGame` run of a project (the preview calls `buildGameData` + `generateIndexHtml/Css/Js`
  with the same theme CSS path), audible ducking on real speakers, and the RTL layout with an interface language whose
  script differs from the story (the interface table renders with per-glyph font fallback; the stage direction keeps
  following the story).

## Follow-ups / known limitations
- A separate RTL interface language over an LTR story renders its own script but does not mirror the interface; only
  the story language drives `dir`.
- The picture-book caption falls back to an internal scroll when even the 55 % shrink does not fit; the page click
  still turns the page.
- `Story text size` is a player preference, not a theme value; the theme's `sizes.text` still sets the base.

## Commit status

Committed as `be95c7b` on `VNO-48_player-preferences-and-languages` and pushed to
`origin/VNO-48_player-preferences-and-languages` (2026-10-25). No PR opened yet.
