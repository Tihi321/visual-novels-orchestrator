# VNO-49 — Local ComfyUI voice engines (changelog)

**2026-10-25 — VNO-49:** VibeTTS is gone; voice clips now come from the local ComfyUI TTS Audio Suite (OmniVoice by default, Croatian included), every audio/SFX model is offered for voices and sound effects, Google Flow is the demoted cloud fallback, and voice clips can be regenerated.

Branch: `VNO-49_local-voice-engines` (base `origin/master`). Commit status: committed locally, not pushed.

## Engine / shared
- `src/shared/vn.ts` — new `voice` schema (`provider: comfy|flow`, `engine` default `omnivoice`, per-language `engines`, `styles`, `refTexts`, Flow-only `voices`); legacy `provider: vibetts` → `comfy`, `flowStyles` → `styles`, `englishEngine` dropped, Kokoro/Supertonic ids dropped while `gemini:`/`windows:` survive; `resolveVoiceEngine`; `DEFAULT_VOICE_ENGINE`; `MOSS_SFX_ENGINE` is selectable, not the default. `resolveSfxEngine` keeps the music provider's engine (ambience/ACE-Step for ComfyUI, Chiptune for chiptune) and honours explicit `sound.sfxEngine`/`none`.
- `src/shared/protocol.ts` — `EngineInfo`/comfy engine rows gain `task` (`music|tts|sfx`) and `languages`; new `VoiceEngineView`/`ComfyEngineView`; `voice.status` is now `{ok, error, comfyUrl, defaultEngine, engines, workflows}`; `generateVoice` gains `force`/`speakerKey`; `previewVoice.voice` is optional. VibeTTS views removed.
- `src/shared/languages.ts`, `src/engine/vn/languages-config.ts` — dropped the `supertonic` flag (a legacy key is ignored); TTS language coverage now comes from the engine registry.
- `src/engine/comfy/tts-engines.ts` (new) — seven TTS specs + MOSS-SoundEffect v2 with node class, task, language coverage/maps, clone/ref-text policy, frozen required presets, required ComfyUI nodes, and graph builders (`engine → [LoadAudio + CharacterVoicesNode] → UnifiedTTSTextNode → SaveAudio/SaveAudioAdvanced`; SFX uses `UnifiedSoundEffectsNode`). Registry order: omnivoice, higgs-audio-v3, chatterbox-23lang, vibevoice, qwen3-tts, index-tts-2, f5-tts, moss-soundeffect-v2. Language codes are limited to real project languages (no Malay/Swahili/Thai).
- `src/engine/comfy/audio-save.ts` (new) — shared audio save node (mp3/opus/flac through `SaveAudioAdvanced`, wav through `SaveAudio`).
- `src/engine/comfy/graphs.ts` — `EngineDef` task/`requiresNodes`/languages/TTS fields, `BuildOpts` text/languageName/instruct/voiceRef/voiceRefText/chunkChars/speed, TTS engines spread into `ENGINES`.
- `src/engine/comfy/client.ts` — built-in TTS/SFX path: voice-reference upload, language mapping, node-presence guard with the install hint, preferred output node.
- `src/engine/comfy/inventory.ts` — `engineReports(config, models, nodes)` marks missing `node:<Class>`, reports task/languages.
- `src/engine/voice/` — `vibetts.ts` deleted; generic `catalog.ts` (`VoiceEntry`, Flow-only planning helpers, `describeTtsEngines`); new `comfy-tts.ts` (hash `tts1|engine|lang|ref hash|transcript|style|format|chunkChars|speed|text`, imports/unchanged skipping, `force`/`speakerKey`/`beatId`, per-clip failures, index after every clip with engine/seed; preview); `jobs.ts` reduced to index/invalidation/sample helpers + Flow planner; `flow.ts`/`flow-catalog.ts` use `styles` and the generic voice list; `config.ts` is now `format`/`speed`/`chunkChars`.
- `src/engine/vn/service.ts`, `handlers.ts`, `engine.ts`, `assets/derive.ts`, `agents/voice-director.ts` — `voiceConfig()`, new `voiceStatus`, comfy/Flow dispatch, local planning of styles + per-language engines, Flow-only `setVoice`, new preview path, no VibeTTS dependency, MOSS-aware voiceRef stubs, `engines` in the voice-director answer.
- `src/engine/store/seedMigrations.ts` — `voice-local-v1` strips the VibeTTS keys from an edited `config/voice.md` and adds `chunkChars` (and absent format/speed) without overwriting values.

