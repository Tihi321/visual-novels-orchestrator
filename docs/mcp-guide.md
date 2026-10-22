# VN Studio MCP guide

VN Studio turns books from the Scriptorium library, or a story you write straight into it, into Ren'Py visual novels. These tools run the same pipeline as the app and the command line. If the app is open it shows everything you do live.

## Workflow: from a book

1. `vno_list_books` shows the books you can use (`vno_set_library {path}` points it at another Scriptorium folder). `vno_import {source}` makes a project (the language is detected; pass `lang` to override it) and returns its `slug`.
2. `vno_run_pipeline {slug}` runs the pipeline: analyse, art, music, generate, stage, build, lint. It is restartable from any step (`from`), and `force` plans and generates again. It returns at once with job ids; pass `wait: true` or call `vno_wait {slug}` to wait for the end.
3. `vno_status {slug}` shows each step, the jobs and the failures. It answers while another call is waiting.
4. `vno_asset_list {slug}` shows the assets. Change one with `vno_asset_regen` (new prompt, engine or seed), `vno_asset_replace` (your own file), `vno_asset_pick` (another version), `vno_asset_lock` or `vno_asset_unlock`. `vno_asset_generate` makes the assets that still have no file.
5. `vno_build {slug}` writes the Ren'Py game and `vno_lint` checks it. The build result lists the assets that are still placeholders.
6. `vno_add_edition {slug, source, lang?}` adds a translated edition (a book folder translated by a person or by Book Translator; without `lang` its language is detected). Assets are reused; only the text is added. `vno_get_edition`, `vno_update_beat` and `vno_align_report` edit and check the text.

Long calls return job ids at once. A client that times out on a long call should poll `vno_wait` with a short `timeoutSeconds` instead.

## Workflow: write the story yourself (no book folder)

1. `vno_create_project {book, lang?, settings?}` makes a project from a story written as JSON and derives its asset list (backgrounds, character sheets, sprites per expression, cover, music). The language is detected from the text unless you pass `lang`. Pass `slug` in `book` when the title is not in Latin letters (slugs are ASCII; a Japanese title alone gives `book`). `settings` takes the same parts as `vno_update_settings` (theme, art, music, voice).
2. `vno_get_story {slug, chapter?}` reads it back with every id. Edit it with `vno_story_edit {slug, ops}` (a list of operations, all or nothing) or the one-operation tools (`vno_beat_add`, `vno_scene_update`, `vno_character_set` ...). A build is needed to see a change.
3. `vno_plan {slug, wait: true}` writes the art prompts and the music plan without generating anything. Set any prompt yourself with `vno_asset_set` (the planners then keep it), the chapter music with `vno_set_music`, and the staging (transitions, who stands where) with `vno_set_cues`.
4. `vno_asset_generate {slug}` makes the images and tracks with ComfyUI or the studios (or use `vno_asset_replace` with your own files), then `vno_build` and `vno_lint`. `vno_run_pipeline {slug, from: "art"}` does steps 3 and 4 in one go.
5. Other languages: `vno_edition_set {slug, lang, ...}` writes the text of another language as JSON (or `vno_add_edition` with a translated book folder).

### The story JSON

```json
{
  "title": "The Harbour Light", "genre": "mystery", "lang": "en", "coverBrief": "A lighthouse in fog, a girl with a lantern.",
  "characters": [{ "key": "mara", "name": "Mara", "looks": "A girl of twelve, short red hair, yellow raincoat, green boots." }],
  "places": [{ "key": "harbour", "name": "Harbour", "looks": "A small stone harbour with wooden boats." }],
  "chapters": [
    {
      "title": "The Fog",
      "choices": [{ "text": "Climb the lighthouse", "to": 2 }, { "text": "Stay", "to": 3 }],
      "scenes": [
        {
          "place": "harbour", "time": "dusk", "description": "Fog rolls in.",
          "beats": [
            { "text": "The fog came fast." },
            { "cast": ["mara"] },
            { "speaker": "mara", "expression": "worried", "text": "Why is the light out?" }
          ]
        }
      ]
    },
    { "title": "The Light", "ending": "The boats come home.", "scenes": [] },
    { "title": "Waiting", "ending": "Morning comes.", "scenes": [] }
  ]
}
```

