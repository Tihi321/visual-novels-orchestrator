# VNO-03: Fixed VibeTTS voices, an HTTP MCP server and a headless mode

Status: **implemented, uncommitted** (2026-10-19). See [`changelog.md`](changelog.md).
Ticket folder: `.claude/tickets/VNO-03-fixed-vibetts-voices-an-http-mcp/`. Branch: `VNO-03_fixed-voices-mcp-headless`, cut from `origin/master` (6e2e2e4).
Repos changed: only `visual-novels-orchestrator`. VibeTTS (`vibe-tts-flow`, VTF-06 already merged) needs no change; its notes are in `vibe-tts-flow/.claude/tickets/VTF-06-supertonic-3/mcp-changes.md`.

## Progress checklist
- [x] A. Voices: fixed VibeTTS voices per language, `setVoice`, UI, CLI, seed, docs, tests (+ engine.ts studios pass-through fix)
- [x] B. MCP over HTTP, data-folder lock, headless `--mcp-only`, stdio relay, Settings MCP card, docs, tests
- [x] B-voice. MCP voice tools on top of A's `setVoice`
- [x] Final: typecheck, lint, test, build; changelog

Verification (orchestrator): `yarn typecheck`, `yarn lint`, `yarn build` clean; `yarn test` 42 files / 455 tests pass. Live: real VibeTTS headless + VN Studio `--mcp-only` on the linear EN+HR fixture (plan, generate 20+20 clips at 44.1 kHz, `vno_status` answered during a waiting `vno_voice_generate`, second start refused by the lock). Not run: Electron window checks (Settings MCP card, blocked-engine warning, Electron `--mcp-only`), Ren'Py lint with voice on the soother book.

## Slice contract (shared by A and B)
- A owns: `src/engine/voice/**`, `src/shared/vn.ts`, `src/shared/voice-vocab.ts`, `src/engine/vn/agents/voice-director.ts`, `src/engine/vn/handlers.ts` (voice parts), `src/engine/vn/service.ts`, renderer voice files (`lib/voice.ts`, `ui/book/VoiceTab.tsx`, `ui/ComfyPage.tsx`, `store/vn.ts`), voice seed files, voice tests, `docs/protocol.md` Voice section.
- B owns: `src/engine/mcp/**`, `src/engine/store/lock.ts`, `src/engine/index.ts`, `src/main/**`, `src/renderer/ui/SettingsPage.tsx`, a new renderer MCP store slice, `seed/config/mcp.md`, `package.json`/`yarn.lock`, `README.md`, `docs/mcp-guide.md`, `docs/protocol.md` "CLI and MCP" section, MCP/lock tests, `tests/vn-interfaces.test.ts`.
- Shared, Edit-only (never Write the whole file), each touching only its own lines: `src/shared/protocol.ts`, `src/engine/engine.ts`, `src/engine/vncli.ts`, `src/engine/store/seedRefresh.ts`.
- A's service API that B's voice tools wrap: `svc.voiceStatus()`, `svc.planVoices(slug, {overwrite?})`, `svc.setVoice(slug, speakerKey, lang, voice)`, `svc.previewVoice(slug, speakerKey, voice, lang)`, `svc.generateVoice(...)` (existing signature). `designVoice` is removed.

## Context

**Voices.** VibeTTS removed OmniVoice along with the `create_voice` and `delete_voice` tools.
- Voices are now fixed. Kokoro voices (`af_heart`, …) read English only. Supertonic has 10 voices, `supertonic:F1..F5` and `M1..M5`, and reads 31 languages including Croatian.
- `list_voices` has a new shape: `{voices:[{id,label,engine,languages}], languages, english, other, language_mode, supertonic_installed}`.
- VN Studio's "Plan voices" and "Design voice" both call `create_voice`, so both fail now.
- The user chose **per-language voices**: each character gets one voice per edition language, for example Kokoro for EN and Supertonic for HR.

