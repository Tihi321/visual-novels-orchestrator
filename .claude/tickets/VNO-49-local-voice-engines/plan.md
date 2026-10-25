# VNO-49 — Local ComfyUI voice engines: remove VibeTTS, add multi-model TTS, voice regeneration

Branch: `VNO-49_local-voice-engines` (base `origin/master`).
Status tracker is at the end of this file.

## Goal
Replace VibeTTS with the local ComfyUI TTS stack (TTS Audio Suite: **OmniVoice**, **Higgs Audio v3**, Chatterbox 23L, VibeVoice, Qwen3-TTS, IndexTTS-2, F5-TTS), make local ComfyUI the default voice provider with OmniVoice as the default engine (Croatian works), offer all local audio models for voices/SFX the way music does, and add true **Regenerate** for voice clips. Google Flow stays available but is demoted to an explicit cloud fallback.

## Success criteria
1. No code, test, seed or current doc references VibeTTS/Supertonic/Kokoro (`vibetts` files, config keys, client, status card, tests, docs); historical ROADMAP/ticket entries stay as history.
2. Voice tab: pick provider **ComfyUI (local, default)** or **Google Flow (cloud)**; per language pick a local TTS engine from every installed TTS model; per speaker set a delivery style, upload a reference clip, add its transcript, preview ("Listen") and **Regenerate** that speaker's clips; per language **Regenerate** all its clips.
3. A project with no explicit voice engine generates `hr` and `en` clips through **OmniVoice** with no further setup, and re-running an unchanged generation makes zero ComfyUI requests.
4. SFX can be made with **MOSS-SoundEffect v2** (new built-in), all existing audio engines, custom audio workflows and Chiptune Studio; SFX native is the default SFX engine for ComfyUI projects (Chiptune for pixel books); ambience stays ACE-Step by default.
5. `yarn typecheck`, `yarn lint`, `yarn test` green; live smoke test: one `hr` OmniVoice clip + preview, one forced regenerate, one Higgs v3 clip, one MOSS SFX.
6. Music and voice both list local engines first and Flow last.

## Decisions and assumptions
- **Complete removal** of the VibeTTS integration (client, config endpoint, token, status, pickers, job paths, tests, docs); no compatibility provider.
- **Built-in engine registry**, not seed custom workflows, for the TTS models: one id per model gives capability metadata (languages, clone/ref-text needs, task, required nodes), a single graph builder, readiness checks and an internal clone/ref-free switch. Existing `custom:<workflow>` TTS workflows keep working unchanged.
- **Default `voice.engine: omnivoice`**; `voice.engines[lang]` overrides per language. Engine choice is per language; per-speaker identity comes from the uploaded `voice_<speaker>` clip + `voice.styles` note (per-speaker engine override is out of scope).
- **Croatian** = OmniVoice (600+ languages, language field gets the English name `Croatian`), Higgs Audio v3 (100+ languages, language inferred from text). No other built-in reads `hr`; the Voice tab says so.
- **Regenerate = force**: delete the matching non-imported index entries, then generate with a fresh random seed; hash-based skipping applies again afterwards.
- **MOSS-SoundEffect v2 is the new default SFX engine** for `music.provider` comfy (explicit `sound.sfxEngine` wins; pixel books still default to Chiptune; `"none"` still import-only). Risk: an installation without TTS Audio Suite fails SFX generation with a clear message and can pick another engine.
- **Remove the `supertonic` language flag** (it only described VibeTTS); TTS language coverage now comes from the engine registry (`vno_voice_status`). `config/languages.md` accepts and ignores the old key.
- Assumes the user's ComfyUI at `127.0.0.1:8188` has TTS Audio Suite and the installed models found on disk (`omnivoice`, `higgs_audio_v3`, `chatterbox/English`, `vibevoice/vibevoice-7B`, `qwen3_tts/...Base`, `IndexTTS/IndexTTS-2`, `F5-TTS/F5TTS_v1_Base`, `moss_soundeffect_v2`). Other engines appear as not-ready, not as failures.

