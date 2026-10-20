# Engine protocol for the VN projects

The UI talks to the engine with `Command`s and receives `EngineEvent`s (`src/shared/protocol.ts`, the transport is described there). This page covers the VN part: projects, editions, assets, the pipeline, the game build, themes, ComfyUI and voice. The types live in `src/shared/protocol.ts` (the commands, the events, `ProjectSummary`, `ProjectDetail`, `AssetView`, `BuildResult` ...) and `src/shared/vn.ts` (`VnBook`, `Edition`, `ProjectSettings`, `AssetEntry`).

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
| `{ type: 'previewImport', source }` | `import.preview { preview: ImportPreview }`. `source` is a book folder (any folder in the Scriptorium layout) or a library slug. The preview has the detected language with its `confidence` (0..1), the counts, the parser warnings and `uncertain` (items the script-analyst will settle). Use it for the import dialog: show the language, let the user confirm or pick EN/HR. |
| `{ type: 'importProject', source, lang?, run? }` | `import.done { slug, preview }` and `project.updated`. `lang` is a language code (`en`, `hr`, `de`, `ja`, ...: the built-in table plus `config/languages.md`) the user confirmed, else the detected one. Importing the same folder again keeps the project's settings, other editions and assets. `run: true` also starts the pipeline from `analyse`. |
| `{ type: 'listProjects' }` | `projects.listed { projects: ProjectSummary[] }` |
| `{ type: 'getProject', slug }` | `project.loaded { slug, project: ProjectDetail }`: `summary`, `settings` (project.md), `book` (vn.json: structure and the primary text), the last `build` and `lint` results, `resolvedTheme` (the chosen theme, or the automatic pick) and the job counts. |
| `{ type: 'updateProjectSettings', slug, patch }` | `project.updated`. `patch` is `{ theme?: string \| null, art?: { style, generator, editor, palette, stylePrompt, review }, music?: { engine, tracks }, voice?: { enabled, langs, provider, engines, voices } }`, each part merged. In `art`, `palette: null` and `stylePrompt: null` clear the field. The asset list follows (new voice references, engines of assets that have no file yet). |
| `{ type: 'deleteProject', slug }` | `project.deleted { slug }`. Removes the folder and the project's queued jobs. |

## The pipeline

`{ type: 'runPipeline', slug, from?, force? }` enqueues the director's `vn.pipeline.run` job, which enqueues the chain from `from`. The steps, in order:

`import` -> `analyse` -> `art` -> `music` -> `generate` -> `voice` -> `stage` -> `build` -> `lint`

- Default `from`: `analyse` (`import` when there is no vn.json). `import` imports the project's source folder again.
- Every step is restartable: `from: 'build'` only builds and lints; `from: 'generate'` generates what has no file (resumable) and then goes on. `force: true` plans the prompts and generates again for assets that already have a prompt or a file (locked and custom assets are never touched).
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
| voice | `vn.voice.plan`, `vn.voice.generate` (one per language) | voice-director | a fixed VibeTTS voice per character and language (VibeTTS) or uploaded references (ComfyUI) |
| stage | `vn.stage` | stage-director | `defaultCues` |
| build | `vn.build` | none | |
| lint | `vn.lint` | none | |

Jobs that never need a model run without a provider slot. Jobs for one project are named `<slug>--<task>--<unit>--r<run>`.

## Editions