**MCP and headless.** The user wants outside agents to drive VN Studio, and wants it to run without the UI when only MCP is used.
- Today there is a stdio MCP server (`yarn engine -- mcp`, 11 `vno_*` tools, `src/engine/mcp/server.ts`).
  - It starts its own engine, which the open UI never sees.
  - It runs calls one at a time, so a `wait` call blocks `vno_status`.
  - Nothing stops it from colliding with the app's engine on the same data folder: `recoverRunning()` re-queues the other engine's jobs.
- The user chose **Streamable HTTP like Pixel Studio and Chiptune Studio**:
  - When the window is open, the server runs inside the app's own engine, so the UI shows agent work live.
  - Otherwise it runs headless with `--mcp-only`.

## A. Voices (fixed VibeTTS voices, per language)

**Schema (`src/shared/vn.ts` ~L187-198)**
- `voice.voices` becomes `Record<speakerKey, Partial<Record<Lang, voiceId>>>`.
- A `z.preprocess` migrates old projects:
  - a string value `omni:*` is dropped, so the speaker needs a new plan;
  - a `supertonic:*` id is set for every language;
  - any other id (Kokoro) is set for `en` only.
- New optional `voice.englishEngine: 'kokoro' | 'supertonic'`, default `kokoro`.
- Update the doc comment (`supertonic:F2`).
- `ProjectSettingsPatch` keeps its shallow `voice` merge.

**Client (`src/engine/voice/vibetts.ts`)**
- Delete `createVoice`, `deleteVoice` and `CreatedVoice`.
- `VibeVoice` becomes `{id,label,engine,languages}`, and `VibeVoiceList` takes the new shape.
- Fix the timeout comments.
- Keep the `config.ts` key `voiceTimeoutS` (preview), but reword its comment.

**Voice catalogue helper (new `src/engine/voice/catalog.ts`)**
- `voiceGender(id)`:
  - Kokoro: the second letter of the prefix (`af_`/`bf_` female, `am_`/`bm_` male);
  - Supertonic: `F*` or `M*`.
- `voicesFor(list, lang, englishEngine)`:
  - `en`: Kokoro or Supertonic, depending on `englishEngine`;
  - other languages: Supertonic voices whose `languages` include the code.
- `pickVoices(speakers, lang, candidates)`: a deterministic pick by gender.
  - It spreads choices so speakers differ.
  - The narrator gets a voice not used by the main cast where possible.
  - Supertonic has only 5 voices per gender, so it reuses voices round-robin once they run out.

**Plan (`src/engine/voice/jobs.ts` `planVibeVoices` L61-97)**
- Call `list_voices`.
- If a non-`en` edition exists and `supertonic_installed` is false, fail with the hint "download Supertonic in VibeTTS Settings > Supertonic".
- For each speaker and each project language:
  - keep an existing id if it is still listed and `overwrite` is off;
  - otherwise use the voice-director's gender and preferred id, validated against `voicesFor`;
  - fall back to `pickVoices`.
- Save `voice.voices`, then `invalidateSpeaker` for changed (speaker, lang) pairs.
- Delete `designVoice` (L250-267).
- Hint text at L129: "run Plan voices: it assigns a VibeTTS voice per character and language".

**Generate (`generateVibeClips`)**
- Look up `voices[speaker]?.[lang]`.
- If it is missing, return a per-speaker error with the plan hint.
- The batch items and the hash are unchanged. The voice id is in the hash, so old clips regenerate once.

**Voice director**
- `src/engine/vn/agents/voice-director.ts` and `seed/prompts/voice-director/plan_voices.md`:
  - Ask per speaker for `{speakerKey, gender: 'female'|'male', voices?: {en?: id, hr?: id}, suggestedRef?}`.
  - The prompt gets the available voice list (id, label, gender, languages) instead of `vocabularyText()`.
  - Keep `voiceSubjects`.
  - The comfy path still needs a description for its voiceRef prompt: keep an optional `description` (free text) in the schema for comfy only.
