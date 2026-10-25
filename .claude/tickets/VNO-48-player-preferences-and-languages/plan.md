# VNO-48 — Player Preferences: readable theme-aware UI, split UI/story language, captions that fit, balanced audio

Branch: `VNO-48_player-preferences-and-languages` (cut from `origin/master` at `1e73760`).

## Goal & success criteria

The generated HTML5 player (screenshots: cream "storybook" theme, picture book) must:

1. **Preferences screen is readable and looks deliberate** — the close `×` is visible on light *and* dark themes, every control (select, slider, button) reads clearly, the modal has a sectioned layout, keyboard/focus states work. Fixes hardcoded colours: `.vno-screen-close` is `#fff` (invisible on cream), `.vno-select` is `#222` (dark slab on a cream panel), `.vno-lang-select` prints theme-dark text on a dark chip (the barely visible globe label).
2. **Menus and story have separate languages** — Preferences gets **Interface language** (menus/labels; every built-in language that has menu strings, ~36) and **Story language** (the book's editions, unchanged). Changing the story language no longer changes the menus; changing the UI language re-labels every open screen. First-run UI language: **English** (user decision), remembered after that.
3. **Page captions fit the page** — the picture-book caption no longer overflows its 280 px strip and covers the illustration/footer. The image gets the leftover space, the caption auto-shrinks to fit, and a **Story text size** slider (80–140 %, default 100 %) lets the reader pick a size; the same setting applies to visual-novel dialogue with the same auto-shrink safeguard.
4. **Audio is balanced** — music no longer drowns the voice: lower music default, perceptual gain curve, and music/ambience duck while a voice clip plays, then restore. Existing players' stored settings are migrated once.

Acceptance: a built picture book at a 3-line Croatian page shows picture + caption + footer with no overlap; Preferences on the storybook theme shows a visible close button, a light-on-cream interface-language select with readable option text, and value readouts; switching Story to Croatian keeps the menus in English until Interface language is set to Croatian; playing a voiced page audibly lowers the music; tests, typecheck and lint green.

## Decisions already fixed (user answers)

| Choice | Decision |
|---|---|
| UI language list | Every registered language with a non-empty UI table + English (no table = English literals) |
| First-run UI language | English unless the player changes it (persisted) |
| Audio | Music default 48, voice 90, SFX 80; gain = `(v/100)^1.6`; duck music ×0.35, ambience ×0.7 while voice plays |
| Text size | Slider 80–140 % step 10, default 100, applies to caption + VN dialogue, auto-shrink still wins on overflow |
| Back-compat | Old `game-data.json` without `uiLanguages` keeps today's behaviour (menus follow story language; UI-language select hidden) |

---

## 1. Shared data & strings

**`src/shared/ui-strings.ts`**
- Add `export const PLAYER_UI_KEYS` — the explicit whitelist of keys the player calls `ui()` with today: `Start, Load, Save, Save Game, Load Game, Preferences, Prefs, About, Back, History, Skip, Auto, Q.Save, Q.Load, Menu, Main Menu, Start again, The End, Display, Fullscreen, Language, Text Speed, Auto-Forward Time, Music Volume, Sound Volume, Voice Volume, Page {}, Page {} of {}, Next, Previous, Read aloud, Clues, Accuse, Submit, Hint, Give Up, empty slot, The dialogue history is empty.` **plus new keys** `Close, Interface Language, Story Language, Story Text Size`.
- Add Croatian entries only (the table may grow past the 49 core keys; other tables stay at 49 and fall back to English): `Close: 'Zatvori'`, `Interface Language: 'Jezik sučelja'`, `Story Language: 'Jezik priče'`, `Story Text Size: 'Veličina teksta priče'`. Do **not** touch the other 35 tables; `config/languages.md` `ui` can override.

**`src/engine/game/emit.ts`**
- New `export interface GameDataUiLanguage { code: string; name: string; nativeName: string; ui: Record<string, string> }`.
- `GameData` gains optional `uiLanguages?: GameDataUiLanguage[]`.
- In `buildGameData`: `uiLanguages` = English (`ui: {}`) **plus** every `languages()` entry with a non-empty `ui` table, each filtered to `PLAYER_UI_KEYS`, sorted English-first then by `name`. `editions[lang].ui` untouched (legacy path).

**`src/engine/game/build.ts`**
- `languageWarnings` no longer implies menus follow the story language — one warning only when the **primary** language has no UI table; must not fire for editions.

**Invariants/tests**
- `tests/languages.test.ts`: every `PLAYER_UI_KEYS` entry exists in `UI_STRINGS.hr`; hr core-49 prefix unchanged.
- Assert every `ui('…')` literal in `generatePlayerJs()` is in `PLAYER_UI_KEYS`.
- Bound the payload: `JSON.stringify(buildGameData(...).uiLanguages).length` under ~120 KB.

## 2. Theme-aware UI tokens

**`src/engine/themes/emit.ts`**
- Colour helpers (exported for tests): `mixHex(a, b, t)`, relative `luminance`, `contrastRatio`, `readableOn(bgCss, preferred)`.
- `renderThemeCss` emits: `--vno-ui-scrim` (black 0.72 light / 0.85 dark), `--vno-ui-surface` (bg mixed 6 % toward text), `--vno-ui-surface-2` (10 %), `--vno-ui-text`, `--vno-ui-text-muted` (≥3:1), `--vno-ui-border` (28 %), `--vno-ui-control-bg`, `--vno-ui-control-text`, `--vno-ui-focus`, `--vno-page-caption-size: <px>` = `clamp(40, theme.sizes.text * 1.6, 56)`.
- Unit test: cream/storybook theme → dark `--vno-ui-text` on `--vno-ui-surface`, contrast ≥ 4.5; classic-dark → near-white; all tokens present; `themePreviewCss` unchanged.

## 3. Player runtime (`src/engine/game/player-runtime.ts` — single owner)

Template literal: no backticks/`${` inside generated code.

### 3a. Preferences HTML (keep existing ids, add new)
Sections Display / Language / Text / Audio. `#vno-pref-ui-language` (new), `#vno-pref-language` (story, existing), `#vno-pref-story-text-size` + `#vno-pref-story-text-size-value` (new), existing text-speed/auto-delay/volume ranges with `output` readouts. Close buttons: `<button type="button" class="vno-screen-close" aria-label="Close"><span aria-hidden="true">×</span></button>` on History/Save/Prefs/About. Labels get `for=`; close buttons get `aria-label`.

### 3b. CSS
- Scrim/panel via tokens: `width: min(1400px, 92%); height: min(850px, 88%)`, `--vno-ui-surface`, `--vno-ui-text`, `--vno-ui-border`.
- `.vno-screen-close`: ≥52 px target, `--vno-ui-text`, `--vno-ui-surface-2` hover, border, radius, focus ring `--vno-ui-focus`; no literal `#fff`.
- `.vno-prefs-body` scrolls; `.vno-pref-section` cards; rows label + 520 px control column; `.vno-select` themed with custom chevron, themed `option`s, ellipsis; ranges with accent thumb/focus; value readouts muted, tabular.
- `.vno-lang-bar`, `.vno-page-menu` use the same tokens; globe bar hidden when fewer than two story languages.
- Fallbacks (`var(--vno-ui-surface, rgba(0,0,0,.55))`) for old theme CSS.

### 3c. Picture-book layout
- `.vno-page-layer` flex column; image area `flex: 1 1 auto; min-height: 0` (no `height: 800px`); caption area static, `flex: 0 0 auto; max-height: 46%`, border-top; footer static row at the bottom of the caption area.

### 3d. JS
- Settings `{ …, volMusic: 48, storyTextSize: 100, uiLang: 'en', schema: 2 }`; migration: missing `schema` → `volMusic = min(volMusic, 60)`, set `schema`, persist; unknown `uiLang` → `'en'`.
- `uiTable()` from `uiLanguages[uiLang]`, else legacy `currentEdition.ui`, else `{}`; `updateUiStrings()` re-labels menus/modals/prefs/page footer/close aria-labels.
- `switchLanguage` = story only; `switchUiLanguage` = settings + save + relabel + `refreshActiveScreens`; `documentElement` keeps story `lang`/`dir`, gains `data-ui-lang`.
- `populateUiLanguageSelect` (native names, English first); hide UI row when `uiLanguages` missing.
- `applyTextScale()` sets `--vno-story-text-scale`; `.vno-dialogue-text` uses the var.
- `fitTextBlock(el, container, basePx, minPx)` step-down, guarded for missing layout (test harness no-op); used by `renderPageCaption` and `startTypewriter`/`completeTypewriter` (full HTML, fit, then type); min size overflow → caption area scrolls.
- Audio: `channelGain`, `voiceActive` flag on voice start, cleared on stop/ended/pause/rejection; music ×0.35, ambience ×0.7 while active; rAF ramp when available, instant otherwise.
- Esc closes any open screen first in both presentations.
- `bindRange` value readouts.
- `VNOEngine`: `switchLanguage` = story, add `switchUiLanguage`, `getUiLanguages()`, `getState().uiLang`.

## 4. Tests (`tests/renpy-template.test.ts` harness)

1. Language split: primary `de` book with `de/en/hr`; menus stay 'Start' after story switch to hr; UI switch to hr → 'Započni'/'Postavke'; state `lang`/`uiLang` independent.
2. Legacy data (strip `uiLanguages`): menus follow story, UI row hidden.
3. Picture book: counter 'Page 1 of 3' with English UI, 'Stranica 1 od 3' after UI switch; layout assertions; fitter called.
4. Audio: defaults music < voice after curve; duck ×0.35 while a clip plays, restore after `stopVoice`; migration `{volMusic: 80}` → ≤60 + `schema: 2`; corrupt JSON ignored.
5. Theme/close button: tokens present, no `#fff` for close; contrast test.
6. Adapt existing assertions hit by the change (`height: 800px` removed; rtl lang bar kept).
7. Extract harness to `tests/player-harness.ts` only if the file passes ~1200 lines.

## 5. Docs & ticket artifacts
- `docs/protocol.md` build section: UI vs story language, optional `uiLanguages`, audio balance.
- `ROADMAP.md` VNO-48 row on completion.
- `.claude/tickets/VNO-48-player-preferences-and-languages/plan.md` (this file) + `changelog.md`.
- Scratch under `.claude/temp/`.

## 6. Work split (advisory scopes)

| Slice | Files (owner) | Depends on |
|---|---|---|
| A. Shared strings + data model + theme tokens | `src/shared/ui-strings.ts`, `src/engine/game/emit.ts`, `src/engine/game/build.ts`, `src/engine/themes/emit.ts`, `tests/languages.test.ts`, theme token test | — |
| B. Player runtime (HTML/CSS/JS) | `src/engine/game/player-runtime.ts` **one owner** | A contracts |
| C. Player tests + preview + docs | `tests/renpy-template.test.ts`, `.claude/temp/player-preview/`, `docs/protocol.md`, `ROADMAP.md` | B |
| D. Changelog, final gates | `.claude/tickets/.../changelog.md` | B + C |

Lead reviews the diff and runs the gates.

## 7. Verification
1. `node node_modules/vitest/vitest.mjs run`, both `tsc --noEmit` projects, `node node_modules/eslint/bin/eslint.js .` (yarn is not on PATH in this shell).
2. Self-contained preview (`renderPlayerRuntime()` + `renderThemeCss()` + data-URI picture) at `.claude/temp/player-preview/preview.html`, opened via `artifact_open`: menu → Preferences → text size 140 % → long caption → UI Croatian.
3. Screenshots at 1920×1080, 1366×768, 390×844: no caption overlap, close button contrast, readable selects, prefs scrolls, music ducks.
4. Real build path writes the new tokens into `player.css` (theme CSS comes from `build.ts`).

## 8. Out of scope
- No Electron/renderer UI localisation; studio UI stays English.
- No audio loudness normalisation at generation time.
- No new protocol commands; `uiLanguages` optional and additive.
- No Ren'Py `tl` additions beyond `UI_STRINGS.hr`.

## 9. Assumptions
- A UI language whose script differs from the story renders via per-glyph font fallback; stage direction/typography keeps following the story.
- "Story text size" is a player preference, not a theme value; the theme's `sizes.text` still sets the base.
- `×` is decorative; the accessible name is the localised "Close".
- Commit on the branch; push/PR only when asked.

## Progress (implemented 2026-10-25)

All sections 1–6 are implemented on `VNO-48_player-preferences-and-languages`. Section 4's test plan is covered by
`tests/renpy-template.test.ts` (updated live-language and picture-book tests + a new `VNO-48: interface language,
readable preferences and audio balance` block), `tests/player-theme-css.test.ts` and `tests/player-ui-language-data.test.ts`;
`tests/languages.test.ts` and `tests/renpy-emit.test.ts` were adjusted. The harness gained an optional stored-settings
seed and exposes its storage for the migration tests.

Verification evidence:
- Full suite `node node_modules/vitest/vitest.mjs run`: **81 files / 1106 tests pass** (baseline was 79 / 1087).
- `tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json`: exit 0. `eslint .`: exit 0.
- Preview + headless screenshots at 1920×1080, 1366×768, 390×844 (`.claude/temp/player-preview/`): caption fits without
  covering the illustration or the counter, long page shrinks, Preferences shows all rows with a visible close button,
  themed selects/ranges/readouts, and the interface picker relabels the menus while the story stays Croatian.

Deviations are recorded in `changelog.md`: `Save Game`/`Load Game` added to the Croatian table, `parseHex` shorthand
support, two extra optional fitter parameters plus padding subtraction, Lead CSS polish (panel `min(900px, 92%)`,
compact rows, centred caption), harness seeding, and the roadmap's "next free number" note moved to VNO-49.
Not verified: a real `buildGame` of a project, audible ducking on speakers, RTL interface over an LTR story.