| Command | Answer |
| --- | --- |
| `{ type: 'addEdition', slug, source, lang }` | `lang` is a language code (see `config/languages.md`; the MCP tool `vno_add_edition` also accepts none and detects it). Enqueues `vn.edition.add` (align deterministically) and, when beats are missing or extra, `vn.edition.align` (the edition-aligner). Announced by `project.updated` (`editions`). There is no machine translation: the edition is a book folder you translated. |
| `{ type: 'getEdition', slug, lang }` | `edition.loaded { slug, lang, edition }`: title, chapter titles, choice texts (`"<chapter>:<index>"`), endings, character names and `beats` (beat id -> text). |
| `{ type: 'updateEditionBeat', slug, lang, beatId, text }` | `edition.updated { slug, lang, beatId, text }`. Also keeps vn.json in step when `lang` is the primary language, and takes the beat off the missing list of the report. |
| `{ type: 'getAlignReport', slug, lang }` | `align.report { slug, lang, report: AlignReportView \| null }`: `matched`, `missing` (primary beat ids with no text), `extra` (translated texts with no beat), `nameMap`, `placeMap`, `warnings`. |

An edition never changes the asset list.

## Assets

`AssetView` is the manifest entry (`id`, `kind`, `prompt`, `negative`, `engine`, `seed`, `size`, `refs`, `versions[]`, `selected`, `source: 'generated' | 'custom'`, `customFile`, `locked`, `review`) plus `fileRel` (the file the build uses), `versionFiles` (version number -> relative path) and `orphaned` (the book no longer uses it; it is kept).

Asset ids: `bg_<place>_<time>`, `sheet_<char>`, `sprite_<char>_<expression>`, `cover`, `music_01..`, `voice_<char|narrator>`.

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
| `{ type: 'buildGame', slug }` | `vn.build` job. The result arrives as `build.result { result: BuildResult }` (`action: 'build'`, `ok`, `messages` = warnings, `gameDir`, `theme`, `placeholders` = asset ids drawn as placeholders, `translated`). Without the Ren'Py SDK the primary language is still built; `messages` says what was skipped. |
| `{ type: 'lintGame', slug }` | `vn.lint` job. `build.result` with `action: 'lint'`; `ok`, `messages` (the lint problems), `statistics`; `skipped: true` when the SDK is missing or the game is not built. |
| `{ type: 'runGame', slug }` | Starts the game. `game.started { slug, pid }`. |
| `{ type: 'androidPreflight', slug }` | `build.result` with `action: 'preflight'`: `ok`, and `messages` = what is missing (each with the action to take) or what was found. |
| `{ type: 'androidBuild', slug, bundle? }` | `vn.android` job. `build.result` with `action: 'android'`, `files` = the .apk / .aab in `projects/<slug>/android/`. |

The last build and lint results are in `ProjectDetail.build` / `.lint` (`build.json`, `lint.json` in the project folder).

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

- `vibetts` (the default): VibeTTS (`C:\projects\Personal\vibe-tts-flow`), the local TTS app, through its MCP server (`http://127.0.0.1:7723/mcp`, `config/voice.md`: `vibettsUrl`, `speed`, `format`, `chunkSize`, timeouts; `VNO_VIBETTS_URL` overrides the URL). Its voices are fixed (there is no voice design): the Kokoro voices (`af_heart`, ...) read English only, the 10 Supertonic voices (`supertonic:F1` .. `F5`, `M1` .. `M5`) read 31 languages including Croatian, but Supertonic is a download in VibeTTS Settings > Supertonic. The server only runs while VibeTTS runs: start it headless with `python -m vibetts --mcp-only` or switch on Settings > Agents (MCP). The engine calls `list_voices`, `synthesize_to_file` and `synthesize_batch`. When VibeTTS is not reachable the voice jobs fail with: `VibeTTS is not running or its MCP server is off - start it with python -m vibetts --mcp-only in C:\projects\Personal\vibe-tts-flow or enable Settings > Agents (MCP)`.
- `comfy`: a ComfyUI TTS workflow (`voice.engines`, language -> `custom:<workflow>`), cloning an uploaded reference clip. Chatterbox has no Croatian: that language is skipped with a message.

