# VNO-01 — Visual Novel Studio: Scriptorium book → Ren'Py visual novel (desktop + Android)

> On approval, copy this plan to `C:\projects\Personal\visual-novels-orchestrator\.claude\tickets\VNO-01-visual-novel-pipeline\plan.md` (global CLAUDE.md rule) and implement it with the global `implement` skill on branch `VNO-01_visual-novel-pipeline`.

## Context

Scriptorium (`C:\projects\Personal\scriptorium`) writes visual-novel books as scripts and leaves the art to "a separate app" (`docs/visual-novel.md`). This repo becomes that app: **VN Studio**. It is an Electron + TypeScript desktop app, like Scriptorium and new-noddy, where a small team of AI agents takes a book through the pipeline and outputs a **Ren'Py** game for desktop and **Android**.

**What it does:**
- **Book types:**
  - Linear: `visual-novel`, `kids-visual-story`. Each chapter flows into the next.
  - Choice books: `choice-visual-novel`, `kids-choice-visual-story`, and later the prose `gamebook` / `kids-choice-book`. Chapters end in a menu ("go to street 1 / street 2"), read from `outline.md` → `chapters[].choices[{text,to}]`. A chapter with no choices is an ending.
- **Languages:** a book is imported in **English or Croatian**. The language is detected and you can confirm or override it. Later you can add a **translated edition** that you translated yourself. It reuses every asset and only replaces the text. The app does **no machine translation**.
- **Models:** local models plus every provider Scriptorium supports (LM Studio, Strata, DeepSeek, Anthropic, Gemini, OpenRouter, other OpenAI-compatible APIs). A Models page and per-agent model choice work like Scriptorium's.
- **Agents:** a few roles, only those this app needs, which orchestrate the pipeline.
- **Art:** ComfyUI, with a choice of generator model and edit model and an optional pixel-art post-process. Any asset can be replaced by hand, and you can switch between versions.
- **Music:** calm instrumental (ACE-Step).
- **Voice:** optional TTS for each book (ComfyUI TTS Audio Suite).
- **Themes:** selectable game themes.

### What was found (reuse, don't rebuild)

- **Book format:** `scriptorium/docs/visual-novel.md`.
  - Files: `book.md`, `bible/bible.md` (`## Characters/Places/Style` bullets), `outline.md` (the chapter map), `chapters/ch-NN.md`, `cover-brief.md`.
  - Regexes are at lines 54-56; the JSON shape is at lines 142-172.
  - Branch rules: `src/engine/pipeline/branches.ts:27-49` `checkBranches`.
  - Test book: `~/Scriptorium/books/the-soother-that-fell-into-dragon-land` (kids choice book, 7 chapters).
  - Quirks real output has: a `Narration:` prefix, a description after the time on `SCENE:`, props in `ON SCREEN:`, and a wrongly flagged ending in the outline.