- **Characters and places**: `key` is made from the name when left out (lowercase ascii and `_`; a Cyrillic, Greek, Japanese or Korean name is written in Latin letters, a Chinese one gets a short hash, so `Наташа` is `natasha`). `looks` is what the images show, so write it out in full. A character may have `aliases`: other names the story calls it by (`"the bald man"`). A line whose speaker is an alias belongs to the character and shows the alias in the game, so the reader is not told the name early. An edition translates an alias under the character key plus `#<n>` (`characterNames: {"kessler#1": "..."}`, n counted from 1).
- **Beats**: a cast beat `{ cast: ["mara", "tom"] }` says who is on screen from there on (at most three are shown); a line `{ speaker, expression?, text }`; a narration `{ text }`. `type` may be left out. Speakers and places may be named by key or by name; an unknown one is kept with a warning (no sprite, no place looks).
- **Expressions**: neutral, happy, sad, angry, surprised, worried, scared, thinking. Other words are mapped to the nearest one. Each character gets a sprite per expression it uses. A book may name its own set (`expressions: ["neutral", "smug", "tired"]`, lowercase letters and digits), and a character may add more (`expressions` on the character); a line's expression is then mapped to the nearest in that set.
- **Pictures and sounds**: the story lists `images` (`{key, description, display: "full"|"insert", characters?}`; a full one is a CG over the whole scene, an insert a small object or document in the middle) and `sounds` (`{key, kind: "sfx"|"ambience", description}`). In the story JSON a beat shows a picture with `image: "key"` (`null` hides it), plays a sound effect with `sfx: "key"`, and starts an ambience with `ambience: "key"` (`null` stops it). A scene has `music: "music_02"` (`null` is silence) and `ambience`. In the edit operations below `"none"` means the same, and null clears the cue. Their assets are `cg_<key>`, `sfx_<key>` and `amb_<key>`: a CG is drawn from the sheets of its characters, an ambience is made with the music engine, and a sound effect needs a file (`vno_asset_import`) unless a `sound.sfxEngine` is set in `vno_update_settings`. A cue to a key that is not listed is an error; a cue to a sound with no file is skipped with a warning in the build.
- **Backgrounds**: one per place and time (`bg_<place>_<time>`), shared by every scene with the same pair.
- **Choices and endings**: a chapter with `choices` leads to the chapter numbers in `to`; a book with any choice is a choice book (else linear). In a choice book a chapter without choices ends the game (its `ending` text, else "The End"); in a linear book only the last chapter ends. Chapter numbers default to their position.
- **Ids**: chapters are numbers, scenes `ch01.s02`, beats `ch01.s02.b003`. They never change: a new scene or beat gets the next free number of its chapter or scene wherever it goes, so editions, voice clips and translations keep matching.

### Editing operations

`vno_story_edit {slug, ops: [...]}` applies them in order; if the result is invalid (a choice to a missing chapter, a cast member that is not a character ...) nothing is saved and the error says why. Each also exists as its own tool with the same fields (`vno_<area>_<action>`, for example `vno_beat_add {slug, sceneId, beats}`).

| op | Fields | Notes |
| --- | --- | --- |
| `book.update` | title, author, genre, style, coverBrief, format, expressions | `expressions` replaces the set, null clears it. |
| `character.set` | key, name, looks, voice, aliases, expressions | Adds or changes. Renaming updates the speaker labels (a line under an alias keeps it). `aliases` replaces the list, null clears it. |
| `character.remove` | key, force | Refused while it is in a cast or speaks, unless `force`. |
| `place.set` | key, name, looks | Adds or changes. |
| `place.remove` | key, force | Refused while a scene uses it, unless `force`. |
| `chapter.add` | chapter, n, after | `chapter` has the shape of a chapter above. |
| `chapter.update` | n, title, summary, ending, choices | `choices` replaces the list. |
| `chapter.remove` | n | Refused while a choice leads to it. |
| `scene.add` | chapter, scene, at | `at`: position from 0, default the end. |
| `scene.update` | sceneId, place, time, description, breakBefore, music, ambience | The background follows place and time. `music`/`ambience`: a key, "none" for off, null clears. |
| `scene.remove` | sceneId | |
| `beat.add` | sceneId, beats, at or after | `after` is a beat id. |
| `beat.update` | beatId, text, speaker, expression, cast, image, sfx, ambience | `image`/`ambience`: a key, "none" to hide or stop, null clears the cue. |
| `image.set` / `image.remove` | key, description, display, characters / key, force | The picture catalogue. |
| `sound.set` / `sound.remove` | key, kind, description / key, kind, force | The sound catalogue. |
| `beat.remove` | beatIds | |

