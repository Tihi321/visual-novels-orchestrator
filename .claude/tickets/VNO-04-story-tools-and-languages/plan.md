# VNO-04: Story tools over MCP, any edition language, and the small MCP gaps

Status: **implemented, uncommitted** (2026-10-20). See [`changelog.md`](changelog.md).
Ticket folder: `.claude/tickets/VNO-04-story-tools-and-languages/`. Branch: `VNO-04_story-tools-languages`, cut from `origin/master` (c752332, VNO-03 merged).
Repos changed: `visual-novels-orchestrator`; afterwards docs only in `creative-hub` (`ROADMAP.md`, `.claude/skills/make-visual-novel/SKILL.md`). Do not commit or push (the user has not asked).

## Goal

An agent can make and edit a visual novel through VN Studio's MCP server alone (no Scriptorium folder), and editions can be in any of the VibeTTS Supertonic / Book Translator languages, not only `en` and `hr`.

Done when:
- `yarn typecheck`, `yarn lint`, `yarn test` pass (run through `fnm exec --using=24 cmd /c "yarn ..."`; node is not on PATH).
- The new tools are documented in `docs/mcp-guide.md`.
- A project made only through the new tools builds with `vno_build` and passes `vno_lint` against the real engine (`pwsh -File C:\projects\Personal\creative-hub\scripts\hub.ps1 build vn-studio`, then `start vn-studio`, then `hub.ps1 call vn-studio <tool> '<json>'`).
- `creative-hub/ROADMAP.md` and the make-visual-novel skill's option B are updated.

## Progress checklist
- [x] L. Languages (implementer 1). Done: typecheck, lint clean; 45 files / 538 tests pass (with S1/S2 tests present). Deviations: `svc.knownLang(code)` added (loads config/languages.md then assertKnownLang) for S1 createProject; `writeUiStrings(sub, code)` returns whether a UI table exists; the renderer lists only the built-in languages (config/languages.md is read by the engine only); ImportDialog uses a select instead of radios; detection weights shared stop words and marker letters by 1/n^2 (n = languages sharing them) so Croatian keeps confidence > 0.5.
- [x] S1. Story tools (implementer 2)
  - Done: typecheck and lint clean, tests/vn-story.test.ts 21 tests pass. Deviations: a choice-book chapter without choices ends the game (matches `renpy/emit.ts`; text defaults to `The End`), not a jump to the next chapter; `editStory` also returns `keptByHand` (assets with `promptByHand`) and prunes `cues.json`/`music.json` entries of removed scenes, beats and chapters; language is checked with `svc.knownLang` (`assertKnownLang`).
- [x] S2. Plan, music, cues and library tools (implementer 3)
  - Done: tests/vn-plan-tools.test.ts 9 tests pass. Deviations: `fillCues` (stage.ts) added for the stage step; `chapters` of `vno_set_cues`/`vno_set_music` map a chapter number to a track id or null (cues store `{music}`; music null drops the entry); `scenes.transition` optional when merging; `setScriptoriumData` stores `~` paths as typed, others absolute; the engine also passes the option to `McpController`. A fresh music plan made by `vno_set_music` has no `menu` key until given.
- [x] Orchestrator: wiring in `tools.ts` and stubs (baseline before: typecheck, lint clean; 42 files / 455 tests pass)
- [x] Orchestrator: `docs/mcp-guide.md`, README, server instructions, full checks, live end-to-end run, creative-hub docs, changelog. Added beyond the plan: `vno_edition_set` (write another language as JSON; a JSON-made project otherwise had no way to get an edition) with `svc.setEdition` and a test.

## Ownership (three implementers run at the same time)

