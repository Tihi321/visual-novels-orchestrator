# Engine protocol for the VN projects

The UI talks to the engine with `Command`s and receives `EngineEvent`s (`src/shared/protocol.ts`, the transport is described there). This page covers the VN part: projects, editions, assets, the pipeline, the game build, themes, ComfyUI and voice. The types live in `src/shared/protocol.ts` (the commands, the events, `ProjectSummary`, `ProjectDetail`, `AssetView`, `BuildResult` ...) and `src/shared/vn.ts` (`VnBook`, `Edition`, `ProjectSettings`, `AssetEntry`). A book is presented either as a visual novel or, from HUB-17 (VNO-47), as a children's picture book: `VnBook.presentation` (see "Picture books" below).

Rules that hold for every command:

- Nothing is returned from `send`. A query is answered with an event (below), a change is announced with an event, and a failure comes as `{ type: 'command.error', command, message, slug? }`.
- Long work (the pipeline, generation, build, lint, Android, voice) is a **job** in the queue. The command only enqueues it; progress arrives as `pipeline.progress`, `asset.updated`, `build.result` and `project.updated`. The jobs and agents are in the normal snapshot and events (`job.started`, `job.done`, `agent.state` ...).
- A project is identified by its `slug` (a folder name in `projects/`, lower case letters, digits, `-`, `_`, `.`). Anything else is refused with `command.error`.
- Paths in events are relative to the project folder (`assets/<id>/v2.webp`) so the renderer can load them with the `vnstudio-file://` protocol. The protocol (Electron main, `src/main/files.ts`) serves `projects/<slug>/assets|preview|voice/` (images and audio: mp3, wav, ogg, opus, flac, m4a; with HTTP `Range`, so `<audio>` can seek) and `themes/<name>/fonts/<file>` (ttf, otf, woff, woff2, from the themes folder), nothing else. Absolute paths only where noted (`ThemeInfo.dir`, `BuildResult.gameDir`).
- Projects are never deleted except by `deleteProject`.

## Library and import

| Command | Answer |
| --- | --- |
| `{ type: 'listSourceBooks' }` | `books.listed { books: SourceBook[], scriptoriumData }`: the books of `<scriptoriumData>/books` that can become visual novels (`script: true` formats, and the prose choice formats). |
| `{ type: 'previewImport', source }` | `import.preview { preview: ImportPreview }`. `source` is a book folder (any folder in the Scriptorium layout, or a v2 pack folder with `vn/pack.json`) or a library slug. The preview has the language with its `confidence` (0..1; 1 for a pack, whose `book.primaryLang` is authoritative), the counts, the parser warnings and `uncertain` (items the script-analyst will settle; empty for a pack). Use it for the import dialog: show the language, let the user confirm or pick EN/HR. |
| `{ type: 'importProject', source, lang?, run? }` | `import.done { slug, preview }` and `project.updated`. `lang` is a language code (`en`, `hr`, `de`, `ja`, ...: the built-in table plus `config/languages.md`) the user confirmed, else the detected one; a pack must keep its `book.primaryLang`. A folder with `vn/pack.json` is read as a pack: `vn/pack.json` and `vn/text/<primary>.json` are validated (format/version/packHash/key set) and the project stores `packHash`, `packVersion`, `sourceHash` and `packDir` in `project.md`. Importing the same folder again keeps the project's settings, other editions and assets (their ids, versions and files). `run: true` also starts the pipeline from `analyse`. |
| `{ type: 'listProjects' }` | `projects.listed { projects: ProjectSummary[] }` |
| `{ type: 'getProject', slug }` | `project.loaded { slug, project: ProjectDetail }`: `summary`, `settings` (project.md), `book` (vn.json: structure and the primary text), the last `build` and `lint` results, `resolvedTheme` (the chosen theme, or the automatic pick), the job counts, `cues` (per scene: transition, pause, music, ambience, cast slots and beat cues) and `stageMusic` (`{ menu, chapters }`, the tracks of the menu and each chapter). The Scenes tab uses all three for its stage and audio preview. |
| `{ type: 'updateProjectSettings', slug, patch }` | `project.updated`. `patch` is `{ theme?: string \| null, art?: { style, generator, editor, palette, stylePrompt, review }, music?: { engine, tracks }, voice?: { enabled, langs, provider, engine, engines, styles, refTexts, voices } }`, each part merged. In `art`, `palette: null` and `stylePrompt: null` clear the field. The asset list follows (new voice references, engines of assets that have no file yet). |
| `{ type: 'deleteProject', slug }` | `project.deleted { slug }`. Removes the folder and the project's queued jobs. |