- `src/engine/voice/vocab.ts`: keep `sha1`, `slugVoiceName` (preview file names) and the gender/age regexes (moved into `catalog.ts` as `guessGender(bible)`). Delete the rest.
- Delete `src/shared/voice-vocab.ts` and `tests/voice-vocab.test.ts`. Add `tests/voice-catalog.test.ts`.

**Commands and protocol (`src/shared/protocol.ts`, `service.ts`, `engine.ts`)**
- Remove `designVoice`.
- Add `setVoice{slug, speakerKey, lang, voice}`. It validates against `list_voices`, saves, calls `invalidateSpeaker` for that language, previews, and emits `voice.preview`.
- `previewVoice` keeps `{slug, speakerKey, voice, lang}`.
- `voice.preview` drops `description` and `seed`.
- `voice.status`:
  - replace `omniInstalled` with `supertonicInstalled`;
  - add `languages` and the user's `english`/`other` defaults;
  - `VibeVoiceView` becomes `{id,label,engine,languages}`.
- Update `COMMAND_TYPE_SET` and both command lists.
- Also fix the missing `studiosStatus`/`openInStudio` pass-through in `engine.ts` ~L641-676, which today falls into "not implemented".

**Renderer**
- `src/renderer/lib/voice.ts`:
  - `voiceOptions(status, lang, englishEngine, current)` filters by `languages.includes(lang)` and engine, and labels with `label`;
  - `vibettsSupport` reports per language whether any voice exists.
- `src/renderer/ui/book/VoiceTab.tsx`:
  - The provider label becomes "VibeTTS (Kokoro / Supertonic)".
  - Add an English-engine select.
  - Each character row has one voice select plus "Listen" for each edition language. A change sends `setVoice`.
  - Remove the designer (vocab selects, seed, "Try another").
  - Show a warning when an HR edition exists and Supertonic is not installed.
  - Update the texts at L37 and L115.
- `src/renderer/store/vn.ts`: update the `VoiceStatusView` and `VoicePreviewView` types and the reducer.
- `ComfyPage.tsx`: the VibeTTS card shows Supertonic installed yes/no.

**CLI (`src/engine/vncli.ts`)**
- `voice status` prints `id`, `engine`, `languages` and `label`, plus the Supertonic state.
- Help text L38 changes.
- New `voice set <slug> <speaker> <lang> <voice>`.

**Seed and docs**
- `seed/config/voice.md`: remove OmniVoice wording; add `englishEngine`; one voice per language.
- `plan_voices.md`.
- Both are seed-refresh tracked (`src/engine/store/seedRefresh.ts` L34/L52 hold the old hashes), so untouched data folders upgrade.
- `docs/protocol.md` Voice section L114-129: also fix the garbled `vibe-tts-flow` path.
- `seed/workflows/chatterbox-multilingual.map.yaml` comment.

**Tests**
- Rewrite `tests/voice-vibetts-client.test.ts` (new `list_voices` fixture; no create/delete).
- Rewrite `tests/voice-vibetts-jobs.test.ts`:
  - the fake has Kokoro and Supertonic voices plus `supertonic_installed`;
  - per-language plan, keep vs overwrite, the missing-Supertonic error;
  - generate uses the per-language voice;
  - `setVoice`;
  - migration of legacy string ids.
- Rewrite `tests/ui-voice-vibetts.test.ts`.

## B. MCP over HTTP plus headless mode

**Dependency.** Add `@modelcontextprotocol/sdk` (same major as the studios, ^1.32), so the server side matches Pixel Studio and Chiptune Studio.

**Tools (`src/engine/mcp/tools.ts`, refactored out of `server.ts` `buildTools`)**
- Keep the 11 existing `vno_*` names and their zod schemas, so existing users and the tests keep working.
- Add tools that wrap existing `VnService` methods. The service already emits its own events, so the UI updates when the engine is shared.