- **L owns:** `src/shared/languages.ts` (new), the language parts of `src/shared/vn.ts` (`LANGS`, `langSchema`, `Lang`, `legacyVoices`, `voice.voices`), `src/engine/vn/lang.ts`, `src/engine/vn/languages-config.ts` (new), `seed/config/languages.md` (new), `src/engine/renpy/tl.ts`, `src/engine/renpy/build.ts`, `src/engine/vn/project.ts` (`editionLangs`), `src/engine/voice/**`, `src/engine/vncli.ts` (the `--lang` parsing and `voice set` check), `src/renderer/**`, `docs/protocol.md` (language mentions), tests `vn-lang-expr`, `renpy-emit`, `renpy-tl`, new `tests/languages.test.ts`.
- **S1 owns:** `src/engine/vn/story.ts` (new), `src/engine/mcp/tools-story.ts` (new), new `tests/vn-story.test.ts`.
- **S2 owns:** `src/engine/mcp/tools-plan.ts` (new), `src/engine/vn/handlers.ts`, `src/engine/renpy/stage.ts`, `src/engine/vn/agents/composer.ts`, `src/engine/mcp/controller.ts`, `src/engine/mcp/stdio.ts`, new `tests/vn-plan-tools.test.ts`.
- **Shared, Edit-only (never Write the whole file), each touching only its own lines/methods:** `src/engine/vn/service.ts` (L: `addEdition`, language loading; S1: `createProject`, `editStory`, `getStory`; S2: `setAssetPlan`, `setMusicPlan`, `setCues`), `src/shared/vn.ts` (L: language parts; S2: one optional field on `assetEntrySchema`), `src/engine/engine.ts` (L: load `config/languages.md` at start; S2: `setScriptoriumData`), `src/engine/mcp/tools.ts` (the orchestrator has already wired it; S1/S2 do not edit it).
- **Orchestrator:** `src/engine/mcp/tools.ts` wiring (done before the implementers start), `docs/mcp-guide.md`, `README.md`, ticket files, the live run, creative-hub docs.

Contracts between slices (all already true today, so the slices can work in parallel):
- `langSchema` stays exported from `src/shared/vn.ts`, `Lang` stays the inferred type. L widens it from `z.enum(['en','hr'])` to a code string; S1/S2 only use `langSchema`/`Lang`.
- `detectLanguage(text): { lang: Lang; confidence: number; ... }` keeps its name and the `lang` and `confidence` fields.
- `buildEdition(lang, title, chapters, characters)` in `src/engine/vn/import.ts` and `textSample(chapters)` stay as they are.
- `tools.ts` spreads `storyTools(svc, def)` from `./tools-story` and `planTools(svc, def, opts)` from `./tools-plan`. `def` and `ToolDef` are exported from `tools.ts`. Stubs of `tools-story.ts`, `tools-plan.ts` and `src/shared/languages.ts` exist (the orchestrator made them; S1, S2 and L replace them).
- `tools.ts` already calls `svc.addEdition(slug, source, lang?)` and reads `{ job, lang, detected }` from it (`detected`: `{ lang, confidence }` or null when `lang` was given). L changes `addEdition` to that shape; `service.handle` (`addEdition` command) just awaits it.
- `tools.ts` already has `vno_languages`, reading `languages()` and the `LanguageInfo` fields `code, name, native, renpy, rtl, script, supertonic, ui` from `src/shared/languages.ts`.

## L. Languages