`voice.voices` maps a speaker key (a character key or `narrator`) to a voice per edition language: `{ mara: { en: 'af_heart', hr: 'supertonic:F2' } }`. `voice.englishEngine` (`kokoro`, the default, or `supertonic`) picks which engine plans and offers English voices; any other language always uses Supertonic (a Kokoro voice cannot read it). A character without a voice in a language uses the narrator's; so does narration. Projects saved before this stored one id per speaker: on load an `omni:*` id is dropped (plan the voices again), a `supertonic:*` id is set for `en` and `hr`, any other (Kokoro) id for `en` only.

| Command | Effect |
| --- | --- |
| `{ type: 'voiceStatus' }` | `voice.status { ok, url, error, supertonicInstalled, languages, english, other, voices }`. Never an error: an unreachable VibeTTS is `ok: false` with the message to show. `voices` are `{ id, label, engine, languages }`; `english` and `other` are the user's own default voices in VibeTTS (`{ engine, language, voice }`). |
| `{ type: 'planVoices', slug, overwrite? }` | Enqueues `vn.voice.plan`. The voice-director is shown the voices that exist per language and answers, per speaking character and the narrator, `{ speakerKey, gender, voices: { en?, hr? }, description, suggestedRef }`; the engine keeps a pick only if it is listed, reads that language and has the character's gender, and fills the rest deterministically by gender (spread over the cast, the narrator on a voice the cast does not use where it can; Supertonic has 5 voices per gender, so they repeat round-robin past that). Without an answer the gender comes from the bible. Per speaker and language, an existing voice that VibeTTS still lists is kept unless `overwrite`. When an edition other than English is planned and Supertonic is not installed the job fails with the hint to download it in VibeTTS Settings > Supertonic. The result is stored in `voice.voices`; clips of a changed (speaker, language) are forgotten. Does nothing when voice is off. |
| `{ type: 'setVoice', slug, speakerKey, lang, voice }` | Gives a speaker (a character key or `narrator`) the voice for one language. The voice must be listed by VibeTTS and read that language, else a `command.error`. Saves it in `voice.voices`, forgets that speaker's clips in that language and answers with `voice.preview`. |
| `{ type: 'previewVoice', slug, speakerKey, voice, lang? }` | Synthesizes a sample sentence (a line of that speaker in the language, else a fixed one) and answers with `voice.preview { slug, speakerKey, voice, file, rev, lang }`. `file` is `preview/voice-<key>.mp3` relative to the project folder (served by the file protocol); `rev` busts the player's cache. |
| `{ type: 'setVoiceRef', slug, charKey, file }` | (`comfy` provider) The reference clip of a character (`narrator` for the narrator): a custom, locked `voice_<charKey>` asset. `asset.updated`. A character without a clip uses the narrator's. |
| `{ type: 'generateVoice', slug, lang?, beatId?, limit? }` | Enqueues `vn.voice.generate` for the project's voice languages (or `lang`). Does nothing when voice is off. Clips go to `voice/<lang>/<beatId>.<ext>` (`mp3` for VibeTTS) and `voice/<lang>/index.json` keeps `{ hash, file, speaker }` per beat; a hash of text, voice, language, speed and format skips clips that did not change. With VibeTTS the beats go through `synthesize_batch` in chunks of `chunkSize` (20); the index is saved after each chunk, so a stopped job continues where it was, and `pipeline.progress` (`step: 'voice'`) carries `done/total`. `limit` makes at most that many clips per language (for a quick try). Non-primary languages speak the edition text. With the `comfy` provider, a language the workflow's mapping does not declare (Chatterbox has no Croatian) is skipped with the message `voice for hr skipped: the TTS workflow "..." has no hr voice (it supports: ...)`. |

The CLI: `yarn engine -- voice status`, `voice plan <slug> [--overwrite]`, `voice set <slug> <speaker> <lang> <voice>`, `voice <slug> [--lang hr] [--only <beatId>] [--limit n]`. The Ren'Py build emits `voice "voice/<lang>/<beatId>.<ext>"` for every beat that has a clip (the extension of the clip file is kept).

## Project folder

