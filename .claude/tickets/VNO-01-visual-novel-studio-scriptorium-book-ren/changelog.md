# Changelog — VNO-01

## 2026-10-15 (follow-up) — BiRefNet sprite cut-outs and VibeTTS voices

### visual-novels-orchestrator, branch `VNO-01_visual-novel-pipeline` (uncommitted)
- **`src/shared/vn.ts`:** new settings `art.bgRemoval` (birefnet | qwen-edit | key, default birefnet), `voice.provider` (vibetts | comfy, default vibetts) and `voice.voices` (speaker → `omni:<name>`).
- **`src/engine/comfy/client.ts`, `seed/config/comfy.md`:** new `backgroundRemovalModel` setting. It is used only if ComfyUI lists the model, otherwise the first listed model is used.
- **`src/engine/assets/generate.ts`, sprite cut-out:**
  - BiRefNet by default; Qwen edit "Remove the background" (real alpha, with BiRefNet as a safety net); flat key as the fallback.
  - The raw edit output is kept as `v<n>.raw.*`, and a `reprocess` option re-runs only the cut-out.
- **`src/renderer/ui/book/LookTab.tsx`:** a "Background removal" select.
- **`src/engine/voice/*` (new):**
  - `vibetts.ts`: the VibeTTS MCP HTTP client.
  - `config.ts` with `seed/config/voice.md`.
  - `vocab.ts` (allowed voice-description words, bible fallback) and `jobs.ts` (plan, generate, design, preview).
  - `src/shared/voice-vocab.ts`.
- **`src/engine/vn/agents/voice-director.ts`, `seed/prompts/voice-director/plan_voices.md`:** voices designed from the allowed vocabulary.
- **Handlers and service:** `vn.voice.plan` and `vn.voice.generate` for both providers. For VibeTTS, clips are made in batches of 20, are resumable, and are skipped when unchanged; the same voice serves EN and HR.
- **Protocol:**
  - New commands `voiceStatus`, `planVoices`, `designVoice` and `previewVoice`; `generateVoice` gains `limit`.
  - Wiring: `engine.ts` routes the commands and the renderer store handles the events.
- **CLI:** `voice status|plan`, and `voice --limit`.
- **`src/renderer/ui/book/VoiceTab.tsx`:**
  - Provider choice and VibeTTS status.
  - A voice for each speaker, with design, listen and "try another".
  - Plan and Generate buttons with progress.
- **Tests:**
  - New: `voice-vibetts-client`, `voice-vocab`, `voice-vibetts-jobs`, `ui-voice-vibetts`.
  - Extended: assets/comfy cut-out cases.
  - Fixture updates.

### vibe-tts-flow, branch `VTF-05_vn-studio-voices` (from `origin/master`, uncommitted; the agent staged the changes)
- **`vibetts/mcp_server.py`:**
  - New `synthesize_batch` tool: up to 500 items per call, one export slot, the model stays loaded, and each item gets its own result.
  - New `delete_voice` tool.
- **`vibetts/app.py`:** `python -m vibetts --mcp-only [--port N]`, a headless MCP server with no tray, hotkey or window.
- **`README.md`:** documents the new tools and headless mode.
- **Tests:** `tests/test_mcp_server.py`, `tests/test_app.py`.
- **Ticket notes:** `.claude/tickets/VTF-05-vn-studio-voices/plan.md`, `changelog.md`.

### Verification
- **Passed:**
  - VN Studio typecheck and lint clean; 389/389 tests.
  - vibe-tts-flow pytest: 362 passed, 1 skipped.
  - BiRefNet live: polarity verified, and Petra's sprites re-rendered and checked by eye.
  - Qwen edit live: it returns real alpha.
  - VibeTTS live (headless on port 7733):
    - 6 voices designed from the bible.
    - 5 English clips: 5 clips in about 15 s.
    - Croatian: one line in Petra's voice, 4.2 s.
  - Build emits the `voice` lines, and Ren'Py lint is clean.