## 1. Settings, schema and migrations (`src/shared/vn.ts`)
`voice` becomes:
```ts
{
  enabled, langs,
  provider: 'comfy' | 'flow' = 'comfy',        // legacy 'vibetts' normalised to 'comfy'
  engine: string = 'omnivoice',                 // default local TTS engine
  engines: Record<lang, string> = {},           // per-language override (built-in id or custom:<wf>)
  styles: Record<speakerKey, string> = {},      // delivery: OmniVoice/Qwen3 instruct, Higgs inline tags, Flow style
  refTexts: Record<speakerKey, string> = {},    // transcript of the speaker's voice_<key> clip
  voices: Record<speaker, Record<lang, string>> = {}  // Flow voice ids only
}
```
- `englishEngine` and `flowStyles` are dropped from the schema; `flowStyles` is folded into `styles` on load.
- `legacyVoices` keeps only `gemini:`/`windows:` ids (old Kokoro/Supertonic ids are dropped — they are meaningless for local engines; refs replace them).
- `sound.sfxEngine` default resolution: add `MOSS_SFX_ENGINE = 'moss-soundeffect-v2'`; `resolveSfxEngine` returns it when unset and `resolveMusicProvider() === 'comfy'`, else the current rules.
- `deriveAssets` voiceRef stub engine: `resolveVoiceEngine(settings, primaryLang)` rather than `voice.engines[primaryLang] ?? ''`.
- New helpers in shared or `voice/engines.ts`: `resolveVoiceEngine(settings, lang)` = `settings.voice.engines[lang] ?? settings.voice.engine`; `TTS_TASK` typing.
- Migration test: an old `project.md` with `provider: vibetts`, `englishEngine`, `flowStyles`, Kokoro ids loads as comfy + empty voices + styles, and is saved clean on the next settings write.

## 2. ComfyUI TTS engine registry and client
New `src/engine/comfy/tts-engines.ts` (graph builders + specs), imported by `graphs.ts` and spread into `ENGINES`. `saveAudioNode` moves to `comfy/audio-save.ts` (imported by both) to avoid a cycle.

`EngineDef` gains: `task?: 'music' | 'tts' | 'sfx'` (default music), `requiresNodes?: string[]`, `languages?: string[] | '*'`, and TTS specs:
```ts
{ id, label, node, task:'tts'|'sfx', requiresNodes, languages,
  preset, presetByLang?, language?: { input, map? }, instruct?: inputName,
  clone: 'required'|'optional'|'none', refText: 'required'|'optional'|'none' }
```

### Built-in engines (registry order = priority)
| id | ComfyUI node | task | languages | clone / ref text | notes |
|---|---|---|---|---|---|
| `omnivoice` | `OmniVoiceEngineNode` | tts | `*` (600+) | optional / needed for cloning | `language` = English name; `instruct` = style; speed from config; OmniVoice defaults |
| `higgs-audio-v3` | `HiggsAudioV3EngineNode` | tts | `*` (100+) | optional / optional | language inferred from text; style only if it is inline tag syntax |
| `chatterbox-23lang` | `ChatterBoxOfficial23LangEngineNode` | tts | ar da de el en es fi fr he hi it ja ko ms nl no pl pt ru sv sw tr zh | optional / none | `language` enum mapped from code |
| `vibevoice` | `VibeVoiceEngineNode` | tts | en zh (installed `vibevoice-7B`) | optional / none | Custom Character Switching mode |
| `qwen3-tts` | `Qwen3TTSEngineNode` | tts | zh en ja ko de fr ru pt es it | optional / optional | `instruct`; `x_vector_only_mode` when no transcript |
| `index-tts-2` | `IndexTTSEngineNode` | tts | en zh ja es ar | required / none | `model_path: local:IndexTTS-2` |
| `f5-tts` | `F5TTSEngineNode` | tts | en de es fr ja it th pt-br→pt pl hi | required / required | `language` input = model variant (`F5-DE`, …); missing transcript = clip skipped with guidance |
| `moss-soundeffect-v2` | `MossSoundEffectV2EngineNode` | sfx | — | none / none | MOSS v2 defaults (steps 100, cfg 4, shift 5); `negative_prompt` from the asset |

All required widget inputs come from the live `/object_info` (frozen as presets); optional inputs are set only where meaningful (`instruct`, `speed`, `dtype`, `x_vector_only_mode`).

