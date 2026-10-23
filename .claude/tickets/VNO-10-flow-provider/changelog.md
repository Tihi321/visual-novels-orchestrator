# VNO-10 changelog (2026-10-22)

Google Flow as a provider next to ComfyUI, Pixel Studio, Chiptune Studio and VibeTTS, through flow-music-mcp over MCP. Nothing changes for a project that does not pick it. Nothing was run live (no Flow call, no credits): every test uses a fake `FlowClient`.

## Behaviour

- **Client** (`src/engine/studios/flow.ts`): `status`, `generateImage` (`flow_generate`, `wait: 0`, then `flow_wait` every `flowPollS` until done; abort or timeout calls `flow_cancel`; a lost job is `lost`), `voices`, `narrate` (only the engines `gemini` and `windows`), `song` + `music_wait`, `loop` (`music_loop`). Errors have a kind: `unreachable`, `signedOut`, `busy`, `rateLimit`, `credits`, `lost`, `aborted`, `timeout`, `tool`. `mcp-http.ts` starts a new session once on HTTP 404 (flow-music-mcp restarted), for every studio client.
- **Config** (`config/studios.md`, defaults in code, old folders need no migration): `flowUrl` (`VNO_FLOW_URL`), `flowRepo`, `flowToken` (`FLOW_MUSIC_MCP_TOKEN`), `flowPollS` 40, `flowJobTimeoutS` 900, `flowMusicTimeoutS` 600, `flowImageQuality` (2K for background, cover, full CG; 1K for sheet, sprite, insert), `flowVoicePauseMs` 1500, `flowVoiceRetries` 3, `flowMusicMaxSongs` 4.
- **Images** (`art.provider: flow`, `flowModel`, `flowProject`; CLI `--art-provider flow --flow-model`; Look tab): pseudo engine `flow`, one image per job, `max_credits: 0`, one Flow job at a time (`flowSem`), project `vno-<slug>`. Sprites are new images with the sheet as reference (`asset:<media id>` from the sheet version's `remote.id`, else the sheet file), asked for on a plain flat grey background; CGs send up to 3 sheets; a stale media id falls back to the files once. The raw sprite is kept as `v<n>.raw.jpeg` and `reprocess` works. The generate step checks flow-music-mcp once before the fan-out. No silent fallback to ComfyUI; `vno_asset_regen {engine}` uses it for one asset.
- **Voices** (`voice.provider: flow`, `flowStyles`; Voice tab): ids `gemini:<Name>` and `windows:<Voice Name>`; plan picks by gender (Gemini voices read every language; Windows voices only without a key and only for their culture); one clip per beat in the `config/voice.md` format; hash `flow|voice|lang|style|format|text`; pause between calls; rate limit retried after 10, 30, 90 s; a beat over 4000 characters fails alone; imported clips kept; `vno_voice_set` and `vno_voice_preview` work. The paid engine `flow` is never sent.
- **Music** (`music.provider: flow`, never a default): pseudo engine `flow-music`; refuses at `flowMusicMaxSongs` songs per project before any call; `music_generate` instrumental with loop wording, then `music_loop`: the loop file is `v<n>.mp3` with `loopStartSec` 0 and `loopEndSec` its length, the whole song `v<n>.src.mp3`; no good loop (score under 0.5 or the tool fails) keeps the whole song without loop points and a warning; `max_attempts: 1`; `remote` holds the song id.

## Files

New: `src/engine/studios/flow.ts`, `studios/flow-music.ts`, `assets/flow-image.ts`, `voice/flow.ts`, `voice/flow-catalog.ts`; tests `studios-flow-client.test.ts`, `flow-generate.test.ts`, `voice-flow-jobs.test.ts`, `flow-music.test.ts`, `flow-fakes.ts`. Changed: `shared/vn.ts`, `shared/protocol.ts`, `studios/config.ts`, `studios/mcp-http.ts`, `assets/generate.ts`, `assets/derive.ts`, `voice/jobs.ts`, `voice/catalog.ts`, `voice/vibetts.ts`, `vn/service.ts`, `vn/handlers.ts`, `engine.ts`, `mcp/tools.ts`, `vncli.ts`, `renderer/ui/book/LookTab.tsx`, `VoiceTab.tsx`, `seed/config/studios.md`, `docs/mcp-guide.md`, `docs/protocol.md`, `README.md`, `ROADMAP.md`.

## Deviations from the hub plan

- Voice status for Flow is in `vno_studios_status` (a `flow` entry: reachable and signed in), not in `voiceStatus` (VibeTTS).
- The Voice tab for Flow shows the plan and generate buttons and the planned voices; a voice is changed with `vno_voice_set`, there is no per-speaker picker yet.
- Voice candidates: Gemini voices when the key is ready, else Windows voices of the language's culture (not both together).
- Music: the loop comes from `music_loop` (FMM-07 is merged).
- Everything lives on the shared branch `VNO-10-19_hub-roadmap`, not `VNO-10_flow-provider`.

## Verification

`yarn test`: 62 files, 827 tests pass (783 before VNO-10, 44 new). `yarn typecheck` and `yarn lint`: clean. Not verified (needs the live hub run, phase 4): `asset:<media id>` as a reference in flow-music-mcp's direct composer (only a local file was verified there), character likeness across sprites, 2K downloads under load, Gemini limits on a whole book (and Croatian by ear), real loop quality of Flow Music songs, the credit cost of a song.

## What the hub (phase 4) needs

- Start `flow-music-mcp` (`hub.ps1 start flow-music-mcp`), signed in (`yarn login`); in its `.env`: `FLOW_MUSIC_MCP_UPLOAD_RIGHTS=agree` (only needed to upload a sheet that Flow did not make) and a Gemini key for voices.
- Skill: `vno_update_settings {art: {provider: "flow"}, voice: {enabled: true, provider: "flow", langs: [...]}}`; `music.provider: "flow"` only after the user agrees (credits, cap `flowMusicMaxSongs`); a small VN takes 20 to 30 minutes of images; check `vno_studios_status` (the `flow` entry) first.
- Live check list: the steps of the hub plan "Verification", plus the open items above; log ids, times and credits in `runs/<slug>.md`.
