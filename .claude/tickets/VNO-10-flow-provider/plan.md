# VNO-10: Google Flow as a VN Studio provider (images, voices, music)

VN Studio part of hub ticket HUB-07 (hub plan: `C:\projects\Personal\creative-hub\.claude\tickets\HUB-07-flow-vn-provider\plan.md`). Branch `VNO-10-19_hub-roadmap`. The flow-music-mcp side (FMM-11 `flow_narrate` format, 4000 characters, voice genders and cultures; FMM-07 `music_loop`) is done in that repo. The hub phase (4) is not part of this ticket.

User decisions: Q1 to Q12 take the plan's recommendation; music cap `flowMusicMaxSongs` default 4.

## Re-checked against flow-music-mcp (branch FMM-11-12_hub-roadmap)

- `flow_generate {scenes: [{prompt, type, model, aspect_ratio, reference_images, download_quality, max_credits, retries}], project, create_project, out, name, start_number, wait}`; jobs `queued|running|done|failed|cancelled`; `images: [{scene, file, media_id, title, variant}]`; `flow_wait {job_ids, timeout_seconds <= 50}` (`unknown` = lost after a restart), `flow_cancel {job_id}`. `flow_status {detailed}` gives `chrome_running`, `flow.signed_in`, `upload_rights`.
- `flow_narrate {engine, voice, style, out, name, format mp3|wav|ogg|m4a, text <= 4000 for gemini and windows}` returns `output` and `duration`; `flow_voices` has `gemini` (name, description, gender), `gemini_model` (default `gemini-3.8-flash-tts`), `gemini_ready`, `windows` (name, culture, gender).
- `music_generate {sound, instrumental, title, loop_friendly, format, out, name, wait}`, `music_wait`, `music_cancel`, `music_loop {input, out, name, min_seconds}` returns `file` (starts at the loop point, end crossfaded into the start), `loop_seconds`, `score`, `seam.clean`.

## Phases (one commit each)

- [x] 0 groundwork: `studios/flow.ts` client, `flow*` config keys in `config/studios.md`, settings (`art.provider: flow`, `flowModel`, `flowProject`, `music.provider: flow`, `voice.provider: flow`, `flowStyles`, `remote` on versions), `mcp-http.ts` renews the session on HTTP 404, `studiosStatus` has a `flow` entry.
- [x] 1 images: `assets/flow-image.ts`, the `flow` case in `generateAsset`, `flowSem`, the status check before the fan-out, derive/engineFor, vncli, Look tab, docs.
- [x] 2 voices: `voice/flow-catalog.ts`, `voice/flow.ts`, plan and generate branches, set/preview, Voice tab, docs.
- [x] 3 music: `studios/flow-music.ts`, the `music` case, song cap, `max_attempts: 1`, loop file, Look tab note, docs.

## Out of scope / for the hub (phase 4)

Skill text, README table, hub ROADMAP, run log and the live run. See the changelog for what the hub needs.