### Graph shape (built-in TTS)
```
1  <engine node>  preset + language/presetByLang + instruct/speed + seed-free settings
2  LoadAudio      { audio: <uploaded clip filename> }                         (only with a reference)
3  CharacterVoicesNode { voice_name:'none', reference_text, trim_start:0,
     trim_end:0, customized:false, opt_audio_input:['2',0] }                  (only with a reference)
4  UnifiedTTSTextNode { TTS_engine:['1',0], text, narrator_voice:'none', seed,
     enable_chunking:true, max_chars_per_chunk:<config>, chunk_combination_method:'crossfade',
     silence_between_chunks_ms:100, enable_audio_cache:true, batch_size:0,
     ...(ref ? { opt_narrator:['3',0] } : {}) }
5  SaveAudio / SaveAudioAdvanced { audio:['4',0], filename_prefix }
```
SFX: engine node → `UnifiedSoundEffectsNode { TTS_engine, description, duration_seconds:<seconds>, seed, crossfade_seconds:1, enable_audio_cache:true }` → save node. Output node id 5 (SFX 3) is passed as `preferNode`.

Clone policy: `optional` uses the speaker's clip (narrator's as fallback) when present; OmniVoice with a clip but no transcript generates ref-free from `instruct` and logs how to add the transcript; `required` skips that clip with a clear per-beat message; `none` never uploads.

### Client (`comfy/client.ts`)
- `ComfyRequest`/`BuildOpts` add `text`, `languageName`, `instruct`, `voiceRef` (already), `voiceRefText`; SFX uses existing `seconds`/`negative`.
- Built-in path uploads `voiceRef` (same `/upload/image` route the custom TTS path already uses), encodes `language` through the spec (`map` or `languages` pass-through), and passes `format`/`seconds` into the save node.
- Guard before submit: when a def has `requiresNodes` and `/object_info` lacks one, fail with `engine "omnivoice" needs the ComfyUI nodes … (TTS Audio Suite): install it or pick another voice engine` instead of a raw ComfyUI error.
- `inventory.ts`: `engineReports(config, models, nodes)` adds `node:<Class>` to `missing` for `requiresNodes`; `EngineReport` and `EngineInfo` gain `task` and `languages`; `listEngines()` exposes them. TTS/SFX engines are not gated on model-file paths (the suite manages its models).

## 3. Voice jobs and planning (`src/engine/voice/`)
- **Delete** `voice/vibetts.ts`; **delete** VibeTTS paths from `voice/jobs.ts` (`generateVibeClips`, `planVibeVoices` renamed to Flow-only `planListVoices`, Vibe bits of `setVoice`/`previewVoice`). Keep `VoiceIndexEntry` (add optional `engine`, `seed`, `at`), index helpers, `invalidateSpeaker`, `sampleText`, `importedClipsNote`.
- `voice/catalog.ts` becomes generic: `VoiceEntry { id, label, engine?, languages, gender? }`; keep `pickVoices`, `describeVoices`, `voiceLangsOf`, `parseGender`, `guessGender`, `NARRATOR`; drop `voiceGender`, `voicesFor(englishEngine)`, `readsLang`, `SUPERTONIC_HINT`, `EnglishEngine`. `flow-catalog.ts` uses `VoiceEntry` and `flowAsVoiceList`.
- **New `voice/comfy-tts.ts`**: `generateComfyTtsClips(svc, slug, lang, { engine, beatId, limit, force, speakerKey, comfy, config, log, signal })`
  - resolve engine (`resolveVoiceEngine`); built-in or `custom:`; validate it reads `lang` (else skipped job with the supported list);
  - collect `voice_<speaker>` clip files (narrator fallback) and their `voice.refTexts`;
  - hash = `tts1|engine|lang|refContentHash|refText|style|format|chunkChars|text`; unchanged clips skipped; imported clips always kept (and counted stale);
  - per clip call `comfy.generate({ engine, text, language, languageName, voiceRef, voiceRefText, instruct: style, seed: random, format })`, write `voice/<lang>/<beatId>.<ext>`, save index after each clip, `setStep` progress; per-clip failures counted (max 3 messages), continue, throw only if none made;
  - `force` invalidates first: entries for `speakerKey` (the slot used) and/or `beatId`; `limit` applies after.
  - `previewComfyVoice(svc, slug, speakerKey, lang, {...})` → `preview/voice-<key>.<ext>`, response `voice` = engine id.
