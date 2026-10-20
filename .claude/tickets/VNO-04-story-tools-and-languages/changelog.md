# VNO-04 changelog

## 2026-10-20: story tools over MCP, 37 edition languages, plan/music/cues/library tools

**Outcome:**
- An agent can make a visual novel from a story written as JSON and edit it over MCP, with no Scriptorium folder.
- Editions are no longer limited to en and hr: VN Studio knows 37 languages, and more can be added in `config/languages.md`.
- New tools set asset prompts without generating, set the chapter music and the stage cues by hand, and set the library path.
- The MCP server goes from 38 tools to 62.

Commit status: **uncommitted**, on branch `VNO-04_story-tools-languages` (from `origin/master` c752332).

### visual-novels-orchestrator

**Languages**
- **`src/shared/languages.ts` (new):** the built-in table of 37 languages: the 31 that Supertonic reads, plus sr, bs, no, he, fa and zh from Book Translator.
  - Each entry has its code, English name, native name, Ren'Py language name, script, rtl (ar/he/fa) and a `supertonic` flag. Croatian also carries its UI table (`ui`).
  - The registry: `languages`, `languageInfo`, `isKnownLang`, `assertKnownLang`, `registerLanguages`, `resetLanguages`, `LEGACY_LANGS`.
- **`src/shared/vn.ts`:**
  - `langSchema` now accepts any language code (`xx`, `xxx`, `xx-yyyy`).
  - `LANGS` is the list of built-in codes.
  - Legacy Supertonic voices migrate to en and hr only.
  - `voice.voices` is now speaker → lang → voice.
- **`src/engine/vn/languages-config.ts`, `seed/config/languages.md` (new):** `config/languages.md` adds or overrides languages, including a `ui` table of menu strings. A bad file is logged and the built-in table is used.
  - The engine loads it at start, and `svc.knownLang` loads it before checking a language.
- **`src/engine/vn/lang.ts`:** `detectLanguage` covers every registered language.
  - It looks at the Unicode script first, then at stop words and marker letters.
  - Croatian, Bosnian and Serbian Latin are scored as one group; the result is `hr` unless Serbian or Bosnian markers win.
  - The result adds `scores` per language and `script`.
- **`src/engine/renpy/tl.ts`, `build.ts`:**
  - Language names come from the registry (`renpyLanguage`, `nativeName`, `uiStrings`).
  - Any non-English primary language becomes its own Ren'Py language and the default; the old Croatian-only special case is gone.
  - A primary without a UI table gets one identity strings entry, so Ren'Py knows the language.
  - The build warns when menus stay in English, and when the font (DejaVuSans) has no glyphs for han, kana, hangul, devanagari or thai.
  - When the primary or an edition is rtl, the build writes `game/vno_languages.rpy` with `define config.rtl = True` and warns that the layout is not mirrored.
- **`src/engine/vn/project.ts`:** `editionLangs` reads any code file name, not only two letters.
- **`src/engine/voice/jobs.ts`:** the voice preview sample for a language other than en/hr is a line from that edition, else its title.
- **`src/engine/vn/service.ts`:**
  - `knownLang`.
  - `importProject` checks an explicit `lang`.
  - `addEdition(slug, source, lang?)` detects the folder's language when `lang` is left out and returns `{job, lang, detected}`.
- **`src/engine/vncli.ts`:** `--lang` and `voice set` accept any known code.
- **Renderer:**
  - `EditionsTab` offers every built-in language.
  - `ImportDialog` has a language select.
  - `lib/voice.ts` takes language names from the registry.
- **`docs/protocol.md`:** language mentions.

**Story tools**
- **`src/engine/vn/story.ts` (new, pure):**
  - The lenient story input schemas, and `buildBook`.
  - `validateBook`: errors for dangling keys, bad choices and repeated ids; warnings for unreachable chapters, empty scenes and an unknown speaker or place.
  - `applyStoryOps` with 14 ops:
    - book: `update`;
    - character, place: `set`, `remove`;
    - chapter, scene, beat: `add`, `update`, `remove`.
  - Ids are stable: a new scene or beat takes the next free number.
  - `storyAffects` says which assets an edit touches, and `syncEdition` prunes the other editions.
- **`src/engine/vn/service.ts`:**
  - `createProject` writes `project.md` with `source: ''`, `vn.json`, the primary edition, `uncertain.json` and `import.json`, then reconciles the assets.
  - `getStory`.
  - `editStory` runs atomically under the project lock:
    - it rebuilds the primary edition and prunes the other editions;
    - it prunes `cues.json` and `music.json` entries for removed chapters, scenes and beats;
    - it reconciles the assets and reports each one as `cleared`, `stale`, `keptLocked` or `keptByHand`.
  - `setEdition` (added by the orchestrator) writes or merges another language's text as JSON, checks every key against the book, and lists what is still missing.
- **`src/engine/mcp/tools-story.ts` (new):**
  - `vno_create_project`, `vno_get_story` and `vno_story_edit`.
  - One tool per op: `vno_book_update`, `vno_character_set`, `vno_character_remove`, `vno_place_set`, `vno_place_remove`, `vno_chapter_add`, `vno_chapter_update`, `vno_chapter_remove`, `vno_scene_add`, `vno_scene_update`, `vno_scene_remove`, `vno_beat_add`, `vno_beat_update`, `vno_beat_remove`.
  - `vno_edition_set`.

