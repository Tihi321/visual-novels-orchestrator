# VN Studio MCP guide

VN Studio turns books from the Scriptorium library into Ren'Py visual novels. These tools run the same pipeline as the app and the command line. If the app is open it shows everything you do live.

## Workflow

1. `vno_list_books` shows the books you can use. `vno_import {source}` makes a project (the language is detected; pass `lang` to override it) and returns its `slug`.
2. `vno_run_pipeline {slug}` runs the pipeline: analyse, art, music, generate, stage, build, lint. It is restartable from any step (`from`), and `force` plans and generates again. It returns at once with job ids; pass `wait: true` or call `vno_wait {slug}` to wait for the end.
3. `vno_status {slug}` shows each step, the jobs and the failures. It answers while another call is waiting.
4. `vno_asset_list {slug}` shows the assets. Change one with `vno_asset_regen` (new prompt, engine or seed), `vno_asset_replace` (your own file), `vno_asset_pick` (another version), `vno_asset_lock` or `vno_asset_unlock`. `vno_asset_generate` makes the assets that still have no file.
5. `vno_build {slug}` writes the Ren'Py game and `vno_lint` checks it. The build result lists the assets that are still placeholders.
6. `vno_add_edition {slug, source, lang}` adds a translated edition (a book folder translated by a person). Assets are reused; only the text is added. `vno_get_edition`, `vno_update_beat` and `vno_align_report` edit and check the text.

Long calls return job ids at once. A client that times out on a long call should poll `vno_wait` with a short `timeoutSeconds` instead.

## Tools

| Area | Tools |
| --- | --- |
| Library and projects | `vno_list_books`, `vno_import`, `vno_list_projects`, `vno_get_project`, `vno_update_settings`, `vno_delete_project` |
| Pipeline | `vno_run_pipeline`, `vno_status`, `vno_wait`, `vno_pause_all`, `vno_resume_all`, `vno_stop_now` |
| Editions | `vno_add_edition`, `vno_get_edition`, `vno_update_beat`, `vno_align_report` |
| Assets | `vno_asset_list`, `vno_asset_replace`, `vno_asset_regen`, `vno_asset_pick`, `vno_asset_lock`, `vno_asset_unlock`, `vno_asset_generate` |
| Voice | `vno_voice_status`, `vno_voice_plan`, `vno_voice_set`, `vno_voice_preview`, `vno_voice_generate` |
| Generators | `vno_studios_status`, `vno_comfy_status`, `vno_comfy_free`, `vno_themes` |
| Build | `vno_build`, `vno_lint`, `vno_android_preflight`, `vno_android_build`, `vno_renpy_config_get`, `vno_renpy_config_set` |

Every result is a text item with the data as JSON, plus the same data as `structuredContent`. A failure is a result with `isError: true` and the message.

## Voices

Spoken lines come from VibeTTS (a local text-to-speech app that has to be running). Voices are fixed: you pick one, you do not design one.

- Each character, and the narrator, has one voice per edition language (`voice.voices.<speaker>.<lang>` in the project).
- Kokoro voices (`af_heart`, `am_adam`, ...) read English only. `supertonic:F1`..`F5` and `supertonic:M1`..`M5` read any language, including Croatian. The Supertonic model has to be downloaded in VibeTTS (Settings > Supertonic).
- `englishEngine` (`kokoro` or `supertonic`) in the project's voice settings says which engine English uses by default.
- `vno_voice_status` shows whether VibeTTS is reachable and lists the voices with their languages.
- `vno_voice_plan` assigns a voice per character and language (existing ones are kept unless `overwrite`).
- `vno_voice_set` gives one speaker a voice in one language and makes a preview clip; `vno_voice_preview` only makes the clip.
- `vno_voice_generate` makes the clips of the project (all languages, or one `lang`). Nothing is made when the project's voice is off (`vno_update_settings` with `voice: {enabled: true}`).

## Notes

- Paths you pass (`file`, `source`) are paths on the machine that runs VN Studio.
- Only `vno_delete_project` deletes a project, and it needs `confirm: true`.
- Only one engine can use a data folder. The app (or `yarn mcp`) runs this server; a second start prints where the running one listens.