**Table (`src/shared/languages.ts`, new).**
- `interface LanguageInfo { code; name (English); native; renpy (a Ren'Py language identifier, lowercase ascii + `_`); rtl?: boolean; script: 'latin'|'cyrillic'|'greek'|'arabic'|'hebrew'|'devanagari'|'han'|'kana'|'hangul'|'thai'|'other'; supertonic?: boolean (VibeTTS Supertonic reads it); ui?: Record<string,string> (template UI strings) }`.
- `BUILTIN_LANGUAGES`: the union of the 31 Supertonic codes (`vibe-tts-flow/vibetts/config.py` `SUPERTONIC_LANGUAGE_NAMES`: en ko ja ar bg cs da de el es et fi fr hi hr hu id it lt lv nl pl pt ro ru sk sl sv tr uk vi) and Book Translator's 32 (`book-translator/seed/config/defaults.json`: adds sr bs no he fa zh; ar/he/fa are rtl) = 37 languages. Ren'Py names are the lowercase English names (`english`, `croatian`, `german`, `chinese`, ...). Native names: English, Hrvatski, Deutsch, Français, 日本語, 한국어, 中文, العربية, עברית, فارسی, हिन्दी, Русский, Українська, Български, Српски, Ελληνικά, Tiếng Việt, ... The Croatian UI table (today `UI_STRINGS.hr` in `tl.ts`) moves to `hr.ui`.
- A registry: `languages()`, `languageInfo(code)`, `isKnownLang(code)`, `assertKnownLang(code): Lang` (the error names the known codes and `config/languages.md`), `registerLanguages(list)` (adds or overrides by code; fills `renpy` from the English name and `script` = `other` when left out), `LEGACY_LANGS = ['en','hr']`.
- `src/shared/vn.ts`: `LANGS` becomes the code list of the built-in table (keep the export name for the CLI/UI). `langSchema = z.string().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/, ...)` (format only; known-ness is checked where a language enters the project). `legacyVoices` maps a Supertonic id to `LEGACY_LANGS` only. `voice.voices` is `z.record(z.string(), z.record(langSchema, z.string()))`.

**Configurable (`config/languages.md`).** New seed file `seed/config/languages.md` (frontmatter `kind: languages`, `languages: []`, body explains the fields and gives an example adding `pt-br` and a `ui` table). `src/engine/vn/languages-config.ts`: `loadLanguageConfig(dataDir)` reads it (bad file: log and use the built-in table) and calls `registerLanguages`. Called by the engine at start (`engine.ts`) and by `VnService` before it validates a language (import, add edition, create project). New seed files are copied into data folders that lack them (check `seedRefresh.ts`; add nothing to `SEED_HISTORY`).

**Detection (`src/engine/vn/lang.ts`).** `detectLanguage(text)` over the whole table:
- Script first (counts per Unicode script): Han + kana → `ja`; Han → `zh`; Hangul → `ko`; Hebrew → `he`; Devanagari → `hi`; Greek → `el`; Arabic → `ar` or `fa` (Persian letters پ چ ژ گ ی and words است این که را); Cyrillic → `uk` (і ї є ґ), `sr` (ђ ћ џ љ њ ј), `bg` (ъ, no ы э), else `ru`, with stop words as a tie-break.
- Latin: stop-word lists (about 20 distinctive function words each) plus diacritic signatures for en de fr es it pt nl pl cs sk sl hr bs sr hu ro sv da no fi et lt lv tr id vi. Croatian, Bosnian and Serbian Latin score as one group and return `hr` unless Serbian/Bosnian markers win (ekavian `mleko`, `dete`, `lepo`, `reč`, `vreme`; `ko` for `tko`, `hiljada`); ties go to `hr`.
- Result: `{ lang, confidence, scores: Record<string, number>, words, script }`. Confidence = (best - second) / (best + second) × min(1, words/25), rounded to 3 decimals; 0 for empty text. Only languages in the registry can win.
- The existing tests (English, Croatian, Croatian by diacritics, empty/tiny text) keep passing. New tests: one or two sentences per built-in language detect as that language (the hr/bs/sr group: a Croatian sample is `hr`).