After an edit the result lists what happened to the assets: `added` and `orphaned` (no longer needed; kept, never deleted), `cleared` (their subject changed and they had no image yet: their prompt is gone, run `vno_plan` again), `stale` (they have an image of the old subject: `vno_asset_regen`), `keptLocked` (locked or custom, untouched) and `keptByHand` (a prompt you set with `vno_asset_set`, untouched). The primary edition follows the story; other editions drop the text of removed beats and keep the rest.

### Prompts, music and staging by hand

- `vno_asset_set {slug, id, prompt?, negative?, size?, engine?, seed?}` writes an asset's plan without generating. A prompt you set is kept by `vno_plan` and the pipeline, even with `refreshPrompts` or `force`. A locked asset is refused.
- `vno_set_music {slug, menu?, chapters?: {"1": "music_02"}, scenes?: {"ch01.s02": "music_03"}, seconds?: {"music_01": 90}, replace?}` sets the menu track, the track of each chapter and each track's length (60 to 180 s). Only `slug` reads the plan. The music step keeps it and only fills what is missing. The number of tracks is `music.tracks` in `vno_update_settings`.
- `vno_set_cues {slug, menuMusic?, chapters?, scenes?: {"ch01.s02": {"transition": "fade", "pause": 1, "music": "music_03", "ambience": "rain"}}, casts?: {"ch01.s02.b001": {"mara": "left", "tom": "right"}}, replace?}` sets the stage cues. Only `slug` reads them. The stage step then keeps them, does not ask the stage-director, and only adds defaults for what you left out.

## Hand-made art

Draw the images yourself (for example with the pixel-studio MCP) and VN Studio never calls ComfyUI for an image.

1. `vno_update_settings {slug, art: {provider: "hand"}}` (any art style; `null` goes back to ComfyUI). The CLI flag is `--art-provider hand`.
2. Run the pipeline. The art step plans no prompts (`vno_plan` still writes them, as briefs for the drawing), the generate step makes only music and voice and says how many images wait for a file. `vno_asset_generate` and `vno_asset_regen` on an image are refused; on music they work.
3. Draw each image and set it with `vno_asset_replace {slug, id, file}` (`vno_asset_list` has the ids): the file is used as it is. Or use `vno_asset_import {slug, id, file}` for an image that is not ready: it does what a generated image gets (a sprite on a plain background is cut out with the flat-colour key, trimmed and scaled to the sprite height; a background is fitted to 1920x1080; a pixel project gets pixel art), keeps your original next to the new version, and never calls ComfyUI in this mode (an image that is transparent already is left alone; `removeBackground: "birefnet"` asks for ComfyUI on purpose; `process: "none"` keeps the file exactly). Sprites: transparent background, bottom-aligned, any height up to the screen. Backgrounds: 1920x1080. Cover: landscape 1920x1080, the left third calm (the menu buttons go there); a portrait cover still works, the menu shows it whole, centred, over a blurred copy. Character sheets are only a reference: they are not needed, and a missing one is not a placeholder.
   Voice you recorded yourself: `vno_voice_import {slug, lang, folder}` takes a folder of `<beatId>.<ext>` clips (or `beatId` with `file` for one); VibeTTS and ComfyUI generation then keep them (and say how many), and changing a speaker's voice does not drop them.
4. `vno_build` works at any time: an image without a file gets a placeholder and is listed in the build result.

## Do the model work yourself

Eight pipeline steps ask a model: `analyse` (script-analyst), `art plan` (art-director), `music plan` (composer), `stage` (stage-director), `voice plan` (voice-director), `edition align` (edition-aligner), `art review` (art-critic) and the run `summary` (director). Instead of LM Studio, Strata or a paid API, you can answer them yourself, with nothing spent. Set a role (or one agent) to the model `client/claude-code`; its jobs then wait until you take them over MCP.