## The pipeline

`{ type: 'runPipeline', slug, from?, force? }` enqueues the director's `vn.pipeline.run` job, which enqueues the chain from `from`. The steps, in order:

`import` -> `analyse` -> `art` -> `music` -> `generate` -> `voice` -> `stage` -> `build` -> `lint`

- Default `from`: `analyse` (`import` when there is no vn.json). `import` imports the project's source folder again.
- Every step is restartable: `from: 'build'` only builds and lints; `from: 'generate'` generates what has no file (resumable) and then goes on. `force: true` plans the prompts and generates again for assets that already have a prompt or a file (locked and custom assets are never touched). A sound effect with no engine is made by the music provider's engine — the ambience engine (ACE-Step by default) for a ComfyUI project, Chiptune Studio for a chiptune one; `sound.sfxEngine` overrides it (for example `moss-soundeffect-v2`) and `none` keeps effects import-only — so a resumed generate finishes SFX too. The Pipeline tab shows the assets that still have no file and offers Continue from generate.
- `voice` is only in the chain when the project's `voice.enabled` is true.
- A step that fails keeps the jobs after it from starting (they wait for it); start again with `runPipeline` (a new run number).
- Asset edits never restart the pipeline: they only enqueue a build (see below).

Progress: `{ type: 'pipeline.progress', slug, step, status: { status: 'queued' | 'running' | 'done' | 'failed' | 'skipped', message, at, done?, total? } }`. `done`/`total` count the unit of work inside a step (assets generated). The state of the latest run is also in `ProjectSummary.pipeline` (`{ run, from, startedAt, steps }`). `project.updated { slug, project: ProjectSummary }` is sent (at most every 250 ms) when anything in the summary changed: asset counts, the pipeline, editions, theme.

What each step does, and which agent does it (see the Agents page; each agent has its own model):

| Step | Job task | Agent | Without a model |
| --- | --- | --- | --- |
| import | `vn.import` | none (deterministic) | |
| analyse | `vn.analyse` | script-analyst | the parser's defaults stay |
| art | `vn.art.plan` | art-director | prompts built from the book (`fallbackPrompt`) |
| music | `vn.music.plan` | composer | the book's genre prompt, 100 s tracks, chapters take turns |
| generate | `vn.assets.generate` (one job per asset; `_dispatch` unit is the fan-out) and `vn.assets.review` | none / art-critic | no review |
| voice | `vn.voice.plan`, `vn.voice.generate` (one per language) | voice-director | the project's engine (`voice.engine`, default OmniVoice) per language with a delivery style; a Flow voice when the provider is Flow |
| stage | `vn.stage` | stage-director | `defaultCues` |
| build | `vn.build` | none | |
| lint | `vn.lint` | none | |

Jobs that never need a model run without a provider slot. Jobs for one project are named `<slug>--<task>--<unit>--r<run>`.

## Editions