- **Plan voices**: Flow unchanged (`planListVoices`). For comfy, call the voice-director with `describeTtsEngines(engines, langs)`; persist `voice.styles[speaker] = description`, `voice.engines[lang]` when the answer names an installed engine that reads the language (kept unless `overwrite`), never touch uploaded refs; message `N voice style(s) and engine(s) planned`. Without an answer nothing breaks — generation falls back to `voice.engine`.
- Voice-director: schema gains `engines: Record<lang,string>.optional()`; `seed/prompts/voice-director/plan_voices.md` rewritten for local engines (choose engine per language from the list, style sentence per subject; `voices` only for Flow).
- `voice/config.ts`: schema is now `format` (mp3|wav), `speed` (0.5–2), `chunkChars` (100–1000, default 400); no URLs/tokens/timeouts; `clientFor` deleted; `loadVoiceConfig` kept. Seed `config/voice.md` rewritten (local engines, licenses note: Higgs v3 research/non-commercial, F5 CC-BY-NC, etc.).

## 4. Engine service, protocol and events
`src/shared/protocol.ts`:
- `EngineInfo`/EngineReport view gains `task: 'music'|'tts'|'sfx'` and `languages: string[] | '*'`.
- Replace VibeTTS types (`VibeVoiceView`, `VibeDefaultView`, old `voice.status`) with:
```ts
type voice.status = { ok, error, comfyUrl, defaultEngine,
  engines: { id, label, task, languages, ready, missing }[],
  workflows: { name, languages }[] }   // custom TTS workflows
```
- Commands: `generateVoice` gains `force?: boolean`, `speakerKey?: string`; `previewVoice` keeps optional `voice` (Flow) and now works for comfy using the project engine; `setVoice` stays but is Flow-only; `voiceStatus` unchanged name, new answer.
- `VnCommand`/`COMMAND_TYPE_SET` untouched otherwise.

`VnService`: `vibetts()` → `voiceConfig()`; `voiceStatus()` builds the new event from `comfyStatus()` inventory + registry + custom workflows (never throws; `ok:false` with lane errors); `generateVoice` forwards `force`/`speakerKey`; `setVoice` throws a helpful error for comfy; `previewVoice` dispatches Flow vs comfy; remove the `vibetts` dep (also `EngineOptions`/`engine.ts`).
`vn/handlers.ts`: voicePlan branches Flow vs comfy; voiceGenerate branches Flow vs `generateComfyTtsClips`; old inline custom-workflow loop and VibeTTS branches removed.

## 5. Renderer
- `store/vn.ts`: `vibetts` → `voiceStatus` (new view), reducer updated; `voicePreviews` keys unchanged.
- `lib/engines.ts`: filter by task — music/ambience = `music`; SFX = `music` + `sfx`; new `ttsChoices(engineList, workflows, current)` = built-in `tts` engines + custom TTS workflows (registry order, current last). `generatorChoices/editorChoices/musicChoices` unchanged in behavior.
- `lib/voice.ts`: drop `vibettsSupport`/`voiceOptions`/`EnglishEngine`; add `ttsSupport(engineId, lang, engines, workflows)` and `ttsEngineLabel`; keep `voiceProgress`, `langName`, `voiceSupport` (custom workflows).
- `VoiceTab.tsx` rewritten:
  - provider select: `ComfyUI (local voices, default)` then `Google Flow (cloud, free tier)`; text explains ComfyUI must run.
  - ComfyUI card: default engine select (`voice.engine`), per-language row (checkbox, engine override with `(default: X)`, support Pill, Generate, **Regenerate**), Plan voices, Generate all, **Regenerate all**, progress/errors, warning when the default engine's nodes are missing.
  - Voices card: per speaker — style input (saved on blur via `updateSettings`), reference clip player, Upload, transcript input (`voice.refTexts`), Listen (preview), **Regenerate speaker**; narrator row first.
  - Flow card unchanged (uses `voice.styles` instead of `flowStyles`).
  - Remove the whole VibeTTS component and its tests.