**Setting it up.** The `client` provider is on in the seed's `config/providers.md` and nothing uses it until you pick it. An older data folder gets the entry once, at the next start (a one-time migration; delete it later and it stays gone). It looks like this:

```yaml
- id: client
  kind: client
  local: true
  concurrency: 8
  models:
    - id: claude-code
      vision: true     # the art-critic sends images
      context: 200000  # recorded only: VN Studio sizes nothing by it
```

**Choosing what the client does.**
- **One project (the way to do it):** `vno_update_settings {slug, models: {"art-director": "client/claude-code", "stage-director": "client/claude-code"}}`. These models go first for the jobs of that project, before the agent's own model and the role's list, which stay as the fallback; other projects are not touched. The refs are checked (an unknown role or model is refused); `null` for a role clears it (`models: {"art-director": null}`). They are saved as `models` in the project's `project.md`.
- **Every project (global alternative):** edit the data folder, there is no `set_model` tool. In `config/roles.md` put `client/claude-code` first in the role's `models` list, for example `stage-director: {models: [client/claude-code, strata]}`; it is reloaded at once, and a request that is already waiting is asked again on the new model. The roles are `script-analyst`, `art-director`, `composer`, `stage-director`, `voice-director`, `edition-aligner`, `art-critic` and `director`. One agent: `model: client/claude-code` in `agents/<agent>.md`.
- The models of a project are saved even when jobs cannot use them (no key, server down): `vno_update_settings` then returns `warnings`, and `vno_status` / `vno_get_project` show `models: {role: {ref, usable, reason?}}`. The job log says `project model <ref> not used: <reason>`. A key that is not in VN Studio's credential store is also looked for under Scriptorium's and Book Translator's (`VNO_SHARED_KEYS=0` turns that off).
- Put things back when you are done: a role left on `client` with nobody answering stalls every job that uses it. The Models page shows `client` as local and free.

**The loop.**
1. Start the work: `vno_run_pipeline {slug, from}` (or `vno_plan`, `vno_add_edition`, ...), then `vno_wait {slug}`. It returns as soon as nothing runs except jobs that wait for you, with `clientTasks: n` and a hint (it does not block until the timeout). `vno_status` shows `clientTasks: {waiting, leased}` too, and `vno_client_tasks` lists the tasks (id, role, task, project, age).
2. `vno_get_task {role?, book?, task?}` leases the oldest matching task to you for 30 minutes. You get `{taskId, meta: {job, call, role, task, book, agent, unit}, turns, system, user, schema?, maxTokens?, output, leaseMinutes}`, or `{none: true, waiting}`. Each text is sent once. `turns: "single"` (nearly every task) has `system` and `user`. `turns: "multi"` (a repair round, the draw loop) has `system` and `messages: [{role, content}]`, the turns after the system text in order, and no `user`: answer the last user turn.
3. Write the answer as `output` says: one JSON object that matches `schema` (no prose, no code fence), or the text only.
4. `vno_submit_task {taskId, text}`. When the task has a schema the text is checked first: `{accepted: false, problems}` means fix it and submit again (the task stays yours, so the engine does not spend a repair round). `{accepted: true}` lets the job go on as if a model had answered. `vno_release_task {taskId}` gives a task back.
5. Repeat until `vno_get_task` says `none`, then `vno_wait` again, until the steps are done. A lease that runs out (30 minutes) puts the task back in the queue, so several clients, or subagents with one task each, can work in parallel.

**Vision.** The art-critic's tasks (`art review`) carry images. `vno_get_task` returns them as MCP image content after the text, in order; the `user` text has `[image 1]`, `[image 2]` where each one sat. That role needs a client that can look at images.

**Batching.** `analyse` asks in batches of 30 items, `art plan` in batches of 10 assets and `edition align` in batches of 25 beats. One job makes several tasks in a row: the next one appears after you answer the previous one (the ids are `<job>#1`, `<job>#2`, ...). So take tasks until `none` and `vno_wait` returns with no `clientTasks`, not just one per step.