**Ren'Py (`tl.ts`, `build.ts`).**
- `RENPY_LANG`, `LANG_NAMES`, `UI_STRINGS` become lookups: `renpyLanguage(code)`, `nativeName(code)`, `uiStrings(code)` (from the registry). Keep the old names as small functions or remove them and update the callers and tests.
- `languageTable(primary, langs)`: an English primary is `None`; any other primary is its Ren'Py language and the default language (today only `croatian`). Every other edition is `(renpyName, native)`.
- `writeUiStrings(sub, code)`: writes `tl/<renpy>/ui.rpy` for a non-English primary. With a UI table, as today. Without one, write a strings block with one identity entry (`old "Language"` / `new "Language"`) so Ren'Py knows the language (otherwise the `Language()` button of the primary is insensitive), and add the build warning `the menus of <name> stay in English (no UI strings for <code>; add them in config/languages.md)`. Editions without a UI table get the same warning.
- RTL: when the primary or any edition is rtl, write `define config.rtl = True` (in a generated `game/vno_languages.rpy`, or the options template if it has a fitting place) and warn that the layout is not mirrored.
- Fonts: when a language's script is han, kana, hangul, devanagari or thai, warn `the game font (DejaVuSans) has no <script> glyphs: <name> text shows as boxes`.
- The `build.ts` `book.primaryLang === 'hr'` special case goes through the general path.

**Elsewhere.**
- `project.ts editionLangs`: files matching the new code regex (`editions/<code>.json`), not only two letters.
- `voice/jobs.ts`: `SAMPLE` keeps en/hr; for another language the sample is a line of the speaker in that edition, else any line of that edition, else its title. `voice/catalog.ts` already uses the VibeTTS language lists.
- `service.ts addEdition(slug, source, lang?)`: `lang` optional; without it the language of the translated folder is detected (`importBook(folder).detected`), and the result says which. Validate with `assertKnownLang`. `importProject` validates an explicit `lang`.
- `vncli.ts`: `--lang` and `voice set` accept any known code (error lists them).
- Renderer: `EditionsTab` offers every known language (native name and code); `store/vn.ts` types use `Record<string, ...>`; `lib/voice.ts` stays as is unless the types need it.
- `docs/protocol.md`: where it says en/hr, say a language code (see `config/languages.md`).

## S1. Story tools

**Core (`src/engine/vn/story.ts`, pure, no I/O).**
- `storyInputSchema` (zod) for a whole book, lenient so an agent can write it by hand:
  `{ title, slug?, author?, genre?, format?, kind?, lang?, style?, coverBrief?, characters: [{ key?, name, looks?, voice? }], places: [{ key?, name, looks? }], chapters: [{ n?, title, summary?, choices?: [{ text, to }], ending?: string|null, scenes: [{ place (a place key or name, or free text), time?, description?, breakBefore?, beats: BeatInput[] }] }] }`.
- `BeatInput` = `{ type: 'cast', cast: (string | { charKey|key, look? })[] }` | `{ type: 'line', speaker (key or name), expression?, text }` | `{ type: 'narration', text }`; the `type` may be left out (`cast` present → cast; `speaker` present → line; else narration).
- Keys: `slugKey(name)` from `vn/ids.ts` when `key` is left out; keys must be unique and Ren'Py-safe (`/^[a-z][a-z0-9_]*$/`).
- Ids: chapter `n` defaults to its position (1-based); scene ids `sceneId(n, i)`, beat ids `beatId(sceneId, i)`; `backgroundId(placeKey, placeText, time)` from `vn/ids.ts`. Place matching: a key, else a name (case- and diacritic-insensitive via `normText`), else `placeKey: null` with the text kept (a warning).
- Speakers: a character key or name → `speakerKey`, `speakerLabel` = the character's name; an unknown speaker → `speakerKey: null`, label as written (a warning). Expression: `mapExpression` from `vn/expressions.ts` (free-form kept in `rawExpression`), default `neutral`.
- `kind`: `choice` when any chapter has choices, else `linear` (an explicit `kind` must agree, else an error). `format` default: `choice-visual-novel` for choice, `visual-novel` for linear. A chapter with choices has `ending: null`; a chapter without choices and without `ending` in a choice book continues to the next chapter (check how `renpy/emit.ts` treats such a chapter and match it).
- `buildBook(input, { slug, lang }): { book: VnBook; warnings: string[] }`.
- `validateBook(book): { errors: string[]; warnings: string[] }`: unique chapter numbers, scene ids, beat ids, character and place keys; every speaker/cast key and place key exists; every choice `to` is an existing chapter; a chapter is not both an ending and a choice; warns about chapters no choice reaches (other than the first), scenes with no beats, a choice book with no ending. Errors stop an edit (nothing is saved); warnings are stored in `book.warnings`.
- `applyStoryOps(book, ops): { book; changed: Set<'characters'|'places'|...>; affected: { chars: string[]; places: string[]; backgrounds: string[]; cover: boolean }; created: string[] }` for the op union (zod `storyOpSchema`, discriminated on `op`):
  - `book.update` { title?, author?, genre?, style?, coverBrief?, format? }
  - `character.set` { key?, name?, looks?, voice? } (upsert: by key, else a new character from the name); `character.remove` { key, force? } (in use → error unless force, which also removes its cast entries and turns its lines into speakerKey null)
  - `place.set` { key?, name?, looks? }; `place.remove` { key, force? } (in use → error unless force: scenes keep the text, placeKey null)
  - `chapter.add` { chapter (chapter input), n?, after? } (n default max+1); `chapter.update` { n, title?, summary?, ending?, choices? }; `chapter.remove` { n } (any choice still pointing at it → error)
  - `scene.add` { chapter: n, scene (scene input), at? (index; default end) }; `scene.update` { sceneId, place?, time?, description?, breakBefore? } (the background id follows the place and time); `scene.remove` { sceneId }
  - `beat.add` { sceneId, beats: BeatInput[], at? | after? (beat id) }; `beat.update` { beatId, text?, speaker?, expression?, cast? }; `beat.remove` { beatIds }
  - Ids are stable: a new scene gets the next free `sNN` of its chapter, a new beat the next free `bNNN` of its scene, whatever its position. Existing ids never change (editions, voice clips and translations are keyed by them).
