# VNO-03 changelog

## 2026-10-19: fixed VibeTTS voices, an HTTP MCP server and a headless mode

**Outcome:**
- Voices are now picked from VibeTTS's fixed Kokoro and Supertonic voices, one per character per edition language. Nothing is created any more.
- VN Studio serves MCP over Streamable HTTP on `127.0.0.1:7459/mcp` (38 `vno_*` tools). It runs inside the app's own engine, or headless with `--mcp-only`.
- A data-folder lock keeps two engines from sharing one folder.

### Repositories
Only `visual-novels-orchestrator` changed, on branch `VNO-03_fixed-voices-mcp-headless` (from `origin/master` 6e2e2e4). VibeTTS (`vibe-tts-flow`) was not changed; VN Studio follows its VTF-06 MCP.

### Voices (slice A)
- **`src/shared/vn.ts`:**
  - `voice.voices` is now speaker → `{en?, hr?}`.
  - A preprocess migrates old projects:
    - `omni:*` ids are dropped;
    - `supertonic:*` ids are set for every language;
    - other ids (Kokoro) are set for `en` only.
  - New optional `voice.englishEngine` (`kokoro` by default, or `supertonic`).
- **`src/engine/voice/vibetts.ts`:**
  - `createVoice`, `deleteVoice` and `CreatedVoice` are removed.
  - `VibeVoice` is `{id,label,engine,languages}`.
  - `VibeVoiceList` follows the new `list_voices` shape.
- **`src/engine/voice/catalog.ts` (new):** voice gender from the id, a gender guess from the bible, and the voices that can read a language.
  - `pickVoices` is deterministic and spreads voices by gender. The narrator goes last.
  - It also builds the voice list shown in the voice-director prompt and holds the Supertonic download hint.
- **`src/engine/voice/jobs.ts`:**
  - Planning gives each speaker a voice for each language and keeps existing ones unless `overwrite` is set.
  - It fails with the download hint when a non-English edition needs Supertonic and it is not installed.
  - It invalidates clips only for the (speaker, lang) pairs that changed.
  - Generate uses `voices[speaker][lang]`.
  - New `setVoice`; `designVoice` is removed.
- **`src/engine/voice/vocab.ts`:** cut down to `slugVoiceName` and `sha1`.
- **Removed:** `src/shared/voice-vocab.ts` and `tests/voice-vocab.test.ts`.
- **`src/engine/vn/agents/voice-director.ts`, `src/engine/vn/handlers.ts`:**
  - The director now answers a gender and optional preferred voices per language, chosen from the live voice list. Comfy still gets a description.
  - The plan job calls `list_voices` first, so an unreachable VibeTTS fails before any model call.
  - When the director does not answer, voices come from the bible.
- **`src/engine/vn/service.ts`:** new `setVoice`, and `voiceStatus` returns the new shape.
- **`src/shared/protocol.ts`:**
  - `setVoice` replaces `designVoice`.
  - `voice.status` has `supertonicInstalled`, `languages`, `english` and `other`.
  - `voice.preview` no longer has `description` or `seed`.
- **`src/engine/engine.ts`:** passes through `setVoice`, plus `studiosStatus` and `openInStudio`. Those two were missing before, so "Open in studio" and studio status did nothing in the UI.
- **`src/engine/vncli.ts`:** `voice status` shows the fixed voices and the Supertonic state. New `voice set <slug> <speaker> <lang> <voice>`.
- **Renderer:**
  - `lib/voice.ts`: per-language voice options.
  - `ui/book/VoiceTab.tsx`:
    - English-engine select;
    - one voice select and "Listen" per speaker per language;
    - a warning when Supertonic is missing;
    - the voice designer is removed.
  - `store/vn.ts`: the new types; previews are keyed by language.
  - `ui/ComfyPage.tsx`: shows whether Supertonic is installed.
- **Seed and docs:** `seed/config/voice.md`, `seed/prompts/voice-director/plan_voices.md` and the `chatterbox-multilingual.map.yaml` comment are updated, along with the Voice section of `docs/protocol.md` (the garbled path is fixed too). The existing seed-refresh hashes already cover these files, so untouched data folders upgrade.
- **Tests:**
  - Rewrote `voice-vibetts-jobs` and `ui-voice-vibetts`.
  - Updated `voice-vibetts-client`.
  - New `voice-catalog` (catalog, legacy migration, old and new director answers).

### MCP and headless (slice B)
- **Dependency:** `@modelcontextprotocol/sdk` ^1.32.1, the same as Pixel Studio. `package.json` gets the script `mcp` (`node out/engine/index.js --mcp-only`).
- **`src/engine/mcp/tools.ts` (new):**
  - The 11 existing tools are kept and 27 are added (38 in total): project settings, editions, assets, voice (`vno_voice_status/plan/set/preview/generate`), generators, Android, Ren'Py config, `vno_wait` and pause/resume/stop.
  - Results carry text and `structuredContent`.
- **`src/engine/mcp/server.ts`:** rewritten on the SDK `Server`, with instructions and the resource `vn-studio://guide` (`docs/mcp-guide.md`, new). The hand-rolled stdio server is gone.
- **`src/engine/mcp/http.ts` (new):** `McpHttpServer`, ported from Pixel Studio:
  - sessions;
  - Host/Origin allow-list;
  - optional bearer token, compared in constant time;
  - 64 MB body limit;
  - EADDRINUSE is reported in the status instead of thrown.