- **Not run:**
  - Real LLM voice-director answers (no model was available, so the bible fallback was used).
  - The VoiceTab in the running app.
  - A full-book voice run (376 beats remaining).

### Follow-ups
- **VibeTTS app:** the installed `D:\Programs\VibeTTS\VibeTTS.exe` is an older build without `synthesize_batch`. Rebuild it, or run `python -m vibetts --mcp-only` from the repo.
- **Old data folders** keep their old seeded prompts (including `plan_voices.md`). VNO-02 plans a seed refresh.
- **Leftover assets:** `voiceRef` assets are still derived for VibeTTS projects. They are hidden in the UI and harmless.
- **Next milestone:** Chiptune Studio and Pixel Studio, see `../VNO-02-chiptune-and-pixel-studio/plan.md`.

## 2026-10-15 — VNO-01: VN Studio, first full implementation

VN Studio is an Electron + TypeScript app. It turns a Scriptorium visual-novel book (linear or with choices, English or Croatian) into a Ren'Py game, with art and calm music from ComfyUI, selectable themes, translated editions that reuse every asset, optional voice, and Scriptorium-style models and agents.

### Repository: visual-novels-orchestrator, branch `VNO-01_visual-novel-pipeline` (from `origin/master`)

**Status:** uncommitted, about 338 new files. `README.md` is modified. The user's own `repositories.md` is untouched and untracked.

- **Engine core, forked from Scriptorium** (plain copy, as new-noddy did):
  - Copied: `src/engine/{models,queue,agents,logs,store,budget}/**`, `src/engine/pipeline/{llm,prompts}.ts`, `src/engine/{engine,index,transport,cli,summary}.ts`, `src/main/**`, `src/preload/**`, `src/shared/{md,protocol,schemas}.ts`.
  - Trimmed: book publishing (EPUB, Kindle, covers, topics, research).
  - Renamed: `vn-studio` keyring and `window.vnstudio`. The data folder is `~/VisualNovels`, or `VNO_DATA`.
  - New: image message parts for openai-compat, Anthropic and Gemini; a `vision` flag on models; vision-only candidates for the art-critic.
  - Scheduler: a `noModel` option for deterministic jobs.
- **`src/shared/vn.ts`:** the contract for the book structure (`vn.json`), editions keyed by beat id, project settings (`art.stylePrompt` included) and the asset manifest.
- **`src/engine/vn/*`:**
  - Import and parsing: Scriptorium reader, bible/outline/script parser with Croatian keyword aliases and the real-output quirks, a screenplay-direction filter, expression mapping (EN+HR), `checkBranches` port.
  - Language and editions: EN/HR detection; edition alignment that reuses all assets and reports missing and extra beats.
  - Orchestration: project store, `VnService`, director job graph (`handlers.ts`).
  - Agents for 8 roles in `agents/*`, each with a deterministic fallback.
  - CLI in `vncli.ts`.
- **`src/engine/comfy/*`:**
  - Port of the DSH ComfyUI client and graphs.
  - Explicit sizes.
  - A custom-workflow engine (API JSON plus a `.map.yaml` mapping) and a UI-to-API converter.
  - Inventory and status.
  - A background-removal graph (core `RemoveBackground`, used once a model is installed).
  - Fix: `SaveAudioAdvanced` now uses `format.quality`.
- **`src/engine/assets/*`:**
  - Generation and pipeline: deriving assets from the book, manifest (versions, pick, custom upload with lock), and resumable generation for each asset.
  - Art prompts: default style prompts per format and genre, visual-only looks, empty-environment backgrounds, single-figure sheets and sprites.
  - Postprocessing (sharp): background fit to webp, flat-background keying, `keepMainSubject`, pixelation to a palette.