| Area | New tools |
|---|---|
| Projects and settings | `vno_get_project`, `vno_update_settings` (theme/art/music/voice patch), `vno_delete_project` |
| Editions | `vno_get_edition`, `vno_update_beat`, `vno_align_report` |
| Assets | `vno_asset_pick`, `vno_asset_lock`, `vno_asset_unlock`, `vno_asset_generate {kind?, only?, force?}` |
| Voice | `vno_voice_status`, `vno_voice_plan`, `vno_voice_set`, `vno_voice_preview`, `vno_voice_generate` |
| Generators | `vno_studios_status`, `vno_comfy_status`, `vno_comfy_free`, `vno_themes` |
| Build | `vno_android_preflight`, `vno_android_build`, `vno_renpy_config_get`, `vno_renpy_config_set` |
| Queue | `vno_wait {slug, timeoutSeconds}`, `vno_pause_all`, `vno_resume_all`, `vno_stop_now` |

- Results: a readable text item plus `structuredContent` JSON.
- Long jobs return ids at once; `wait: true` or `vno_wait` polls `svc.waitIdle`.
- Server `instructions` give a short workflow. A resource `vn-studio://guide` serves the full guide from the new `docs/mcp-guide.md`: the workflow, the tools, and how voices work.

**HTTP server (new `src/engine/mcp/http.ts`)**
- Port `McpHttpServer` from `pixel-art-generator/src/main/mcp.ts`. It has no Electron imports, so it runs in the engine process (the utility process or plain node).
- Behaviour:
  - `node:http` on `127.0.0.1:<port>/mcp`;
  - stateful sessions with the SDK `Server` and `StreamableHTTPServerTransport`;
  - Host/Origin allow-list;
  - optional bearer token, compared in constant time;
  - body limit;
  - `start()` never throws, and EADDRINUSE goes into `status.error`.
- Calls in different sessions or requests run concurrently, which fixes the `wait` blocking.

**Config (new `seed/config/mcp.md`, schema `src/engine/mcp/config.ts`)**
- `enabled: true`, `port: 7459` (7457, 7458 and 7723 are taken), `token: ''`.
- Environment overrides `VNO_MCP_PORT` and `VNO_MCP_TOKEN`.
- Reload on watcher change: restart the server if the port or token changed.
- Add it to seed-refresh tracking.

**Data-folder lock (new `src/engine/store/lock.ts`)**
- `<dataDir>/engine.lock` holds `{pid, startedAt, mcpUrl}`. It is created with `wx`; a lock whose pid is dead is treated as stale and replaced.
- Every engine start takes it: `index.ts` long-lived mode, `startHeadless` for the CLI, and stdio `mcp`. It is released on stop.
- If the lock is held, the CLI exits with "VN Studio is already running on this data folder (pid N). Use its MCP at <url> or close it."
- Tests use temp data dirs, so they are unaffected. The lock helper still gets its own tests.

**Engine wiring (`src/engine/index.ts`, `engine.ts`)**
- The long-lived mode (used by Electron) takes the lock and starts the MCP HTTP server when `enabled`.
- It emits a new `mcp.status {listening, url, error, enabled, port, tokenSet}` event.
- New commands: `mcpStatus`, and `saveMcpConfig {enabled, port, token?}`, which writes `config/mcp.md`.

**Headless mode**
- `node out/engine/index.js --mcp-only [--port N] [--data DIR]` is the long-lived engine with no Electron:
  - it starts the watcher and MCP HTTP;
  - it prints `MCP listening on http://127.0.0.1:<port>/mcp`;
  - it exits with code 1 if the bind fails or the lock is held, and prints the running engine's URL in that case;
  - it runs until Ctrl+C.