## UI
- `src/renderer/ui/book/VoiceTab.tsx` — ComfyUI provider first/default, Flow second as cloud fallback; default engine + per-language override; per-language Generate/Regenerate; Plan/Generate/Regenerate all; per speaker style, reference clip, transcript, Listen, speaker Regenerate and preview audio; VibeTTS removed; Flow rows use a Free-text voice id input + Listen.
- `src/renderer/ui/book/LookTab.tsx` — new Sound card: SFX engine (Auto, MOSS-SoundEffect v2, every audio engine, custom workflows, Chiptune, `none`) and Ambience engine.
- `src/renderer/ui/ComfyPage.tsx` — VibeTTS card removed; engine task/language tags; new “Local voices” readiness card.
- `src/renderer/store/vn.ts`, `lib/engines.ts`, `lib/voice.ts` — `voiceStatus` store, task-filtered choices, `ttsChoices`/`sfxChoices`/`ambienceChoices`, `ttsSupport`/`ttsEngineLabel`.
- `eslint.config.mjs` — ignores the pre-existing tracked `tmp-diag-utilproc/` diagnostic (CommonJS require) so `eslint .` is green.

## CLI / MCP / seed / docs
- `src/engine/vncli.ts` — `voice status` (engines, readiness, languages, workflows, default), `voice preview`, `voice engine`, `voice style`, `voice reftext`, `--force`/`--speaker`; Flow-only `voice set`; settings output shows voices.
- `src/engine/mcp/tools.ts`, `server.ts`, `tools-import.ts` — local voice descriptions, `force`/`speakerKey`, new `vno_voice_status`, Flow-only `vno_voice_set`, `vno_update_settings` voice/sound clauses, `vno_languages` without `supertonic`, updated instructions.
- `seed/config/voice.md` rewritten; `seed/prompts/voice-director/plan_voices.md` rewritten for `{{voiceList}}`/`{{engines}}`; studios/mcp/autostart/languages/comfy configs and the Chatterbox mapping note cleaned; `docs/protocol.md`, `docs/mcp-guide.md`, `README.md`, `ROADMAP.md` updated.

## Tests
- Deleted `voice-vibetts-client`, `voice-vibetts-jobs`, `ui-voice-vibetts`.
- Added `comfy-tts-engines.test.ts` (graphs/registry/presets/readiness/guards), `voice-comfy-jobs.test.ts` (default OmniVoice en/hr, overrides, hash skip, speed/text/style/ref changes, imports, force/scoping, failures, custom workflows, preview/index), `voice-plan.test.ts` (local styles/engines vs Flow voices), `ui-voice-local.test.ts` (choices/support/store).
- Updated `vn-helpers` (FakeComfy audio by engine kind, dead-lane helper), comfy-client/custom, voice-catalog/flow jobs, assets derive/generate, MCP HTTP, interfaces, languages, seed migrations, UI fixtures, autostart/studios clients, vn defaults/pipeline.

## Verification
- `vite build --config vite.engine.config.ts` → exit 0.
- `tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json` → exit 0.
- `eslint .` → exit 0.
- `vitest run` → **82 files / 1126 tests passed**, 0 failed.
- Live ComfyUI (headless 127.0.0.1:8188): `voice status` listed all seven TTS engines + MOSS as ready; OmniVoice Croatian clip 40,999 bytes / 3.52 s and a regenerated 42,896 bytes; Higgs v3 English clip 41,188 bytes; end-to-end CLI on a temp project (`lighthouse-letters`, en+hr): one hr clip 43,881 bytes (index engine `omnivoice`, seed 3564989157), a plain rerun “0 made, 1 unchanged”, `--force` new seed 389736421, preview 43,451 bytes.

## Deviations and follow-ups
- **SFX default reverted from MOSS to the music/ambience engine.** MOSS-SoundEffect v2 reaches the suite but fails in its VAE loader (`load() got multiple values for argument 'map_location'`) because the installed `comfyui_fill-chatterbox` node monkey-patches `torch.load`. This is external to VN Studio (the model downloads fine). MOSS remains selectable; updating/disabling that ComfyUI node is the follow-up to make it usable. Docs/MCP/seed/ROADMAP state the actual default.
- Engine language lists exclude Malay/Swahili/Thai because no edition can use them.
- `planVoices` accepts any registry TTS engine (readiness is shown in the UI and enforced at generation), so planning works while ComfyUI is briefly down.
- Flow speaker rows use a text input for `gemini:<Name>` (no Flow voice-list event exists after VibeTTS removal).
- Not verified: manual Electron click-through of the new Voice/Sound tabs (unit/tsc-level only); the user should restart VN Studio after `yarn build` to see it.