**Plan, music, cues, library**
- **`src/shared/vn.ts`:** `assetEntrySchema.promptByHand`.
- **`src/engine/vn/service.ts`:**
  - `setAssetPlan`.
  - `setMusicPlan` checks track ids and chapters and clamps seconds to 60..180.
  - `setCues` checks music ids, scene ids, cast beat ids, cast members and slots.
  - `runPipeline` never defaults to import for a project made over MCP.
- **`src/engine/vn/handlers.ts`:**
  - The import step does nothing for a project made over MCP.
  - The art and music plans skip `promptByHand` assets, even with force.
  - The music step keeps a `byHand` music plan and fills only what it lacks.
  - The stage step keeps `byHand` cues: it does not call the stage-director, and adds defaults only for what is missing.
- **`src/engine/renpy/stage.ts`:** `StageCues.byHand` and `fillCues`.
- **`src/engine/vn/agents/composer.ts`:** `MusicPlan.byHand`.
- **`src/engine/engine.ts`:**
  - `writeSettings` is shared by the settings command and the new `setScriptoriumData`, which refuses a missing folder.
  - The engine passes `setScriptoriumData` to the MCP controller.
- **`src/engine/mcp/controller.ts`, `stdio.ts`:** pass `setScriptoriumData` to the tools.
- **`src/engine/mcp/tools-plan.ts` (new):** `vno_asset_set`, `vno_plan`, `vno_set_music`, `vno_set_cues`, `vno_set_library`.

**Wiring and docs**
- **`src/engine/mcp/tools.ts`:**
  - Exports `def` and `ToolDef`, and adds `McpOptions.setScriptoriumData`.
  - Spreads the story and plan tools into the list.
  - `lang` is any language code.
  - `vno_add_edition` takes an optional `lang`.
  - New `vno_languages`.
- **`src/engine/mcp/server.ts`:** the `initialize` instructions mention the story tools and languages.
- **`docs/mcp-guide.md`:**
  - A new workflow without a book folder.
  - The story JSON with an example, and the table of edit ops.
  - Prompts, music and staging by hand.
  - Languages, and the tool table.
- **`README.md`:** languages, the story tools and the tool list.

**Tests**
- New: `tests/languages.test.ts` (51), `tests/vn-story.test.ts` (22), `tests/vn-plan-tools.test.ts` (9).
- Updated: `tests/renpy-emit.test.ts` (German primary, warnings) and `tests/renpy-tl.test.ts` (`uiStrings`).

### creative-hub (docs only)
- **`ROADMAP.md`:**
  - The VN Studio story-tools, languages, step-only and library items are marked done, with what is left.
  - New items: restart needed, non-Latin slugs, and the `hub.ps1 call` timeout.
- **`.claude/skills/make-visual-novel/SKILL.md`:**
  - Option B now writes the story straight into VN Studio with `vno_create_project`; the book-folder path is kept as an alternative.
  - Translating a JSON story with `vno_edition_set`.
  - `vno_plan`, `vno_asset_set`, `vno_set_music` and `vno_set_cues`.
  - `vno_set_library`.
  - Two new troubleshooting lines.

### Deviations from the plan
- **Endings:** in a choice book, a chapter without choices ends the game (its `ending`, else "The End"). The plan said it continues to the next chapter; this follows what `renpy/emit.ts` already does.
- **Kind and format:** they follow the choices after an edit.
- **`vno_edition_set`:** added. A project made from JSON otherwise had no way to get a translated edition.
- **`keptByHand`, and pruning `cues.json`/`music.json` in `editStory`:** added after S2's report.
- **Renderer languages:** the renderer lists only the built-in languages, because `config/languages.md` is read by the engine only.

### Verification
- `yarn typecheck`: clean.
- `yarn lint`: clean.
- `yarn test`: 45 files, 539 tests pass. The baseline before was 42 files, 455 tests.
- `hub.ps1 build vn-studio`: ran.
- Live over MCP HTTP, against the built engine on an isolated data folder and port 7469, with the Ren'Py 8.5.3 SDK. The full list is in `plan.md` "Verification record". In short:
  - A German choice book made only through the tools: create, edits, plan with LM Studio, asset_set, music, cues, then `vno_build` and `vno_lint` both OK.
  - With added en and ar editions, `renpy translate` filled the stubs and `config.rtl` was set. Build and lint both OK.
  - A Japanese story with its language detected: build and lint OK, with the font warning.
  - A fixture book imported through `vno_import` (regression): OK.

**Not run:**
- The hub's running vn-studio on port 7459 was not restarted (another session started it), so it serves the old 38 tools until `hub.ps1 stop vn-studio` and `start vn-studio`.
- No images, music or voice clips were generated; the build used placeholders.
- No Electron window checks.
- No full `yarn build` of the renderer.

### Follow-ups and known limitations
- The game menus are translated only for Croatian. Other languages need a `ui` table in `config/languages.md`.
- The built-in font has no CJK, Hangul, Devanagari or Thai glyphs, so that text shows as boxes. A per-language font is not implemented.
- RTL text is on, but the layout is not mirrored.
- Slugs are ASCII: a title with no Latin letters gives `book` unless `slug` is passed.
- Choice texts in other editions are keyed by index (`n:i`), so reordering choices misaligns their translations.
- A new beat or scene can reuse the id of the highest-numbered one after that one was removed.
- Genre, format and style edits clear no prompts.