| Command | Answer |
| --- | --- |
| `{ type: 'addEdition', slug, source, lang }` | `lang` is a language code (see `config/languages.md`; the MCP tool `vno_add_edition` also accepts none and detects it). A project imported from a pack takes a `vn-text` catalogue JSON file or a bundle folder (`edition.json` + `vn/text/<lang>.json`): the catalogue is validated against the book by exact key set and pack hash, saved as `editions/<lang>.json`, and its report is written; no alignment, no edition-aligner and no asset or voice job is queued. Any other project takes a translated book folder: enqueues `vn.edition.add` (align deterministically) and, when beats are missing or extra, `vn.edition.align` (the edition-aligner). Announced by `project.updated` (`editions`). There is no machine translation: the edition is a translated catalogue or book folder. |
| `{ type: 'getEdition', slug, lang }` | `edition.loaded { slug, lang, edition }`: title, chapter titles, choice texts (`"<chapter>:<index>"`), endings, character names, `beats` (beat id -> text), the optional `sceneTitles` and `puzzles`. |
| `{ type: 'updateEditionBeat', slug, lang, beatId, text }` | `edition.updated { slug, lang, beatId, text }`. Also keeps vn.json in step when `lang` is the primary language, and takes the beat off the missing list of the report. |
| `{ type: 'getAlignReport', slug, lang }` | `align.report { slug, lang, report: AlignReportView \| null }`: `matched`, `missing` (primary beat ids with no text), `extra` (translated texts with no beat), `nameMap`, `placeMap`, `warnings`; a pack edition also has `packHash`, `packVersion`, `keyCount` and `source`. |

An edition never changes the asset list. The MCP tool `vno_sync_editions` scans a pack's `vn/text/*.json` and adds every non-primary catalogue through the same validation (idempotent).

## Picture books (VNO-47)

A picture book is the same `VnBook` shown differently: one full-page illustration with its characters drawn into it and one to three short sentences below, page turns, no sprites.