- `storyAffects(before, after)`: which unlocked assets lose their prompt (see the service).

**Service (`service.ts`, new methods, Edit-only).**
- `createProject(input, opts: { lang?, settings?: ProjectSettingsPatch }) → { slug, warnings, assets }`: slug from `projectSlug(input.slug ?? input.title)`, a `-2`, `-3` ... suffix when taken. Language: `opts.lang ?? input.lang ?? detectLanguage(textSample(chapters)).lang`, validated (`assertKnownLang` once L lands; until then `langSchema`). Writes `project.md` (`source: ''`, `primaryLang`, `editions: [lang]`), `vn.json`, `editions/<lang>.json` (`buildEdition`), `uncertain.json` `[]`, `import.json` `{ at, source: 'mcp', created: true }`; applies `opts.settings` through `updateSettings`; then `reconcileAssets`. Emits like `importProject`.
- `editStory(slug, ops) → { book summary, warnings, created ids, assets: { added, orphaned, cleared, stale, keptLocked } }` under the project lock: load, apply, validate (errors throw), save `vn.json`; rebuild the primary edition from the book (`buildEdition`); in the other editions drop the keys of removed beats/chapters/choices and add new character names from the primary; then `reconcileAssets`. Assets of changed characters (sheet + sprites), places/scenes (their backgrounds) and the cover (title/coverBrief): unlocked, generated, no versions → `prompt` cleared (the art step plans them again); with versions → listed as `stale` (regenerate with `vno_asset_regen`); locked or custom → untouched, listed in `keptLocked`.
- `getStory(slug, chapter?)`: the book, or one chapter.
- The import pipeline step (`TASKS.import` in `handlers.ts`, owned by S2) and `runPipeline` must not try to import a created project (`source === ''`): S2 adds that guard; S1 must use exactly `source: ''`.