- **`src/engine/renpy/*`, `src/engine/themes/*`, `templates/renpy/**`, `themes/*`:**
  - Ren'Py 8.5 output: a 1920x1080 template, chapter labels, choice menus, endings, a chapter card, and a language picker.
  - Editions become `tl/<language>` files filled from the beat line map.
  - Voice statements only when voice is on.
  - Placeholders when an asset is missing.
  - 5 themes with OFL fonts covering č ć đ š ž.
  - lint, run and Android preflight/build wrappers.
- **`src/engine/mcp/server.ts`:** a stdio MCP server with 11 tools, written by hand with no new dependencies.
- **`src/renderer/**`:**
  - Pages: Library + Import dialog, Book (Pipeline, Editions, Assets, Look, Voice, Build), ComfyUI, Models, Agents, Settings (editable Ren'Py SDK path).
  - **`src/main/files.ts`:** serves audio with Range support, theme fonts, and file pickers.
- **Seed:**
  - Config files `providers`, `roles` (8 VN roles), `models`, `settings`, `budget`, `comfy` and `renpy`.
  - Agent personas, and prompts for every role and task.
  - 10 palettes.
  - The `chatterbox-multilingual` TTS workflow and its mapping.
- **Docs:** `README.md`, `docs/protocol.md`, `docs/android.md`.

### Deviations and decisions
- **User decisions during the work:**
  - No machine translation. Books are EN or HR, the language is detected and confirmed, and translated editions reuse assets.
  - Voice is optional per book.
  - Themes were added.
  - Scriptorium-style models and agents.
  - Croatian TTS waits until a ComfyUI engine supports it, because Chatterbox multilingual has no `hr`.
- **Art-prompt bug found in orchestrator review of real renders:** Scriptorium's bible `## Style` section is a writing note, and it leaked into image prompts. It was replaced with `art.stylePrompt`. Sheets and sprites were reworked to a single figure, and backgrounds no longer include characters.
- **Seeded workflows and palettes** live in `<data>/workflows` and `<data>/palettes`; the loaders search both locations.
- **Translated editions:** menu captions use Ren'Py's automatic translation, and `config.old_substitutions = False`.

### Verification
- Passed:
  - `yarn typecheck` clean, `yarn lint` clean, `yarn test` 30 files / 344 tests, `yarn build` OK.
  - Real Ren'Py 8.5.3 `lint` is clean for the linear and choice fixtures (EN, EN+HR, HR-primary, voice on and off) and for the soother book. The full soother build showed 381 dialogue blocks and 4 menus.
  - The Ren'Py testcase runner played the choice fixture through both endings and switched the language to Hrvatski.
  - Live ComfyUI: z-image-turbo smoke test, qwen-image-2.1 background, character sheet and edit-based sprites, and ACE-Step music (mp3, about 100 s). The re-renders were checked by eye.
  - The app ran with `yarn dev` and was checked over CDP: all pages render, music plays and seeks, and theme fonts load.
- Not run:
  - Real LLM answers from the agents (no LM Studio or Strata was running, so the fallbacks were used).
  - The art-critic with a vision model.
  - TTS clip generation against ComfyUI.
  - An Android APK (RAPT is not installed).
  - A packaged electron-builder app.
  - Saving the Ren'Py settings and clearing the palette in the live UI; both are covered by tests only.

### Follow-ups and known limitations
- **Background removal:** put a model (BiRefNet or RMBG-2.0) into ComfyUI `models/background_removal` for clean sprite cut-outs. Until then sprites use flat-white keying, which can leave small white patches.
- **Croatian TTS:** needs a TTS Audio Suite engine that supports `hr`, added as a workflow plus `.map.yaml`.
- **Android:** install RAPT and create keys through the Ren'Py launcher (see `docs/android.md`).
- **Packaging:** there is no electron-builder config yet. Themes, templates and seed are resolved relative to the code.
- **Seed prompt updates:** an existing data folder never receives updated seed prompts, so copy them by hand.
- **Failed asset jobs:** a permanently failed asset job blocks the dependent jobs; re-run the pipeline to recover.