- **`src/engine/mcp/config.ts` and `seed/config/mcp.md` (new):** `enabled`, `port: 7459` and `token`, with `VNO_MCP_PORT` and `VNO_MCP_TOKEN` overrides.
- **`src/engine/mcp/controller.ts` (new):** start, reload on config change, save, the `mcp.status` event, and keeping the lock's URL current.
- **`src/engine/mcp/relay.ts`, `stdio.ts` (new):** `yarn engine -- mcp` relays stdio to the running engine's MCP. If no engine is running, it starts one in-process.
- **`src/engine/store/lock.ts` (new):** `<data>/engine.lock` `{pid, startedAt, mcpUrl}`.
  - It is taken by the long-lived engine, the CLI and stdio MCP.
  - A lock left by a dead pid is replaced.
  - The message when it is held names the pid and the MCP URL.
- **`src/engine/index.ts`, `engine.ts`:**
  - `--mcp-only [--port N]` prints `MCP listening on …` and exits 1 when the port or the folder is taken.
  - The engine gains `startMcp`.
  - New `mcpStatus` and `saveMcpConfig` commands.
  - `stop()` stops MCP and releases the lock.
- **`src/main/index.ts`, `engineClient.ts`:**
  - Electron `--mcp-only` opens no window or tray and exits with the engine's code.
  - If the app's engine is blocked by a headless engine, the window shows a lasting warning: "already running headless (pid, MCP url): stop it and restart".
- **Renderer:**
  - `store/mcp.ts` and `store/store.ts`: the MCP status state.
  - `lib/mcp.ts`: the copy-ready snippets.
  - `ui/McpSettings.tsx` and `SettingsPage.tsx`: an MCP card with status, the enable toggle, port, token and snippets for `claude mcp add`.
- **Docs:** the `README.md` sections "MCP server (HTTP)" and "Headless mode (no window)", the tool list, and `engine.lock` and `mcp.md` in the data folder section; the stale "Phase 0" status is gone. The "CLI and MCP" section of `docs/protocol.md` is updated.
- **Tests:**
  - New `mcp-http`:
    - a real server with the SDK client;
    - `vno_status` answers while another session waits;
    - Host and Origin get 403, a missing or wrong token gets 401;
    - EADDRINUSE is reported;
    - the voice tools work with a fake VibeTTS.
  - New `engine-lock`, `mcp-config` and `ui-mcp`.
  - `vn-interfaces` now runs its MCP section on the SDK client and keeps the end-to-end `vno_build`.

### Deviations from the plan
- `seedRefresh.ts` was not edited. The existing hash history already covers the voice seed files, and a new seed file (`mcp.md`) is tracked automatically.
- Generate skips a speaker with no voice for a language instead of failing the whole step:
  - it falls back to the narrator's voice;
  - if the narrator has none either, those beats are skipped and the step message gives the plan hint.
- `--mcp-only` serves MCP even when `config/mcp.md` has `enabled: false`.
- The legacy-id migration is tested at the schema level (`voice-catalog`), not through a `project.md` on disk.
- Added beyond the plan: a lasting window warning when a headless engine holds the data folder.

### Verification
- `yarn typecheck`: clean. `yarn lint`: clean. `yarn build`: succeeds.
- `yarn test`: 42 files, 455 tests passed.
- Live run, with the real VibeTTS (`python -m vibetts --mcp-only`, Supertonic installed) and VN Studio `node out/engine/index.js --mcp-only --port 17460` on a scratch data folder with the `linear-en` fixture plus a `linear-hr` edition. All steps used an SDK HTTP client:
  - `tools/list` returned 38 tools.
  - `vno_update_settings` turned voice on for en and hr.
  - `vno_voice_plan` (no LLM running, so voices came from the bible) gave:
    - mara: `bf_lily` / `supertonic:F5`;
    - tomas: `bm_george` / `supertonic:M5`;
    - narrator: `af_heart` / `supertonic:F4`.
  - `vno_voice_generate` with `wait` made 20 en and 20 hr clips, MP3 at 44.1 kHz. `vno_status` answered while that call was still waiting.
  - A second `--mcp-only` on the same folder was refused with the lock message.
- Slice B's smoke run (by the implementer):
  - the stdio relay to a live engine works;
  - with a stale lock, stdio starts its own engine;
  - a port clash gives "Port … is already in use".

**Not run:**
- Electron in a window: the Settings MCP card, the blocked-engine warning, Electron `--mcp-only`, and the VoiceTab UI checked by eye.
- Ren'Py lint with voice on, on the soother book.
- `claude mcp add` from a real Claude Code session.

### Follow-ups and known limitations
- On Windows, a hard kill leaves `engine.lock` behind. The next start replaces it because the pid is dead.
- Starting Electron with `--mcp-only` while the app window is running also raises that window (the single-instance `second-instance` handler) before the second process exits.
- Supertonic has only 5 voices per gender, so casts larger than that reuse voices in non-English editions.

### Commit status
Uncommitted, on `VNO-03_fixed-voices-mcp-headless`.