**Tools (`src/engine/mcp/tools-story.ts`, new).** `export function storyTools(svc, def): Tool[]`:
- `vno_create_project` { book: storyInput, lang?, settings? (theme, art, music, voice as in `vno_update_settings`), run? (start the pipeline from analyse) } → slug, warnings, asset counts.
- `vno_get_story` { slug, chapter? }.
- `vno_story_edit` { slug, ops: storyOp[] } (atomic batch).
- One tool per op family, each a thin wrapper of `editStory` with one op: `vno_book_update`, `vno_character_set`, `vno_character_remove`, `vno_place_set`, `vno_place_remove`, `vno_chapter_add`, `vno_chapter_update` (title, summary, ending, choices), `vno_chapter_remove`, `vno_scene_add`, `vno_scene_update` (place/background, time, description, break), `vno_scene_remove`, `vno_beat_add`, `vno_beat_update` (text, speaker, expression, cast), `vno_beat_remove`.
- Descriptions say what each does in one or two sentences, name the id formats (`ch01.s02`, `ch01.s02.b003`), and that a build is needed to see it.

**Tests (`tests/vn-story.test.ts`).** `buildBook` (keys, ids, place and speaker matching, expressions, kind and format, choices), `validateBook` errors, each op (stable ids, insert positions, background id following place/time, remove guards and force), the service through `makeVnEnv({ sdk: false })`: create → `reconcileAssets` gives backgrounds/sheets/sprites/cover/music; edit looks → prompt cleared for an unplanned sheet, locked asset kept; primary edition follows edits; other edition pruned; `vno_build` (TASKS.build through `enqueueBuild` + `waitIdle`) writes the game without the SDK. The MCP tools through `callTool(buildTools(svc), ...)`.

## S2. Plan, music, cues and the library path

**Asset prompts without generating.**
- `assetEntrySchema` gets `promptByHand: z.boolean().optional()` ("the prompt was set with vno_asset_set: the art-director and composer keep it").
- `service.setAssetPlan(slug, id, { prompt?, negative?, size?: {w,h} | null, engine?, seed?: number | null })`: updates the entry (no job), sets `promptByHand` when `prompt` is given (an empty prompt clears it and the flag); a locked asset is refused (unlock first); emits the asset.
- `handlers.ts` art plan and music plan: skip assets with `promptByHand` even with `force`.
- `vno_asset_set` { slug, id, prompt?, negative?, size?, engine?, seed? } → the asset.
- `vno_plan` { slug, refreshPrompts?, wait } → enqueues `TASKS.artPlan` then `TASKS.musicPlan` like the CLI `plan` command (`vncli.ts` ~L288); nothing else runs. Returns the jobs and, when waited, the assets with their prompts.

**music.json.**
- `MusicPlan` (`composer.ts`) gets `byHand?: boolean`.
- `service.setMusicPlan(slug, { menu?, chapters?: Record<n, trackId|null>, seconds?: Record<trackId, number>, replace? })`: merges into `music.json` (or a fresh plan) and sets `byHand: true`; validates track ids against the project's music assets (`music_01` ...) and chapter numbers against the book; seconds clamped to `MIN_SECONDS..MAX_SECONDS`.
- The music plan step: when `music.json` has `byHand`, keep its `menu`, `chapters` and `seconds` (fill only chapters it lacks); the composer still writes prompts/chip plans for tracks that need them.
- `vno_set_music` { slug, menu?, chapters?, seconds?, replace? } → the plan (call it with only `slug` to read the plan).

**cues.json.**
- `StageCues` (`stage.ts`) gets `byHand?: boolean`.
- `service.setCues(slug, { menuMusic?, chapters?, scenes?, casts?, replace? })`: merges into `cues.json` (or into `defaultCues(book, { musicIds })` when there is none) and sets `byHand: true`. Validates: music ids are music assets, scene ids and cast beat ids exist, every key of a cast map is in that cast beat, slots are left/center/right, transitions dissolve/fade/none, pause ≥ 0.
- The stage step: with `byHand`, do not call the stage-director; keep the cues and add default cues only for chapters, scenes and casts they lack (new ones after story edits); the result message says so. The build already reads `cues.json`.
- `vno_set_cues` { slug, menuMusic?, chapters?, scenes?, casts?, replace? } → the cues (only `slug` reads them).