- `LookTab.tsx`: new **Sound** card (provider-free): SFX engine (`Auto`, MOSS SoundEffect v2, all audio engines, custom audio workflows, Chiptune Studio, `none` = import only) and Ambience engine (audio engines, Chiptune Studio, custom workflows), writing `settings.sound`; links to the new MOSS default.
- `ComfyPage.tsx`: remove the VibeTTS card; engine rows show a `voice`/`effect`/`music` tag and language coverage; add a small "Local voices" summary from `voiceStatus` (engine + ready/missing) so the TTS suite's absence is visible.

## 6. MCP, CLI, seed and docs
- MCP (`mcp/tools.ts`, `server.ts` INSTRUCTIONS):
  - `vno_voice_status`: local TTS/SFX engines, languages, readiness, custom TTS workflows, default engine (Flow status stays in `vno_studios_status`).
  - `vno_voice_plan`: local plan (engines + styles) or Flow plan; docs describe both.
  - `vno_voice_set`: Flow only, with a hint for local.
  - `vno_voice_preview`: `voice` optional; local uses the project engine.
  - `vno_voice_generate`: add `force` (regenerate) and `speakerKey`; description documents regeneration.
  - `vno_update_settings` voice description: provider `comfy|flow`, `engine`, `engines`, `styles`, `refTexts`, `langs`, `voices` (Flow; maps replace), plus the new SFX default and `sound` docs.
  - `vno_languages`: drop the `supertonic` field.
- CLI (`vncli.ts`): usage strings and `voice` subcommands:
  - `voice status` (engines + readiness), `voice plan`, `voice <slug> [--lang] [--only] [--limit] [--force] [--speaker key]`, `voice preview <slug> <speaker> [--lang]`, `voice engine <slug> <engine> [--lang hr]` (no `--lang` = default), `voice style <slug> <speaker> <text>`, `voice reftext <slug> <speaker> <text>`; `voice set` stays Flow-only with a clear error otherwise.
- Seed: rewrite `seed/config/voice.md`; update `seed/config/studios.md` (remove VibeTTS token/client mentions), `seed/config/mcp.md` (port note), `seed/config/autostart.md` (drop VibeTTS from never-started list), `seed/config/languages.md` (drop `supertonic`), `seed/config/comfy.md` (TTS/SFX engines note), `seed/workflows/chatterbox-multilingual.map.yaml` comment (point to built-in `chatterbox-23lang`/`omnivoice` for Croatian).
- Migration: `seedMigrations.ts` entry `voice-local-v1` deleting `vibettsUrl`, `vibettsToken`, `timeoutS`, `voiceTimeoutS`, `batchTimeoutS`, `chunkSize`, `speed`-adjacent stale keys from an edited `config/voice.md` frontmatter (never overwrite kept values; add `format`/`chunkChars` only if absent).
- Docs: `docs/protocol.md` (pipeline table, full Voice section, Studios, CLI), `docs/mcp-guide.md` (Local voices section replacing VibeTTS; Flow marked fallback; languages), `README.md` (status, tokens, autostart, ports), `ROADMAP.md` (VNO-49 entry; remove the VibeTTS later item; note local-first).

## 7. Tests
- Delete `tests/voice-vibetts-client.test.ts`, `tests/voice-vibetts-jobs.test.ts`, `tests/ui-voice-vibetts.test.ts`.
- New:
  - `comfy-tts-engines.test.ts`: every spec builds a valid graph (engine node + UnifiedTTSTextNode + save node; LoadAudio+CharacterVoices only with a ref; SFX uses UnifiedSoundEffectsNode), presets cover required inputs, language maps are real language codes, `languages:'*'` only for omni/higgs, task/languages reach `listEngines`, node-presence guard message.
  - `voice-comfy-jobs.test.ts` (FakeComfy + `makeVnEnv`): default OmniVoice for `en`/`hr`; per-language engine override; hash skip (second run = 0 requests); imported clips kept; style/refText/ref-hash change = regenerate; `force` regenerates despite unchanged text; `speakerKey` scopes; per-clip failure continues; missing engine/custom workflow language skips with message; preview writes a file and reports the engine; index stores engine/seed.
  - `voice-plan.test.ts`: comfy plan assigns styles and valid engine overrides, keeps refs, survives a missing agent answer; Flow plan still assigns voices.
  - `ui-voice-local.test.ts`: `ttsChoices` excludes music engines and orders local first, `engineChoices` filters music/sfx/voice tasks, `ttsSupport` per language, store reducer for the new `voice.status`.