`projects/<slug>/`: `project.md` (settings), `vn.json`, `editions/<lang>.json`, `align-<lang>.json`, `uncertain.json`, `assets.json`, `assets/<id>/v<n>.<ext>` and `custom.<ext>`, `music.json` (the composer's plan), `cues.json` (the stage-director's cues), `pipeline.json`, `build.json`, `lint.json`, `summary.json` (the director's run summary), `voice/<lang>/`, `game/` (the Ren'Py project) and `log.md` (agent and job log of this project).

## CLI and MCP

The same operations run headless: `yarn engine -- help` lists the CLI (`books`, `import`, `projects`, `run`, `edition add`, `plan`, `generate`, `asset ...`, `build`, `lint`, `play`, `android`, `voice`, `comfy`, `themes`) and `yarn engine -- mcp` serves the MCP tools on stdio. See the README.

**MCP over HTTP.** The long-lived engine (the app's, or `node out/engine/index.js --mcp-only [--port N]` headless) serves the same tools at `http://127.0.0.1:7459/mcp` (Streamable HTTP, `src/engine/mcp/`; the tool list and the guide `vn-studio://guide` are in `docs/mcp-guide.md`). Its settings are `config/mcp.md` (`enabled`, `port`, `token`; `VNO_MCP_PORT` and `VNO_MCP_TOKEN` override), reloaded when the file changes.

- `mcpStatus` asks for the state; `saveMcpConfig {enabled, port, token?}` writes `config/mcp.md` (`token` left out keeps the old one, `''` clears it) and restarts the server when enabled, port or token changed. Both answer with `mcp.status {enabled, listening, url, error, port, tokenSet}`, which is also sent whenever the server starts, stops or fails to bind. The token itself is never sent.
- Every engine takes the data-folder lock `engine.lock` (`{pid, startedAt, mcpUrl}`, created exclusively; one whose pid is gone is replaced) and releases it when it stops. A second engine (CLI, `yarn mcp`, the app) refuses with "VN Studio is already running on this data folder (pid N). Use its MCP at <url> or close it." and exits with 1; `yarn engine -- mcp` (stdio) relays to the url in the lock instead.

### Art style words

`ProjectSettings.art.stylePrompt` (optional string, user-editable with `updateProjectSettings { patch: { art: { stylePrompt } } }`) is the style prefix of every image prompt. When it is empty the engine derives one from the format, genre and art mode (kids formats: soft watercolor; pixel mode: pixel art; others by genre). The bible's `## Style` section is a writing note and is never put into an image prompt. Show the derived default as the field's placeholder.

## Studios (VNO-02)

- Commands: `studiosStatus` (answers `studios.status`: Pixel Studio and Chiptune Studio, reachable or not, with the start hint) and `openInStudio {slug, id}` (answers `studio.opened`; each save in the studio makes a new custom, locked version, announced by `asset.updated`).
- Settings (`updateProjectSettings`): `art.pixelProvider` (`vno` | `pixel-studio`), `art.provider` (`comfy` | `pixel-studio-draw`), `art.pixel {width, height, dither, outline}`, `music.provider` (`comfy` | `chiptune`; missing: chiptune for pixel books), `music.chip`. `null` clears an optional one.
- Asset versions may carry `loopStartSec`, `loopEndSec`, `songFile` (Chiptune Studio), `nativeFile` (Pixel Studio, the PNG at the pixel size), `warnings` and `custom`.
- Config: `config/studios.md` (URLs, app folders, timeouts); `VNO_PIXEL_STUDIO_URL`, `VNO_CHIPTUNE_STUDIO_URL` override the URLs. The studio contract is in `.claude/tickets/VNO-02-chiptune-and-pixel-studio/contracts.md`.
- CLI: `settings <slug> ...`, `studios status`, `studio open <slug> <assetId> [--wait]`.
- Seed refresh: `.seed-hashes.json` in the data folder records the seed hashes; an untouched seeded file is updated on upgrade, an edited one is kept and listed as an update available (an `engine.warning` at start).