**Good to know.**
- A job that waits for you does not hold its agent: only jobs on other models count against an agent's `max_parallel` (1 by default, `agents/<agent>.md`), so one agent has several tasks waiting at once. The client provider's `concurrency` (8) is the limit: that many jobs wait, the next ones queue behind them.
- No timeout, and the provider is never marked down: a waiting job just waits. A job you stop (`vno_stop_now`, a model change) drops its task, and a later submit gets "task not found (it was aborted, answered, or the engine restarted)". The queue lives in memory: an engine restart loses the tasks, and the running jobs ask again.
- Pixel Studio drawing (the `pixel-studio-draw` mode, task `vn.assets.draw`, which asks the art-director role) works with `client` too: `drawMode: auto` in `config/studios.md` draws a sprite from a grid when the model is the client, in one task with no time limit. The task asks for `{rows: [...]}`: the sprite as h rows of w characters, `.` for a transparent pixel and `0-9a-zA-Z` for the palette colour of that index (the task lists the palette and the reference already reduced to it); `vno_submit_task` checks the row count, the length and the alphabet. Answer with the cleaned-up rows. (`drawMode: loop` is the multi-turn way: one task per step, bounded by `drawSteps`; with a client model it has no time limit.) Images and music still come from ComfyUI and Chiptune Studio.
- Jobs that never call a model (analyse with nothing to settle, stage with every cue set by hand, build, lint) run as usual.

## The queue

- Order. Jobs have a priority: what you ask for with a tool (`vno_plan`, `vno_asset_regen`, `vno_asset_generate`, `vno_build`, `vno_lint`, the voice tools, `vno_add_edition`) has priority 1 and goes before the jobs of the pipeline's own chain (0), oldest first inside each. A job still waits for the jobs it depends on.
- Jobs that need no model (analyse with nothing to settle, stage with every cue set by hand, an art plan in hand mode, and the like) start at once, without waiting for a model slot, even when Strata is down or the client queue is full.
- `vno_stop_now` stops the running jobs and pauses; they and everything queued run again after `vno_resume_all`, oldest first (a `vno_plan` asked for in between goes first, by its priority). `vno_stop_now {drop: true, slug?}` also deletes the queued jobs (of that project, or all) and marks their pipeline steps skipped, so a resume starts nothing old. `vno_clear_queue {slug?, confirm: true}` drops the queued jobs without stopping the running ones.
- A sheet and its sprites. `vno_asset_regen` on a character sheet is made before the sprite jobs already queued for that sheet (they wait for it). The sprites already made from the old sheet are returned as `staleSprites`; `sprites: true` makes them again after the sheet. A regenerated sprite waits for a sheet job that is queued or running.
- A new `art.stylePrompt` (`vno_update_settings`) is written into the prompts that have no image yet. The answer's `restyle` lists `kept` (prompts written with other words: `vno_plan {refreshPrompts: true}` writes them again) and `generated` (assets that already have an image: `vno_asset_regen` makes them again). Sprites have no style words.

## Languages

- `vno_languages` lists the languages a project or edition can use: the 31 that VibeTTS Supertonic reads plus Book Translator's (37 in all, for example en, hr, de, fr, es, it, pt, nl, pl, cs, ru, uk, sr, ja, ko, zh, ar, he, fa, hi). More, or changes, go in `config/languages.md` in the data folder.
- The primary language is detected on import and on `vno_create_project`; `vno_add_edition` detects the language of a translated folder when `lang` is left out.
- Each edition is a Ren'Py language; the game has a language picker and starts in the primary language.
- The game menus are translated for every built-in language (49 strings each, written by a language model: native review is welcome). A `ui` table in `config/languages.md` overrides single strings; a language you add without `ui` keeps the English menus and the build says so.
- Fonts. A theme's text font covers some scripts (`fonts.scripts` in `theme.yaml`). For a language in another script the build gives that language a font of its own, in `game/vno_fonts.rpy`: the `font` of the language in `config/languages.md`, else `<data>/fonts/<script>.ttf` (or `.otf`, `.ttc`; `<script>-bold.ttf` is the bold face), else an installed system font, else DejaVuSans for Cyrillic, Greek, Arabic and Hebrew. A system font is copied into the game with a warning to check its license before you share the game. With no font the build warns and says what to do. `vno_fonts_fetch {script}` downloads a free Noto Sans font (SIL Open Font License) for `han` (Chinese), `kana` (Japanese), `hangul` (Korean), `devanagari` or `thai` into `<data>/fonts/`. It never runs by itself.
- Right-to-left. For Arabic, Hebrew and Persian the build turns on Ren'Py's right-to-left text and mirrors the menu layout (the name box, the dialogue, the navigation buttons, the history) for those languages only, in `game/vno_rtl.rpy`. The other languages of the game keep the normal layout. The layout cannot be checked by the Ren'Py lint: look at it once in the game.