- Update: `tests/vn-helpers.ts` (FakeComfy treats built-in TTS/SFX ids as audio; writes a temp `config/comfy.md` with an unreachable lane for status tests), `comfy-client.test.ts`, `comfy-custom.test.ts`, `voice-catalog.test.ts`, `voice-flow-jobs.test.ts`, `mcp-http.test.ts`, `vn-interfaces.test.ts`, `studios-flow-client.test.ts`, `languages.test.ts` (no `supertonic`), `vn.test.ts` (new voice defaults), `ui-voice-urls.test.ts`, `ui-assets.test.ts`, `renpy-integration.test.ts`, `assets-derive-manifest.test.ts`/`assets-generate.test.ts` (MOSS SFX default; TTS engine excluded from music/SFX pickers), `seed-migrations.test.ts`, `seed-files.test.ts`.

## 8. Edge cases and failure modes
- ComfyUI down → voice jobs fail with the lane/hint; `voice status` shows `ok:false`; Voice tab warns.
- TTS Audio Suite missing / node renamed → readiness shows `node:…` missing; generation throws the node-install message.
- Engine doesn't read the language (e.g. chatterbox + hr) → language job skipped with the supported list; Voice tab Pill says not supported before generating.
- Clip without transcript for a `refText: required` engine (F5) → that clip skipped with "add the transcript in the Voice tab"; OmniVoice falls back to ref-free instruct and says so.
- Beat longer than a node's max tokens → per-clip failure recorded, other clips continue; user can split the beat.
- Regenerate while a voice job is queued for the same language → jobs run in order; force is applied inside the job so the later one wins.
- Old project files (vibetts provider, englishEngine, flowStyles, Kokoro ids) load and save clean; no clip deletion on migration.
- Flow stays fully functional; its clips/previews still hash on `flow|voice|lang|style|format|text`.
- Pixel books keep Chiptune SFX default; explicit `sound.sfxEngine` always wins.

## 9. Verification
1. `yarn build:engine && yarn typecheck && yarn lint && yarn test` (all green; update the test count in the ticket changelog).
2. `rg -i "vibetts|supertonic|kokoro" src tests docs seed README.md` → no matches.
3. Static graph check against the running ComfyUI: for each spec, assert required node classes exist in `/object_info` (script), and print the composed API graph for OmniVoice + Higgs + MOSS.
4. Live smoke (bounded, `limit 1`, after `comfy_free_memory`): `voice status`; generate one `hr` clip with OmniVoice; preview it; run a forced regenerate and confirm a second request; one Higgs v3 `en` clip; one SFX asset regenerated with `moss-soundeffect-v2`; record first-load times; free VRAM afterwards. If VRAM/model load blocks it, record exactly what was not verified instead of claiming it.
5. Manual UI check by the user after `yarn build` + app restart (Voice tab engines/regenerate, Look tab Sound card, Generators page without VibeTTS).

## 10. Implementation workflow
1. Immediately after approval, save this plan to `.claude/tickets/VNO-49-local-voice-engines/plan.md`; create branch `VNO-49_local-voice-engines` (base `master`); load the global `implement` skill and follow it (delegation, verification, changelog).
2. **Lead — critical path, one coherent change:** schema/migrations + TTS/SFX registry, graphs, client, inventory + voice jobs/planning + service/handlers/engine wiring (files: `src/shared/vn.ts`, `src/shared/protocol.ts`, `src/engine/comfy/**`, `src/engine/voice/**`, `src/engine/vn/{handlers,service}.ts`, `src/engine/engine.ts`). Freeze these interfaces before delegating.
3. After that, in parallel with disjoint write scopes and shared tasks:
   - **Renderer teammate**: `src/renderer/**` (VoiceTab, LookTab sound card, ComfyPage, store, lib) + `tests/ui-voice-local.test.ts`, `tests/ui-assets.test.ts`.
   - **Tools/docs teammate**: `src/engine/mcp/{tools,server}.ts`, `src/engine/vncli.ts`, `seed/**`, `docs/**`, `README.md`, `ROADMAP.md`, migrations + `tests/{mcp-http,vn-interfaces,languages,seed-*}.test.ts`.
   - **Tests teammate**: `tests/comfy-tts-engines.test.ts`, `tests/voice-comfy-jobs.test.ts`, `tests/voice-plan.test.ts`, `tests/vn-helpers.ts`, updated comfy/flow/catalog/assets tests.