- `VnBook.presentation` is `'visual-novel'` (the default, and what an old `vn.json` without the field is) or `'picture-book'`. New imports store it from the format (`presentationForFormat`: `kids-picture-book` -> `picture-book`); `vno_create_project {book.presentation}` and `book.update {presentation}` set it, and the summary (`storySummary`, `vno_get_story`) reports it. `presentationOf(book)` answers the effective one. There is no project setting and no data-folder migration.
- **One page = one scene.** Pages are scenes; there is no page entity and no new beat type. The page text is the scene's `narration` beats (and its `line` beats, shown as `Name: text`), localized through the edition. The primary edition is still the primary text; translations go through the usual catalogues.
- **One illustration per page = the scene's `backgroundId`.** In a picture book `backgroundId` is `bg_<chapter>_<scene>` (`pictureBookBackgroundId`, e.g. `bg_ch01_s01`), so two scenes in the same place and time have different pictures. Outside picture books the place+time id is untouched. `backgroundIdFor(presentation, sceneId, placeKey, placeText, time)` picks one. Changing the presentation with `book.update` recomputes every scene's id (the new backgrounds need prompts/images; the old paid assets are orphaned but kept).
- **Asset plan (D4).** `deriveAssets` plans one `background` per scene (the page), a `cover`, the music tracks, the SFX/ambience, the voice references and a `sheet_<char>` per character that appears. There are **no `sprite_*`, no expression variants and no `cg_*`**: the sheets stay internal references, never drawn in the book. A page whose scene has characters is made by the edit engine (`art.editor`) from at most 3 sheets (`refs`, the same rule as a CG with characters); a page without them by the generator.
- **Page prompts (D5).** `fallbackPrompt('background')` (and the art-director's `describeAsset`/`ensureFraming`) keep the people the place looks and the scene description mention and name the scene's cast with `peopleClause`; the framing is `PAGE_FRAMING` ("children's picture book illustration, full-bleed ... no text, no lettering"), never `BACKGROUND_FRAMING`. `fallbackNegative('background', { pictureBook: true })` drops the people/animal ban and keeps the text bans. A visual-novel prompt and negative are byte-identical to before.
- **The player.** `GameData.presentation` (missing = visual novel) switches the web player to page mode: the body gets `vno-picturebook`, the image band is 0-800 px with `contain` (nothing cropped), the caption band 800-1080 px, a footer with the page counter and prev/next, and a replay button when the page's beats have voice clips. Click/tap the illustration or the caption, `->`/Space/Enter: next page; `<-`/PageUp: previous; swipe on touch; Esc: main menu. There is no typewriter, chapter card, name box, quick menu or scene title. The last page shows The End (Start again / Main Menu); a book with choices still offers them. The page is quick-saved on every turn and the main menu's Load resumes it; a visual novel keeps its save/load screens unchanged.
- **Read aloud (D8).** If the current edition has voice clips for the page's text beats they play in order when the page appears (the narrator reads narration); the replay button repeats them. No new voice pipeline.
- **Lint.** `lintGame` on a picture book checks: a page with no illustration (`bgPath` null) is an error; a page with no text is a warning; sprite entries, CG entries or CG/insert cues left in the game are warnings; the statistics say pages. Warnings do not fail the lint (they are in the output and in `lint.json` with a `warning: ` prefix).

## Assets

`AssetView` is the manifest entry (`id`, `kind`, `prompt`, `negative`, `engine`, `seed`, `size`, `refs`, `versions[]`, `selected`, `source: 'generated' | 'custom'`, `customFile`, `locked`, `review`) plus `fileRel` (the file the build uses), `versionFiles` (version number -> relative path) and `orphaned` (the book no longer uses it; it is kept).

Asset ids: `bg_<place>_<time>` (a picture book: `bg_<chapter>_<scene>`, one page per scene), `sheet_<char>`, `sprite_<char>_<expression>`, `cg_<key>`, `sfx_<key>`, `amb_<key>`, `cover`, `music_01..`, `voice_<char|narrator>`.

| Command | Effect |
| --- | --- |
| `{ type: 'listAssets', slug }` | `assets.listed { slug, assets: AssetView[] }` |
| `{ type: 'regenerateAsset', slug, id, prompt?, engine?, seed? }` | A `vn.assets.generate` job that adds a new version (selected) with the edits, then a build. `asset.updated` when it is done. |
| `{ type: 'replaceAsset', slug, id, file }` | The file is copied to `assets/<id>/custom.<ext>`; the asset becomes `custom` and locked. `asset.updated`, then a build job. |
| `{ type: 'pickAssetVersion', slug, id, n }` | Selects an existing version (and goes back to `generated`). `asset.updated`, then a build job. |
| `{ type: 'lockAsset' \| 'unlockAsset', slug, id }` | `asset.updated`. Locked assets are never regenerated by the pipeline. No build. |

`{ type: 'asset.updated', slug, asset: AssetView }` is also sent for every asset the generation jobs finish and for review results (`review: { status: 'approved' | 'rejected' | 'pending', note? }`). A rejected review keeps the version with the fewest problems after two retries.

At most one build job waits in the queue after edits, so several quick edits cause one build.

## Build, lint, run, Android

| Command | Effect |
| --- | --- |
| `{ type: 'buildGame', slug }` | `vn.build` job. The result arrives as `build.result { result: BuildResult }` (`action: 'build'`, `ok`, `messages` = warnings, `gameDir`, `theme`, `placeholders` = asset ids drawn as placeholders, `translated`). The build writes the HTML5 web player (`game/index.html`, `game/game-data.json`, `player.js`); no Ren'Py SDK is needed. `messages` also reports a primary edition that disagrees with `vn.json` and pack editions made for a different `packHash`. |
| `{ type: 'lintGame', slug }` | `vn.lint` job. `build.result` with `action: 'lint'`; `ok`, `messages` (the lint problems), `statistics`; `skipped: true` when the game is not built. Besides the game files, lint checks that `vn.json` primary text agrees with `editions/<primary>.json` and that pack editions were made for the project's current `packHash`. |
| `{ type: 'runGame', slug }` | Starts the game. `game.started { slug, pid }`. |
| `{ type: 'androidPreflight', slug }` | `build.result` with `action: 'preflight'`: `ok`, and `messages` = what is missing (each with the action to take) or what was found. |
| `{ type: 'androidBuild', slug, bundle? }` | `vn.android` job. `build.result` with `action: 'android'`, `files` = the .apk / .aab in `projects/<slug>/android/`. |

The last build and lint results are in `ProjectDetail.build` / `.lint` (`build.json`, `lint.json` in the project folder).

### The web player's own preferences

The generated player keeps its settings in the browser's `localStorage` (`vno_settings`, per build) and shows them in its Preferences screen. **Interface language** and **Story language** are two separate pickers: the story picker lists the book's editions (`game-data.json` → `languages`), the interface picker lists `uiLanguages` — every built-in language with menu strings (the `PLAYER_UI_KEYS` subset of `src/shared/ui-strings.ts`, exact keys only, so the payload stays ~26 KB) plus English, which shows the English literals. The interface starts in English and the choice is remembered; changing the story language never changes the menus, and an old `game-data.json` without `uiLanguages` keeps the pre-VNO-48 behaviour (menus follow the story, the interface row is hidden). The mix is balanced for read-aloud books: music defaults to 48 against voice 90, every slider goes through a perceptual `(value/100)^1.6` curve, and music (×0.35) and ambience (×0.7) duck while a voice clip plays. A stored settings blob from before VNO-48 is migrated once (its music value is capped at 60). The `Story text size` slider (80–140 %) scales the picture-book caption and the dialogue, and both auto-fit so long text never covers the illustration.

## Themes, ComfyUI, engines

| Command | Answer |
| --- | --- |
| `{ type: 'listThemes' }` | `themes.listed { themes: ThemeInfo[] }`: `name`, `label`, `description`, `light`, `pixel`, `previewCss` (the live preview: `.vnp-stage`, `.vnp-textbox`, `.vnp-name`, `.vnp-text`, `.vnp-menu`, `.vnp-choice`; it starts with the `@font-face` rules for the theme's fonts, families `vnp-<theme>`, `vnp-<theme>-name`, `vnp-<theme>-bold`, loaded from `vnstudio-file://data/themes/<folder>/fonts/<file>`) and `dir` (the theme folder). |
| `{ type: 'comfyStatus' }` | `comfy.status { ok, lanes[], engines[] (id, kind, label, ready, missing), customWorkflows[], backgroundRemoval }` |
| `{ type: 'comfyFree' }` | `comfy.freed { results: [{ lane, ok, error? }] }` |
| `{ type: 'listEngines' }` | `engines.listed { image: EngineInfo[], audio: EngineInfo[], palettes: string[] }`. `EngineInfo.edit` marks the editors (they take a reference image). Use `custom:<name>` for a custom workflow. |
| `{ type: 'listCustomWorkflows' }` | `workflows.listed { workflows: [{ name, kind: 'image' \| 'audio', languages[] }] }`. `languages` are the language codes a TTS workflow's mapping declares. |

## Ren'Py settings

| Command | Answer |
| --- | --- |
| `{ type: 'getRenpyConfig' }` | `renpy.config { sdkPath, resolution, imageFormat, sdkFound, envOverride, warning? }` from `config/renpy.md` (`VNO_RENPY_SDK` overrides `sdkPath`; `envOverride` says so). |
| `{ type: 'saveRenpyConfig', sdkPath?, resolution?, imageFormat? }` | Writes the given fields to `config/renpy.md` (the other fields and the notes below stay) and answers with `renpy.config`. An SDK folder without `renpy.exe` is a `warning` (the save still happens); a bad `resolution` (not `WIDTHxHEIGHT`) is a `command.error`. |

## Voice

Voice is off by default, per book. Turn it on with `updateProjectSettings { voice: { enabled: true, langs: ['en', 'hr'] } }` (any language codes). `voice.provider` says where the clips come from:

- `comfy` (the default): the local ComfyUI **TTS Audio Suite** engines, through `src/engine/comfy/tts-engines.ts` and the ComfyUI client. `voice.engine` is the default engine (`omnivoice`); `voice.engines` overrides it per language (`{ hr: 'higgs-audio-v3' }`, a built-in id or `custom:<workflow>`). The built-in engines: OmniVoice (600+ languages, the default, reads Croatian), Higgs Audio v3 (100+ languages, style as inline tags), Chatterbox 23 languages, VibeVoice (en/zh), Qwen3-TTS (10 languages, cloning), IndexTTS-2 (5 languages, cloning), F5-TTS (10 languages, cloning; the transcript is required), plus MOSS-SoundEffect v2 for sound effects. An engine whose node classes are missing (the suite is not installed) fails with the node-install message; an engine that does not read a language skips that language with the supported list (Chatterbox has no Croatian). `config/voice.md` sets `format` (`mp3` or `wav`), `speed` (0.5-2) and `chunkChars` (100-1000, default 400).
- `flow`: the cloud fallback, Google Flow through flow-music-mcp (free Gemini/Windows voices; Flow's status is in `vno_studios_status`).

`voice.styles` maps a speaker key (a character key or `narrator`) to a delivery note: the OmniVoice/Qwen3-TTS `instruct`, inline tags for Higgs, or the Flow style note. `voice.refTexts` maps a speaker to the transcript of their uploaded `voice_<speaker>` reference clip (required by F5-TTS, used by the cloning engines). `voice.voices` maps a speaker to a Flow voice per language (`{ mara: { en: 'gemini:Charon' } }`), Flow only. A character without a reference clip or a Flow voice in a language uses the narrator's; so does narration. Projects from before the local engines load clean: `provider: vibetts` becomes `comfy`, `englishEngine` is dropped, `flowStyles` becomes `styles`, and the old Kokoro/Supertonic voice ids are dropped (only `gemini:`/`windows:` ids are kept); the next settings write saves the clean shape.

| Command | Effect |
| --- | --- |
| `{ type: 'voiceStatus' }` | `voice.status { ok, error, comfyUrl, defaultEngine, engines, workflows }`. Never an error: an unreachable ComfyUI is `ok: false` with the message to show. `engines` are `{ id, label, task: 'tts' \| 'sfx', languages, ready, missing }` (`languages` is `'*'` for any language, empty for a sound-effect engine); `workflows` are the custom TTS workflows with the languages their mapping declares. |
| `{ type: 'planVoices', slug, overwrite? }` | Enqueues `vn.voice.plan`. With the local provider the voice-director is shown the installed engines per language and answers, per speaking character and the narrator, `{ speakerKey, gender, engines: { en?, hr? }, description, suggestedRef }`; the engine keeps only an engine that is installed and reads the language, stores `description` in `voice.styles` and the engines in `voice.engines`, and leaves the uploaded reference clips alone. With the Flow provider the answer is `{ speakerKey, gender, voices: { en?, hr? }, description, suggestedRef }` and the Flow plan applies (gender spread over the listed voices that read the language, `voice.voices`). Existing styles, engines and voices are kept unless `overwrite`; clips of a changed (speaker, language) are forgotten. Without an answer nothing breaks: generation uses `voice.engine` and no style. Does nothing when voice is off. |
| `{ type: 'setVoice', slug, speakerKey, lang, voice }` | Flow only: gives a speaker (a character key or `narrator`) the Flow voice for one language. Saves it in `voice.voices`, forgets that speaker's clips in that language and answers with `voice.preview`. A local project is refused with the hint to set `voice.engine`/`voice.engines` and use `previewVoice`. |
| `{ type: 'previewVoice', slug, speakerKey, voice?, lang? }` | Makes a sample sentence (a line of that speaker in the language, else a fixed one) and answers with `voice.preview { slug, speakerKey, voice, file, rev, lang }`. `file` is `preview/voice-<key>.<ext>` relative to the project folder (served by the file protocol); `rev` busts the player's cache. With the Flow provider `voice` is a Flow id (default: the speaker's assigned one); with the local provider it is left out and the answer's `voice` is the engine id that spoke. |
| `{ type: 'setVoiceRef', slug, charKey, file }` | The reference clip of a character (`narrator` for the narrator): a custom, locked `voice_<charKey>` asset. `asset.updated`. A character without a clip uses the narrator's. |
| `{ type: 'generateVoice', slug, lang?, beatId?, limit?, force?, speakerKey? }` | Enqueues `vn.voice.generate` for the project's voice languages (or `lang`). Does nothing when voice is off. Clips go to `voice/<lang>/<beatId>.<ext>` (the `format` of `config/voice.md`) and `voice/<lang>/index.json` keeps `{ hash, file, speaker, engine, seed, at }` per beat. The hash covers the engine, the text, the language, the reference clip's content, its transcript, the style, the format, `chunkChars` and the speed, so a second run of an unchanged project makes no ComfyUI request. `force` regenerates the matching clips with a fresh seed (`beatId` and `speakerKey` narrow it); imported clips are always kept. The index is saved after every clip, so a stopped job continues where it was, and `pipeline.progress` (`step: 'voice'`) carries `done/total`. `limit` makes at most that many clips per language (for a quick try). Non-primary languages speak the edition text. A language the engine does not read is skipped with the supported list; a custom TTS workflow's mapping decides its own languages. |

The CLI: `yarn engine -- voice status`, `voice plan <slug> [--overwrite]`, `voice <slug> [--lang hr] [--only <beatId>] [--limit n] [--force] [--speaker <key>]`, `voice preview <slug> <speaker> [--lang hr]`, `voice engine <slug> <engine> [--lang hr]`, `voice style <slug> <speaker> <text>`, `voice reftext <slug> <speaker> <text>`, `voice import ...`, and `voice set <slug> <speaker> <lang> <voice>` (Flow only). The Ren'Py build emits `voice "voice/<lang>/<beatId>.<ext>"` for every beat that has a clip (the extension of the clip file is kept).

## Project folder

`projects/<slug>/`: `project.md` (settings; a pack import also has `packHash`, `packVersion`, `sourceHash` and `packDir`), `vn.json`, `editions/<lang>.json`, `align-<lang>.json`, `uncertain.json`, `assets.json`, `assets/<id>/v<n>.<ext>` and `custom.<ext>`, `music.json` (the composer's plan), `cues.json` (the stage-director's cues), `pipeline.json`, `build.json`, `lint.json`, `summary.json` (the director's run summary), `voice/<lang>/`, `game/` (the built web game) and `log.md` (agent and job log of this project).

## CLI and MCP

The same operations run headless: `yarn engine -- help` lists the CLI (`books`, `import`, `projects`, `run`, `edition add`, `edition sync`, `plan`, `generate`, `asset ...`, `build`, `lint`, `play`, `android`, `voice`, `comfy`, `themes`) and `yarn engine -- mcp` serves the MCP tools on stdio. See the README.

**MCP over HTTP.** The long-lived engine (the app's, or `node out/engine/index.js --mcp-only [--port N]` headless) serves the same tools at `http://127.0.0.1:7459/mcp` (Streamable HTTP, `src/engine/mcp/`; the tool list and the guide `vn-studio://guide` are in `docs/mcp-guide.md`). Its settings are `config/mcp.md` (`enabled`, `port`, `token`; `VNO_MCP_PORT` and `VNO_MCP_TOKEN` override), reloaded when the file changes.

- `mcpStatus` asks for the state; `saveMcpConfig {enabled, port, token?}` writes `config/mcp.md` (`token` left out keeps the old one, `''` clears it) and restarts the server when enabled, port or token changed. Both answer with `mcp.status {enabled, listening, url, error, port, tokenSet}`, which is also sent whenever the server starts, stops or fails to bind. The token itself is never sent.
- Every engine takes the data-folder lock `engine.lock` (`{pid, startedAt, mcpUrl}`, created exclusively; one whose pid is gone is replaced) and releases it when it stops. A second engine (CLI, `yarn mcp`, the app) refuses with "VN Studio is already running on this data folder (pid N). Use its MCP at <url> or close it." and exits with 1; `yarn engine -- mcp` (stdio) relays to the url in the lock instead.

### Art style words

`ProjectSettings.art.stylePrompt` (optional string, user-editable with `updateProjectSettings { patch: { art: { stylePrompt } } }`) is the style prefix of every image prompt. When it is empty the engine derives one from the format, genre and art mode (kids formats: soft watercolor; pixel mode: pixel art; others by genre). The bible's `## Style` section is a writing note and is never put into an image prompt. Show the derived default as the field's placeholder.

## Studios (VNO-02)

- Commands: `studiosStatus` (answers `studios.status`: Pixel Studio and Chiptune Studio, reachable or not, with the start hint) and `openInStudio {slug, id}` (answers `studio.opened`; each save in the studio makes a new custom, locked version, announced by `asset.updated`).
- Settings (`updateProjectSettings`): `art.pixelProvider` (`vno` | `pixel-studio`), `art.provider` (`comfy` | `pixel-studio-draw` | `hand`), `art.pixel {width, height, dither, outline}`, `music.provider` (`comfy` | `chiptune`; missing: chiptune for pixel books), `music.chip`. `null` clears an optional one.
- Hand-made art (`art.provider: hand`, any style): VN Studio never generates an image. The art step plans no prompts (`vn.art.plan` returns `hand-made art: no prompts planned`; the explicit `vno_plan` still does), the generate step enqueues only music and voice and reports `N image(s) wait for a hand-made file (vno_asset_replace)`, and `regenerateAsset` or `vno_asset_generate` on an image is an error. Images are set with `replaceAsset` or saved from Pixel Studio. A sheet without a file is neither a placeholder nor counted in `ProjectSummary.assets`; other missing images still get a placeholder in the build.
- Google Flow (`art.provider: flow`, flow-music-mcp, `config/studios.md` `flow*` keys, `VNO_FLOW_URL`): images are made with the pseudo engine `flow` (like `chiptune` for music); a version records `remote: {provider: 'flow', id: <media id>, project}` and `seed: null`. `studiosStatus` has a third entry, `id: 'flow'`. Voices (the cloud fallback; the local ComfyUI engines are the default): `voice.provider: flow` (ids `gemini:<Name>` / `windows:<Voice Name>`, `voice.styles`), clips `voice/<lang>/<beatId>.<format>`. Music: `music.provider: flow` (pseudo engine `flow-music`, never a default, `max_attempts: 1`, at most `flowMusicMaxSongs` songs per project; the version's `remote` has the song id and `loopStartSec` comes from `music_loop`). See `docs/mcp-guide.md` "Google Flow".
- Puzzles (`VnBook.puzzles`, `src/shared/puzzle.ts`): a `puzzle` beat `{id, type: 'puzzle', puzzle: key}` plays a puzzle entry `{key, kind, data (the core), names, text, links?, clueAt?, onFail?, hints?, verified}`; an edition has `puzzles: {key: {names, text}}`. Story ops `puzzle.set` and `puzzle.remove`; MCP tools `vno_puzzle_generate`, `vno_puzzle_set`, `vno_puzzle_get`, `vno_puzzle_check_text`, `vno_puzzle_remove`. The engine runs the library (`templates/puzzles/game/python-packages/vno_puzzles/cli.py`) with the SDK's Python: `generate`, `solve`, `check`, `check-text`, `render-text`, JSON in and out. The build copies the library and writes `game/vno_puzzles_data.rpy` only for a book with a puzzle beat. See `docs/mcp-guide.md` "Puzzles". The clue ids of `CLUE:` lines per kind (Murdle and logic `c1`.. and `murder` or `intro`; Knights and Knaves `intro` and `t1`..; a testimony's evidence `e1`..) and how a chapter spreads them are listed there under the import.
- Asset versions may carry `loopStartSec`, `loopEndSec`, `songFile` (Chiptune Studio), `nativeFile` (Pixel Studio, the PNG at the pixel size), `warnings` and `custom`.
- Config: `config/studios.md` (URLs, app folders, timeouts); `VNO_PIXEL_STUDIO_URL`, `VNO_CHIPTUNE_STUDIO_URL` override the URLs. `config/autostart.md` (`enabled`, `registry`, `services`, `startTimeoutS`, `stopOnExit`; `VNO_AUTOSTART=0` turns it off) lets a job that finds Pixel Studio, Chiptune Studio or ComfyUI down start it from the creative hub's `services.json`, wait until it answers and retry the call once. Never started: Scriptorium, Strata, LM Studio, anything off this machine; ComfyUI is not started while Strata answers. Only job paths and `importAsset` start anything; `studiosStatus`, `voiceStatus`, `comfyStatus` and the Generators page only probe. The service's output is appended to the hub's `logs/<id>.out.log` / `<id>.err.log`. The studio contract is in `.claude/tickets/VNO-02-chiptune-and-pixel-studio/contracts.md`.
- CLI: `settings <slug> ...`, `studios status`, `studio open <slug> <assetId> [--wait]`.
- Seed refresh: `.seed-hashes.json` in the data folder records the seed hashes; an untouched seeded file is updated on upgrade, an edited one is kept and listed as an update available (an `engine.warning` at start).