## Tools

| Area | Tools |
| --- | --- |
| Library and projects | `vno_list_books`, `vno_set_library`, `vno_import`, `vno_list_projects`, `vno_get_project`, `vno_update_settings`, `vno_delete_project`, `vno_languages` |
| Story | `vno_create_project`, `vno_get_story`, `vno_story_edit`, `vno_book_update`, `vno_character_set`, `vno_character_remove`, `vno_place_set`, `vno_place_remove`, `vno_chapter_add`, `vno_chapter_update`, `vno_chapter_remove`, `vno_scene_add`, `vno_scene_update`, `vno_scene_remove`, `vno_beat_add`, `vno_beat_update`, `vno_beat_remove` |
| Languages and fonts | `vno_languages`, `vno_fonts_fetch` |
| Pipeline | `vno_run_pipeline`, `vno_plan`, `vno_status`, `vno_wait`, `vno_pause_all`, `vno_resume_all`, `vno_stop_now`, `vno_clear_queue` |
| Model work by you (`client/claude-code`) | `vno_client_tasks`, `vno_get_task`, `vno_submit_task`, `vno_release_task` |
| Editions | `vno_add_edition`, `vno_edition_set`, `vno_get_edition`, `vno_update_beat`, `vno_align_report` |
| Assets, music, staging | `vno_asset_list`, `vno_asset_set`, `vno_asset_replace`, `vno_asset_import`, `vno_asset_regen`, `vno_asset_pick`, `vno_asset_lock`, `vno_asset_unlock`, `vno_asset_generate`, `vno_set_music`, `vno_set_cues` |
| Voice | `vno_voice_status`, `vno_voice_plan`, `vno_voice_set`, `vno_voice_preview`, `vno_voice_generate`, `vno_voice_import` |
| Generators | `vno_studios_status`, `vno_comfy_status`, `vno_comfy_free`, `vno_themes` |
| Build | `vno_build`, `vno_lint`, `vno_android_preflight`, `vno_android_build`, `vno_renpy_config_get`, `vno_renpy_config_set` |

Every result is a text item with the data as JSON, plus the same data as `structuredContent`. A failure is a result with `isError: true` and the message.

## Voices

Spoken lines come from VibeTTS (a local text-to-speech app that has to be running). Voices are fixed: you pick one, you do not design one.

- Each character, and the narrator, has one voice per edition language (`voice.voices.<speaker>.<lang>` in the project).
- Kokoro voices (`af_heart`, `am_adam`, ...) read English only. `supertonic:F1`..`F5` and `supertonic:M1`..`M5` read the 31 Supertonic languages (`supertonic: true` in `vno_languages`). The Supertonic model has to be downloaded in VibeTTS (Settings > Supertonic).
- `englishEngine` (`kokoro` or `supertonic`) in the project's voice settings says which engine English uses by default.
- `vno_voice_status` shows whether VibeTTS is reachable and lists the voices with their languages.
- `vno_voice_plan` assigns a voice per character and language (existing ones are kept unless `overwrite`).
- `vno_voice_set` gives one speaker a voice in one language and makes a preview clip; `vno_voice_preview` only makes the clip.
- `vno_voice_generate` makes the clips of the project (all languages, or one `lang`). Nothing is made when the project's voice is off (`vno_update_settings` with `voice: {enabled: true}`).

## Notes

- Paths you pass (`file`, `source`, `path`) are paths on the machine that runs VN Studio.
- Only `vno_delete_project` deletes a project, and it needs `confirm: true`.
- Only one engine can use a data folder. The app (or `yarn mcp`) runs this server; a second start prints where the running one listens.