4. Lead reviews the full diff, runs the verification above, performs the live smoke test, writes `.claude/tickets/VNO-49-local-voice-engines/changelog.md`, adds the ROADMAP entry, and commits with `VNO-49: …`.

## Out of scope
- Per-speaker engine overrides, per-character engine presets (Qwen3 presets, MOSS voice design) UI.
- Auto-transcribing uploaded reference clips (ASR) to fill `voice.refTexts` (manual input only; note as follow-up).
- Changing the art Flow provider, Flow Music credit handling, or the game player audio.
- Downloading TTS models from inside VN Studio (the TTS Audio Suite manages its model files).

## Status tracker
- [x] Core: schema/protocol/comfy TTS+SFX registry, client, jobs, service/handlers/engine
- [x] Renderer: Voice tab, Sound card, Comfy page, store/lib
- [x] MCP/CLI/seed/docs/migrations
- [x] Tests updated + new
- [x] typecheck / lint / test green (1126 tests in 82 files; tsc node + web 0; eslint 0)
- [x] Live smoke test (OmniVoice hr, regenerate, Higgs; MOSS SFX blocked by an external node)
- [x] Changelog + ROADMAP entry (+ commit)

## Verification evidence
- `vite build --config vite.engine.config.ts` exit 0; `tsc --noEmit` node/web exit 0; `eslint .` exit 0; `vitest run` 82 files / 1126 tests passed.
- Live ComfyUI (headless, 127.0.0.1:8188): `voice status` listed the seven TTS engines + MOSS as ready with their real language coverage.
- OmniVoice direct graph: Croatian clip 40,999 bytes / 3.52 s, regenerate 42,896 bytes.
- Higgs Audio v3 direct graph: English clip 41,188 bytes.
- End-to-end CLI on a temp data folder (`lighthouse-letters`, en+hr): `voice … --limit 1` made `voice/hr/ch01.s01.b001.mp3` (43,881 bytes, index engine `omnivoice`, seed 3564989157); a plain rerun reported `0 clip(s) made, 1 unchanged`; `--force` regenerated with seed 389736421; `voice preview` wrote a 43,451-byte preview.
- MOSS-SoundEffect v2 direct graph: the job reached the suite and failed in its VAE loader with `TypeError: load() got multiple values for argument 'map_location'`. The installed `comfyui_fill-chatterbox` node monkey-patches `torch.load` (`chatterbox_node.py:235`) and breaks `audiotools`' `DAC.load`; this is external to VN Studio and the model itself downloaded. Therefore ACE-Step stays the default SFX engine and MOSS is selectable explicitly (see deviations).

## Deviations from the approved plan
1. **SFX default:** the plan made MOSS-SoundEffect v2 the default. Live verification proved its loader is broken by the installed `comfyui_fill-chatterbox` `torch.load` patch, so `resolveSfxEngine` keeps the previous default (ambience engine/ACE-Step for a ComfyUI project, Chiptune Studio for a chiptune one) and MOSS is offered in the Sound card and regenerator. Docs, MCP descriptions, seed and ROADMAP say this.
2. **Engine language lists:** Malay/Swahili (Chatterbox) and Thai (F5) were dropped because they are not project languages (`languageInfo()` has no code for them and the table is pinned at 37); the nodes still support them, but no edition can use them.
3. **Readiness filtering in `planVoices`:** the plan says “installed engines”; the handler treats every registry TTS engine (plus custom TTS workflows) as assignable and leaves readiness to generation, so planning works when ComfyUI is briefly down. The Voice tab still shows readiness per language.
4. **Flow speaker row:** with no VibeTTS voice list to populate a select, the Flow row is a text input for `gemini:<Name>` that saves on blur/Enter (same test id, `setVoice`).
5. **Lint:** `tmp-diag-utilproc/` (a tracked diagnostic scratch folder that predates this ticket) is excluded in `eslint.config.mjs`; it contains CommonJS `require` calls and broke `eslint .` unrelated to VNO-49.