- **Engine core to fork, the way new-noddy did** (plain copy, no shared package; copy from current Scriptorium, not new-noddy). Paths are under `scriptorium\`:
  - **Models:** `src/engine/models/{types,sse,keys,limiter,openaiCompat,anthropic,gemini,registry,router,mock}.ts` and `src/engine/budget/spend.ts`.
    - Router fallback, retries and limits: `router.ts:87-220`.
    - LM Studio discovery and loading: `openaiCompat.ts:140-210`.
    - Keys: env var, then Windows keyring (`keys.ts`; change `KEYRING_SERVICE` to `vn-studio`).
  - **Queue, agents and store:** `src/engine/queue/{jobs,scheduler}.ts` (`Scheduler.register`, `JobContext`), `src/engine/agents/agents.ts`, `src/engine/logs/logs.ts`, `src/engine/store/{atomic,dataFolder,watcher}.ts`.
  - **LLM helpers:** `src/engine/pipeline/{llm,prompts}.ts`. `chatJson` + zod with a repair retry is at `llm.ts:69-111`; `loadPrompt`/`render` are in `prompts.ts`.
  - **Host:** `src/engine/{index,transport,engine,cli}.ts` (trim `engine.ts` to registry, router, scheduler, models, secrets and VN commands), `src/main/{index,engineClient,files}.ts`, `src/preload/index.ts`, `src/shared/{md,protocol,schemas}.ts`.
  - **UI:** `src/renderer/ui/ModelsDialog.tsx`, the role and agent pickers from `AgentPanel.tsx`, the key field from `Settings.tsx`, `src/renderer/{api,hostApi}.ts`, `src/renderer/store/*`.
  - **Seed:** `seed/config/{providers,roles,models,settings,budget}.md`, plus the agent and prompt folder conventions.
  - **Build config:** `vite.engine.config.ts`, `electron.vite.config.ts`, `tsconfig*.json`, `eslint.config.mjs`, `vitest.config.ts`.
  - **Tests:** `tests/{models,scheduler,helpers}.test.ts`.
  - **Missing piece:** Scriptorium has no image input (`ChatMessage.content` is a string). Add optional image parts for the vision critic.
- **ComfyUI client:** `C:\projects\Local\DSH\dsh-comfyui\lib\comfy.js` (`/prompt`, `/history`, `/view`, `/upload/image`, `/free`, `/queue`, lanes) and `lib\graphs.js` (engines qwen-image-2.1 / turbo / edit, z-image-turbo, krea2-turbo, ace-step-v1 / instrumental, yue2, minimax-music-3). Neither depends on DSH.
  - `tools\verify.mjs` shows them used standalone. Port both to TypeScript, using the source copy, not `~/.dsh`.
- **ComfyUI install:** port 8188. All model files are present, and TTS-Audio-Suite and fill-chatterbox are installed.
  - Workflows are in `...\ComfyUI\user\default\workflows\`, for example `audio-chatterbox_tts_multilingual.json` and `audio_ace_step_1_t2a_instrumentals.json`. They are in UI format; `C:\projects\Local\DSH\.tools\ui-to-api.mjs` converts them to API format.
- **Pixel palettes:** `pixel-art-generator/seed/palettes/`.
- **Not used:**
  - book-translator: no translation needed.
  - Pixel Studio and Chiptune Studio: they need their GUIs open.
  - vibe-tts-flow: Kokoro has no Croatian.
  - new-noddy: reference only.

## Architecture

```
Electron main ─ utilityProcess ─▶ engine (also runs headless: `yarn engine`, CLI, MCP)
  engine = model registry/router + scheduler/job queue + agents + VN pipeline handlers
                                   + ComfyUI client + Ren'Py builder
renderer = Library · Book (pipeline, editions, assets, voice, theme) · Models · Agents · ComfyUI · Settings
```

**Data folder:** `~/VisualNovels`, override with `VNO_DATA`. Contents:
- `config/*.md`: models, roles and settings as in Scriptorium, plus `comfy.md`, `art.md`, `music.md`, `renpy.md` (YAML frontmatter, reloaded live).
- `agents/*.md`, `prompts/<role>/*.md`: copied from `seed/` without overwriting, so they can be edited.
- `projects/<slug>/`:
  - `project.md`: settings for this book: `primaryLang`, `editions[]`, `theme`, `art.style`, engines, `voice.enabled`;
  - `vn.json`: structure plus the primary text;
  - `editions/<lang>.json`: text keyed by beat id;
  - `assets.json`;
  - `assets/<id>/v1.png …`, `custom.png`;
  - `voice/<lang>/…`;
  - `game/`: the Ren'Py project.

**Text and structure are kept apart.** `vn.json` holds structure and asset references: chapters, scenes, beats with stable ids `ch01.s02.b007`, speaker keys, expression, background and sprite ids. The words live in editions keyed by beat id. Assets hang off the structure, so a new edition reuses all of them.

## Agents (seed/agents + seed/prompts)

Each agent has its own model, chosen in the Agents panel. The fallback order comes from `roles.md`, using the same aliases as Scriptorium (`paid`, `strata`, `lmstudio`).

| Role | Job | When |
| --- | --- | --- |
| **director** | Orchestrates. It plans each book's job graph (import → analyse → art plan → generate → review → build) and decides re-runs after failures or edits. It is mostly deterministic handlers, with an LLM only for summaries and decisions about what to redo. | always |
| **script-analyst** | Normalises what the deterministic parser can't settle. It maps SCENE text to (place, time), splits props from cast, maps free expressions to the canonical set, and matches names to the bible. Works on English or Croatian text. | import / new edition |
| **art-director** | Writes the **English** ComfyUI prompts from the bible, style and genre, even for a Croatian book: background, character sheet, expression and cover prompts. It keeps a style prefix and fixed negatives, and picks sizes. | art plan |
| **art-critic** (optional, vision model) | Looks at each generated image against its prompt and character sheet: does it match, has the face drifted, are there stray words in the image. It approves the image or sends a revised prompt for a retry, up to N times. Needs a model with image input (e.g. a Qwen-VL in LM Studio). | after generate |
| **composer** | Writes calm music prompts (genre tint, instruments, tempo) and assigns tracks to chapters. | music |
| **stage-director** | Decides sprite slots (left/center/right), entrances and exits, transitions, music cues and pauses for each scene. | build |
| **edition-aligner** | Aligns an added translated edition to the primary structure, beat by beat. It maps translated names to character keys and flags beats that are missing or extra. | add edition |
| **voice-director** (only when voice is on) | Picks a voice reference or voice-design prompt for each character and the narrator, and tags lines with emotion. | voice |

Every agent call goes through `chatJson` with a zod schema. Handlers are registered with `sched.register('<task>', …)`, following the pattern in `scriptorium/src/engine/pipeline/handlers.ts:190`.

## Phases

### Phase 0 — Fork the engine core and scaffold the app
- Copy the files listed above from Scriptorium. Rename the keyring service and `window.scriptorium` to `vn-studio` / `window.vnstudio`.
- Strip the book-publishing pieces: pipeline stages, covers, Kindle, EPUB.
- Keep `yarn typecheck | lint | test | dev | engine | key:set`.
- Seed `config/`: copy `providers.md` (all providers, local ones included), `roles.md` with the new roles, `settings.md`, `budget.md`.
- Add `ChatMessage` image parts: openai-compat `image_url` (data URI), Anthropic `image` blocks, Gemini `inlineData`. Add a `vision: true` flag per model in `providers.md`/`models.md`. The art-critic is only offered vision-capable models.
- Renderer shell: Library, Book, Models (port of `ModelsDialog`), Agents (port of the `AgentPanel` pickers), Settings (keys, data folders, Scriptorium path), ComfyUI.

**Phase 0 status (done)**
- [x] Engine core forked from current Scriptorium (models, budget, queue, agents, logs, store, `pipeline/{llm,prompts}`, host `index/transport/engine/cli`, main, preload, shared `md/protocol/schemas`). `engine.ts` trimmed to registry, router, scheduler, agents, model/secret/model-choice commands, logs; book publishing, memory, research, topics, ideas, covers, Kindle, EPUB, reader removed. `registerVnHandlers(sched, deps)` stub in `src/engine/vn/handlers.ts`.
- [x] Renames: keyring service `vn-studio`, `window.vnstudio`, data folder `~/VisualNovels` (`VNO_DATA`, `--data`), seed override `VNO_SEED`, app name "VN Studio".
- [x] Seed: `config/{providers,roles,models,settings,budget}.md` (all providers kept, search providers and embedding model dropped; `settings.md` gained `scriptoriumData`), 8 roles, `agents/<role>-default.md`, `prompts/<role>/.gitkeep`.
- [x] Vision: `ChatMessage.content` is `string | ChatPart[]`; mapping in openaiCompat, anthropic, gemini; `vision` flag in provider/model schemas, `ModelInfo.vision`, `ModelSummary.vision`, `candidates(role, { visionOnly })`; the Agents page offers only vision models to the art-critic.
- [x] `src/shared/vn.ts` (zod schemas + inferred types, exactly the agreed contract).
- [x] Renderer shell: Library, Book, ComfyUI (placeholders), Models (port of ModelsDialog), Agents (agent and role pickers), Settings (provider key, data folder, Scriptorium path).
- [x] README, configs, tests.
- Verification: `yarn install` ok; `yarn typecheck` clean; `yarn lint` clean; `yarn test` 4 files / 68 tests pass (models, scheduler, vision mapping, vn schemas); `yarn build` ok; `yarn engine -- probe --model lmstudio/...` runs headless (providers unreachable, exits 1 with `ECONNREFUSED` as expected); `node out/engine/index.js --data <tmp>` seeds the folder and starts the 8 agents. The Electron GUI was not launched.
- Deviations: protocol keeps the scheduler's `handover` event and `pin`/`book` on agents (the copied scheduler uses them); the scheduler's `isBookPaused` hook stays but nothing sets it, so the "paused book" scheduler test and the `pauseBook` command were dropped. `tests/helpers.ts` trimmed to the mock-engine helpers. `book` in jobs/budget/logs means "project": per-project logs go to `projects/<slug>/log.md`. Main serves project images through a `vnstudio-file://` protocol (`projects/<slug>/assets|preview`). Settings key is camelCase `scriptoriumData` as specified.

### Phase 1 — Import, language, editions
- **Library:** list Scriptorium books (`~/Scriptorium/books/*`, `script: true`, `stage: published`, plus the prose choice formats). You can also import a book folder from anywhere, such as a Croatian manuscript you wrote in the same format.
- **Script parsing:**
  - Port the SCENE, CAST and LINE regexes and `checkBranches` (problems are warnings).
  - Strip a `Narration:` prefix.
  - Accept Croatian keyword aliases: `SCENA:`, `NA EKRANU:`, `PRIPOVJEDAČ:`/`NARACIJA:`. The LINE regex's `\p{Lu}` already covers Č, Ć, Đ, Š and Ž.
  - The deterministic parser runs first. Lines it is unsure about go to **script-analyst** in batches.
- **Language detection:** score text against Croatian markers (diacritics č/ć/đ/š/ž, common function words such as je, i, se, da, u, na, što, nije) and English ones (the, and, is, of). The result is shown with a confidence, and you confirm it or pick EN/HR in the import dialog. Stored as `primaryLang`.
- **Import output:** `vn.json` (structure, `kind: linear|choice`, character and place keys) and `editions/<primaryLang>.json`.
- **Add edition:** in Book → Editions → "Add translated edition", pick a second book folder or file and its language.
  - The deterministic aligner works chapter → scene → beat by position and type. **edition-aligner** settles mismatches and maps names: "Petra" can stay "Petra", "Mango" can become "Mango", and place names can be translated.
  - The result is `editions/<lang>.json`. An alignment report lists missing and extra beats, and you can fix single beats in the UI.
  - Choice texts, chapter titles, ending texts and character display names are part of the edition.
- **Asset list:** one background per (place, time); one character sheet per character; one sprite per (character, canonical expression) used; a cover; music tracks. Assets come from `vn.json`, so they are independent of language.

### Phase 2 — Asset generation (`src/engine/comfy/`, `src/engine/assets/`)
- **ComfyUI client:**
  - Port `comfy.js` and `graphs.js`, keeping the engine registry and lanes.
  - Add direct width/height.
  - Add a **custom-workflow engine**: an API-format JSON in `config/workflows/<name>.json` plus a `<name>.map.yaml` that says which node inputs get the prompt, negative, width, height, seed, reference image, text, language and voice reference, and which node is the output.
  - New generators and the TTS engines plug in without code changes.
- **ComfyUI page:** lanes, a status and inventory panel (as in DSH), Free VRAM, a generator picker (qwen-image-2.1 / turbo / z-image-turbo / krea2-turbo / custom), an editor picker (qwen-image-2.1-edit / custom), a music engine picker, and pixel mode with a palette.
- **Art plan:** **art-director** writes `assets.json`. Each entry has `{id, kind, prompt, negative, engine, seed, size, versions[], selected, source: generated|custom, locked, review}`.
- **Generate** (resumable job queue; `locked` and `custom` assets are skipped):
  - **Backgrounds:** text-to-image at landscape size, cover-cropped and resized with sharp to the project resolution, saved as webp.
  - **Character sheets:** portrait, full body, front view, plain light background. The sheet is the identity reference.
  - **Sprites:** the edit engine with the sheet as reference ("same character, <expression>, plain white background"). Background removal through the ComfyUI-RMBG custom node, which needs installing (BiRefNet/RMBG-2.0); a sharp flat-white key is the fallback. Then trim and scale to about 90% of screen height.
  - **Cover:** from `cover-brief.md`.
  - **Music:** prompts from **composer**, rendered with ACE-Step instrumental (calm, soft piano and strings, ambient, slow, no vocals). 2-3 tracks of 90-120 s: a main-menu theme plus chapter tracks.
  - **Pixel post-process:** downscale, quantise to a palette from pixel-art-generator, nearest-neighbour upscale. The Ren'Py build sets `config.nearest_neighbor = True`.
  - **Review:** when it is on, **art-critic** approves or retries.
- **Asset gallery:**
  - Every asset shows its versions.
  - You can **Regenerate** (with optional prompt, engine or seed edits), **Upload replacement** (becomes `custom`, locked), **Pick version**, **Lock/Unlock**, and **Open folder**.
  - Rebuilding always uses the selected or custom file.

### Phase 3 — Ren'Py build, themes, run, Android (`src/engine/renpy/`, `templates/renpy/`, `themes/`)
- **Settings:** the Ren'Py SDK path, resolution 1920x1080, and image format webp.
- **Template:** `templates/renpy/` is a minimal Ren'Py 8 project made once from the SDK default. It adds a language button on Preferences for the editions that exist, and a "The End" screen.
- **Build:**
  - Copy the selected assets using Ren'Py auto-image names (`bg harbour_wall_dusk.webp`, `mara worried.webp`).
  - Generate `characters.rpy` and one `chNN.rpy` per chapter in the **primary language**. Script lines follow the stage-director cues:
    - **Chapter start:** `label ch_01:`, then `play music … fadein 2.0 loop`.
    - **Scenes:** `scene bg … with dissolve`, then `show <char> <expr> at <slot>`, then `hide` when a character leaves.
    - **Text:** narration as `"…"`, dialogue as `mara "…"`, with `"`, `[`, `{` and `%` escaped. Emphasis becomes `{i}` and `{b}`.
    - **Scene breaks:** `---` becomes `scene black with fade`.
  - **End of chapter:**
    - Linear books: `jump` to the next chapter.
    - Choice books: `menu:` with `"text": jump ch_0N`.
    - Endings: `call screen the_end(...)`, then `return`.
- **Other editions:**
  - Run `renpy.exe game translate <language>` to create `tl/<language>/*.rpy`.
  - Fill each stub by mapping its source line to its beat id. The emitter writes a `# beat:<id>` comment above every line so the match is exact.
  - Put menu, title, UI and character-name strings in a `translate <language> strings:` block.
  - Set `config.language` to the primary language.
- **Themes:**
  - `themes/<name>/theme.yaml`: colours, fonts (OFL fonts covering č/ć/đ/š/ž), textbox and namebox, choice buttons and transitions, plus optional 9-slice frame PNGs.
  - Built-ins:
    - `classic-dark`;
    - `storybook`: kids, bright, large text;
    - `parchment`;
    - `noir`;
    - `pixel-retro`: pixel style.
  - The theme is picked automatically from format, genre and style, and you can override it on the Book page.
  - The Theme picker shows a live preview of a textbox and menu. The build writes `gui.rpy` overrides and `style` blocks, then copies the fonts and frames.
  - Custom themes are folders copied from a built-in.
- **Actions:**
  - **Lint:** `renpy.exe game lint`.
  - **Run:** launch the game.
  - **Android:** run the Ren'Py launcher `android_build`. It checks the SDK and keys first. One-time setup (Ren'Py launcher → Android → install SDK and create keys, JDK 21) is documented in the README.

### Phase 4 — Voice (optional per book)
- **Off by default.** Turn it on in `project.md`: `voice.enabled`, plus `voice.langs` limited to the editions you have, and an engine per language. When voice is off, nothing voice-related is generated or emitted.
- **Engines:** TTS Audio Suite and Chatterbox workflows as custom workflows, starting with `audio-chatterbox_tts_multilingual.json` (map text, language and `LoadAudio` reference).
  - **Check first:** confirm the Chatterbox multilingual language list has `hr`. If it doesn't, use another Suite engine for Croatian (OmniVoice, IndexTTS-2). The Suite's language mapper does know `hr`.
- **Voices:**
  - **voice-director** picks a voice reference or design prompt for each character and the narrator.
  - Voice references are assets, so you can upload, replace and lock them.
  - Clips are written per beat to `voice/<lang>/<beatId>.ogg`. A run is resumable, and a hash of text, voice and engine skips unchanged clips.
- **Ren'Py:** a `voice "…"` line before each beat in the primary language, and in the `tl/<lang>` blocks for other editions. A voice-volume slider is added to Preferences.

### Phase 5 — Headless and agent access
- **CLI** (`yarn engine -- …`): `books`, `import`, `edition add`, `plan`, `generate`, `asset replace|pick|regen`, `build`, `lint`, `run`, `android`, `voice`.
- **MCP server** (`yarn engine -- mcp`, stdio): the same operations as tools, so Claude Code, DSH and Scriptorium-style agents can drive the studio.

## Critical files (new unless noted)
- Forked from Scriptorium: `src/engine/{models,queue,agents,logs,store,budget}/**`, `src/engine/pipeline/{llm,prompts}.ts`, `src/engine/{index,transport,engine,cli}.ts`, `src/main/**`, `src/preload/**`, `src/shared/{md,protocol,schemas}.ts`, `src/renderer/ui/{ModelsDialog,AgentPanel,Settings}.tsx`, configs.
- New engine code: `src/engine/vn/{reader,bible,outline,script,lang,align,branches,expressions}.ts`, `src/engine/vn/handlers.ts` (the director's job graph).
- ComfyUI and assets: `src/engine/comfy/{client,graphs,custom-workflow}.ts`, `src/engine/assets/{plan,generate,postprocess,manifest}.ts`.
- Ren'Py, themes and voice: `src/engine/renpy/{emit,escape,tl,build,android}.ts`, `src/engine/themes/*.ts`, `src/engine/voice/*.ts`, `src/engine/mcp/server.ts`.
- Seed: `seed/agents/{director,script-analyst,art-director,art-critic,composer,stage-director,edition-aligner,voice-director}.md`, `seed/prompts/<role>/*.md`, `seed/config/*.md`.
- Templates: `templates/renpy/**`, `themes/*/`, `seed/workflows/chatterbox-multilingual.{json,map.yaml}`.
- Renderer pages: `Library`, `Book` (Pipeline, Editions, Assets, Theme, Voice, Build), `Comfy`.

## Verification
1. **Unit tests (vitest):**
   - Parser fixtures from `the-soother…` plus a linear fixture, a quirks fixture and a Croatian fixture (HR keywords and diacritics).
   - Language detection on EN and HR samples.
   - Aligner: one HR edition matching exactly, and one with one beat missing.
   - `checkBranches`, expression mapping and Ren'Py escaping.
   - Emitter snapshots for a linear and a choice book.
   - The forked `models` and `scheduler` tests still pass.
   - `chatJson` against the mock provider for each agent schema.
2. **Models:** the Models page detects LM Studio and Strata models. Assign a local model to script-analyst and a paid one to art-director, then run an import. The logs show which model each job used and fallback when one is down.
3. **Import and editions:**
   - The soother book imports as EN, with 7 chapters, choices matching `outline.md` and 3 endings.
   - Import a Croatian copy as the primary of a test project: it is detected as HR and asset prompts are still in English.
   - Add an HR edition to the EN book: the alignment report is clean and the asset count is unchanged.
4. **ComfyUI** (8188 running): generate one background, one sheet, one sprite and one music track. The sprite has alpha. Upload replacement, then rebuild: the custom file is used. Art-critic with a vision model approves or retries.
5. **Ren'Py:** build and lint are clean. Run the game: both chapter-1 choices work, an ending shows "The End", music loops, and switching language in Preferences turns text and menus Croatian on the same images.
6. **Linear book:** build and play one as well.
7. **Themes:** build with `storybook`, then `noir`. The look changes and HR diacritics render.
8. **Pixel mode:** images are quantised and drawn with nearest-neighbour.
9. **Voice:**
   - When off: no `voice` lines and no clips.
   - When on for EN: 3 beats get clips that play, and the slider works.
   - When on for HR: clips play after switching language.
10. **Android:** `android` produces an APK that installs and plays one path.
11. **MCP:** `claude mcp add` the server, then list books and build one from Claude Code.

## Implementation progress (orchestrator)

Branch: `VNO-01_visual-novel-pipeline` (from `origin/master`). Ren'Py SDK 8.5.3 installed at `C:\projects\Local\renpy\renpy-8.5.3-sdk`.

- [x] Phase 0: engine core forked, vision parts, shared contract `src/shared/vn.ts`.
- [x] Phase 1 (deterministic core): `src/engine/vn/*`. The soother book imports as EN: 7 chapters, choices as in the outline, 3 endings, 10 backgrounds, 19 sprite pairs.
- [x] Phase 2 (core): `src/engine/comfy/*` and `src/engine/assets/*`. Live z-image-turbo smoke test OK.
  - Background removal falls back to a flat-white key, because `models/background_removal` is empty.
- [x] Phase 3: `src/engine/renpy/*`, `src/engine/themes/*`, `templates/renpy`, 5 themes with OFL fonts covering HR glyphs.
  - Real `renpy lint` is clean for linear and choice books, EN+HR, and voice on/off.
  - The Ren'Py testcase runner played the choice book through to the end and switched the language to Croatian.
  - Android: CLI is `renpy.exe <sdk>/launcher android_build <project> --destination <dir>`. Preflight is done; RAPT is not installed yet.
- [x] Phase 4 (Ren'Py side): `voice` statements only when enabled.
  - **Finding:** Chatterbox multilingual has no Croatian (23 languages). The user decided Croatian TTS comes later, once a ComfyUI engine supports it.
- [x] Integration: agents (8 roles, prompts in `seed/prompts`), director job graph (`vn/handlers.ts`), `VnService`, project store, protocol (`docs/protocol.md`), CLI, MCP (stdio, 11 tools), voice generation through a custom TTS workflow.
  - E2E on the soother book with real ComfyUI assets: build and lint clean (381 dialogue blocks, 4 menus).
- [x] Art-prompt fix found in review:
  - Problem: the bible `## Style` is a writing note and leaked into image prompts; 'character design sheet' produced turnaround collages; backgrounds contained characters.
  - Fix: `art.stylePrompt` setting with format/genre defaults, visual-only looks, empty-environment backgrounds, single-figure sheets and sprites, and `keepMainSubject` post-process.
  - Re-render verified by eye.
- [x] Renderer:
  - Pages: Library + Import dialog (language detect/confirm), Book tabs (Pipeline, Editions, Assets, Look, Voice, Build), ComfyUI, Settings (editable Ren'Py SDK path).
  - Audio plays with Range support, and theme fonts show in the preview.
  - Checked in the running app through CDP; screenshots in `.claude/temp/ui-shots/`.
- Final checks: `yarn typecheck` clean, `yarn lint` clean, `yarn test` 344/344, `yarn build` OK.
- Not run: real LLM agent answers (no LM Studio/Strata running), art-critic with a vision model, TTS clip generation, Android APK build (RAPT not installed), packaged electron-builder app.
- Checks after Phases 0-3: `yarn typecheck` clean, `yarn lint` clean, `yarn test` 272/272.

## Follow-up 2026-10-15 (user request): BiRefNet background removal + VibeTTS voices

The user added to ComfyUI the BiRefNet model (`models/background_removal/birefnet.safetensors`) and two workflows, `image_qwen_image_2_1_background_removal` and `utility_birefnet_remove_background`. VibeTTS (`C:\projects\Personal\vibe-tts-flow`) now has an MCP server (`http://127.0.0.1:7723/mcp`, off by default) with OmniVoice, which supports English and Croatian and can create voices from a description. The user allowed updating that repo.

- Contract (done by orchestrator): `art.bgRemoval: birefnet | qwen-edit | key` (default birefnet); `voice.provider: vibetts | comfy` (default vibetts); `voice.voices: speakerKey -> omni:<name>`.
- [x] **A — Background removal:** BiRefNet is the default (polarity checked live), qwen-edit gives real alpha with BiRefNet as a safety net, flat key is the fallback, and the raw edit output is kept for reprocessing. Petra's sprites were re-rendered clean.
  - ComfyUI BiRefNet is the default for sprites, verified live (mask polarity).
  - Optional qwen-edit pass, mirroring the user's workflow.
  - Flat key stays as the fallback.
  - Re-render Petra's sprites.
- [x] **B — VibeTTS voices:** done. Live: 6 voices designed from the bible, 5 EN clips, one HR line in Petra's voice, and the build emits `voice` lines with a clean lint. vibe-tts-flow got `synthesize_batch`, `delete_voice` and `--mcp-only`.
  - VNO voice provider `vibetts`: the voice-director designs one OmniVoice voice per character plus the narrator from bible looks and voice notes (`create_voice`, vocabulary gender/age/pitch/style). The same voice serves EN and HR, with `lang` per call.
  - Clips per beat via `synthesize_to_file`.
  - The Voice tab lets you pick or create voices.
  - vibe-tts-flow branch `VTF-05_vn-studio-voices` (from `origin/master`): add what VNO needs, such as a batch synthesis tool and voice deletion, with tests.

- Checks after the follow-up: VN Studio typecheck and lint clean, `yarn test` 389/389; vibe-tts-flow pytest 362 passed, 1 skipped.
- Next milestone: `.claude/tickets/VNO-02-chiptune-and-pixel-studio/plan.md`.