**Created projects.** `TASKS.import` and `runPipeline`: a project whose `source` is `''` was made over MCP; the import step returns "made over MCP: nothing to import" instead of failing, and `runPipeline` never defaults to `import` for it.

**Library path.**
- `engine.ts`: `setScriptoriumData(path): Promise<string>` that writes `scriptoriumData` to `config/settings.md` through the same code as the settings command (~L620-648; refactor that write into a method both use) and returns the resolved folder; a missing folder is an error.
- `McpOptions` (in `tools.ts`, already added by the orchestrator) has `setScriptoriumData?: (p: string) => Promise<string>`; `controller.ts` and `stdio.ts` pass `engine.setScriptoriumData`.
- `vno_set_library` { path } → `{ scriptoriumData, books }` (the books found there). Unavailable without the option (like the queue switches).

**Tests (`tests/vn-plan-tools.test.ts`).** `vno_asset_set` (prompt kept by a forced art plan, locked refused, size used), `vno_plan` (prompts written, no generate job), `vno_set_music` (validation, kept by the music step), `vno_set_cues` (validation, kept by the stage step, defaults added for a new scene), the import guard, `vno_set_library` with a fake option and through the engine.

## Orchestrator steps
1. Before the implementers: `tools.ts` exports `def`/`ToolDef`, `McpOptions.setScriptoriumData`, spreads `storyTools` and `planTools` from stub files; `lang` uses `langSchema`; `vno_add_edition` `lang` optional; new `vno_languages` tool (uses `languages()` once L lands; until then a stub).
2. After them: `docs/mcp-guide.md` (workflow "make a VN without a book", tool table, languages), `README.md` mentions, full `yarn typecheck`, `yarn lint`, `yarn test`.
3. Live: `hub.ps1 build vn-studio`, `start vn-studio`; `vno_create_project` with a small choice book (2 characters, 2 places, 3 chapters, 2 endings, a German or Croatian primary), a few `vno_story_edit` ops, `vno_asset_set`, `vno_set_music`, `vno_set_cues`, `vno_build`, `vno_lint`. Assets may stay placeholders (no ComfyUI needed); record what ran.
4. creative-hub `ROADMAP.md` (mark the VN Studio items done) and the skill's option B; `changelog.md` in this folder.

## Verification record
- `yarn typecheck`, `yarn lint`: clean. `yarn test`: 45 files / 539 tests pass (baseline 42 / 455).
- `hub.ps1 build vn-studio`: ran (rebuilds `out/engine`).
- Live, against the built engine on an isolated data folder and port (`node out/engine/index.js --mcp-only --port 7469 --data .claude/temp/vno04-e2e/data`, Ren'Py SDK 8.5.3), tools called over MCP HTTP: `vno_create_project` (German choice book, 3 chapters, 2 endings), `vno_story_edit` (new character, beats inserted with ids b005/b006, expression, scene time → new background id, looks change, chapter title), `vno_get_story`, `vno_asset_set` (cover prompt kept by `vno_plan`), `vno_plan` (real LM Studio model), a looks edit after planning (7 prompts cleared, locked `sheet_mara` kept), `vno_set_music`, `vno_set_cues` (fade + slots appear in `ch02.rpy`), `vno_build` ok, `vno_lint` ok; `vno_edition_set` en (full) + ar (partial), `vno_build` (renpy translate for english and arabic, `config.rtl = True`, german default) ok, `vno_lint` ok; `vno_languages` (37), `vno_set_library` (fixtures folder; missing folder refused), `vno_import` of a fixture book (regression), `vno_create_project` with Japanese text and no `lang` → `ja`, build + lint ok with the font warning.
- Not done: the hub's own vn-studio (port 7459, started before this ticket by another session) was not restarted, so `hub.ps1 call vn-studio` still reaches the old tools until `hub.ps1 stop vn-studio` + `start vn-studio`. No assets were generated (placeholders), no voice clips, no Electron window checks (EditionsTab, ImportDialog), no `yarn build` of the renderer bundle (typecheck covers it).