- The `package.json` script `"mcp": "yarn build:engine && node out/engine/index.js --mcp-only"`.
- Packaged app: the Electron main `--mcp-only` flag (`src/main/index.ts`) means no window and no tray (reuse the `VNO_NO_WINDOW`/`VNO_NO_TRAY` paths at L24/L244). It forks the engine with `--mcp-only` and logs the URL. If the single-instance lock is taken, it prints that the app is already running with MCP at its URL, and exits.

**Stdio (`yarn engine -- mcp`)**
- If `engine.lock` names a live engine with an `mcpUrl`, relay stdio to it. Port `pixel-art-generator/src/mcp-stdio/relay.ts`, using the SDK `StdioServerTransport` and `StreamableHTTPClientTransport`.
- Otherwise, take the lock, start an in-process engine, and serve the same tools through the SDK `StdioServerTransport`.
- Replace the hand-rolled `serveMcp`/`McpServer` (keep `jsonSchemaOf` use via the SDK's input schemas).

**UI**
- `SettingsPage.tsx` gets an MCP card:
  - status (listening URL or error), enabled toggle, port, token (set or clear);
  - copy-ready snippets: `claude mcp add --transport http vn-studio http://127.0.0.1:7459/mcp`, the stdio form, and the headless command.
- Add the `mcp.status` reducer in `src/renderer/store`.

**Docs.** `README.md` "Command line and MCP" (L34-50), following the pixel README L29-56:
- "### MCP server (HTTP)" and "### Headless mode (no window)";
- the tool list, ports, environment variables and the lock behaviour;
- fix the stale "Status: Phase 0" line.
- Also update `docs/protocol.md` "CLI and MCP".

**Tests**
- `tests/mcp-http.test.ts`, using the SDK client against a real `McpHttpServer` on port 0:
  - initialize, `tools/list` (old and new names), `tools/call`;
  - a `vno_status` call while a `wait` call is open;
  - Host/Origin rejection, token required, EADDRINUSE reported.
- `tests/engine-lock.test.ts`: acquire, held, stale pid, release.
- Update `tests/vn-interfaces.test.ts` MCP section for the SDK stdio path. Keep the end-to-end `vno_build` case.
- An mcp-config reload test.

## Order of work
1. Branch, ticket folder, and the `engine.ts` studios pass-through fix.
2. Section A (voices), including tests.
3. Section B: tools refactor → HTTP server → config and lock → engine wiring and headless → stdio relay → UI → docs and tests.

These are two independent slices for the `implement` skill: A, and B. The only shared files are the voice tools in B, which call A's new `setVoice`, so B's voice tools come last.

## Verification
1. `yarn typecheck`, `yarn lint`, `yarn test` and `yarn build` all pass.
2. Live voices (VibeTTS running with Supertonic downloaded):
   - `yarn engine -- voice status` lists Kokoro and Supertonic voices;
   - `voice plan <slug>` on the soother book (EN and HR editions) assigns a Kokoro voice for `en` and a Supertonic voice for `hr` per character;
   - `voice <slug>` generates clips in both languages;
   - Ren'Py lint is clean.
   - With Supertonic deleted, the plan fails with the download hint.
3. Headless:
   - `yarn mcp` prints the URL;
   - `claude mcp add --transport http vn-studio http://127.0.0.1:7459/mcp`, then from Claude Code: `vno_list_projects`, `vno_status`, `vno_voice_status`, and `vno_run_pipeline` with `wait` while `vno_status` still answers;
   - a second `yarn mcp` exits with the "already running" message.
4. With the window open (`yarn dev`):
   - the Settings MCP card shows "listening";
   - an outside agent's `vno_asset_regen` shows up live in the Assets tab;
   - `yarn engine -- mcp` (stdio) relays to the app instead of starting a second engine.
5. Old project migration: a `project.md` with `voice.voices: {narrator: "omni:petra", mara: "supertonic:F2"}` loads, drops the omni id, and maps `mara` to both languages.
6. The changelog lists the repos changed (only visual-novels-orchestrator) with branch and files.
