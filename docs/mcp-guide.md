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

- **Characters and places**: `key` is made from the name when left out (lowercase ascii and `_`). `looks` is what the images show, so write it out in full.
- **Beats**: a cast beat `{ cast: ["mara", "tom"] }` says who is on screen from there on (at most three are shown); a line `{ speaker, expression?, text }`; a narration `{ text }`. `type` may be left out. Speakers and places may be named by key or by name; an unknown one is kept with a warning (no sprite, no place looks).
- **Expressions**: neutral, happy, sad, angry, surprised, worried, scared, thinking. Other words are mapped to the nearest one. Each character gets a sprite per expression it uses.
- **Backgrounds**: one per place and time (`bg_<place>_<time>`), shared by every scene with the same pair.
- **Choices and endings**: a chapter with `choices` leads to the chapter numbers in `to`; a book with any choice is a choice book (else linear). In a choice book a chapter without choices ends the game (its `ending` text, else "The End"); in a linear book only the last chapter ends. Chapter numbers default to their position.
- **Ids**: chapters are numbers, scenes `ch01.s02`, beats `ch01.s02.b003`. They never change: a new scene or beat gets the next free number of its chapter or scene wherever it goes, so editions, voice clips and translations keep matching.

### Editing operations

`vno_story_edit {slug, ops: [...]}` applies them in order; if the result is invalid (a choice to a missing chapter, a cast member that is not a character ...) nothing is saved and the error says why. Each also exists as its own tool with the same fields (`vno_<area>_<action>`, for example `vno_beat_add {slug, sceneId, beats}`).

| op | Fields | Notes |
| --- | --- | --- |
| `book.update` | title, author, genre, style, coverBrief, format | |
| `character.set` | key, name, looks, voice | Adds or changes. Renaming updates the speaker labels. |
| `character.remove` | key, force | Refused while it is in a cast or speaks, unless `force`. |
| `place.set` | key, name, looks | Adds or changes. |
| `place.remove` | key, force | Refused while a scene uses it, unless `force`. |
| `chapter.add` | chapter, n, after | `chapter` has the shape of a chapter above. |
| `chapter.update` | n, title, summary, ending, choices | `choices` replaces the list. |
| `chapter.remove` | n | Refused while a choice leads to it. |
| `scene.add` | chapter, scene, at | `at`: position from 0, default the end. |
| `scene.update` | sceneId, place, time, description, breakBefore | The background follows place and time. |
| `scene.remove` | sceneId | |
| `beat.add` | sceneId, beats, at or after | `after` is a beat id. |
| `beat.update` | beatId, text, speaker, expression, cast | |
| `beat.remove` | beatIds | |

After an edit the result lists what happened to the assets: `added` and `orphaned` (no longer needed; kept, never deleted), `cleared` (their subject changed and they had no image yet: their prompt is gone, run `vno_plan` again), `stale` (they have an image of the old subject: `vno_asset_regen`), `keptLocked` (locked or custom, untouched) and `keptByHand` (a prompt you set with `vno_asset_set`, untouched). The primary edition follows the story; other editions drop the text of removed beats and keep the rest.

### Prompts, music and staging by hand

- `vno_asset_set {slug, id, prompt?, negative?, size?, engine?, seed?}` writes an asset's plan without generating. A prompt you set is kept by `vno_plan` and the pipeline, even with `refreshPrompts` or `force`. A locked asset is refused.
- `vno_set_music {slug, menu?, chapters?: {"1": "music_02"}, seconds?: {"music_01": 90}, replace?}` sets the menu track, the track of each chapter and each track's length (60 to 180 s). Only `slug` reads the plan. The music step keeps it and only fills what is missing. The number of tracks is `music.tracks` in `vno_update_settings`.
- `vno_set_cues {slug, menuMusic?, chapters?, scenes?: {"ch01.s02": {"transition": "fade", "pause": 1}}, casts?: {"ch01.s02.b001": {"mara": "left", "tom": "right"}}, replace?}` sets the stage cues. Only `slug` reads them. The stage step then keeps them, does not ask the stage-director, and only adds defaults for what you left out.

## Languages

- `vno_languages` lists the languages a project or edition can use: the 31 that VibeTTS Supertonic reads plus Book Translator's (37 in all, for example en, hr, de, fr, es, it, pt, nl, pl, cs, ru, uk, sr, ja, ko, zh, ar, he, fa, hi). More, or changes, go in `config/languages.md` in the data folder.
- The primary language is detected on import and on `vno_create_project`; `vno_add_edition` detects the language of a translated folder when `lang` is left out.
- Each edition is a Ren'Py language; the game has a language picker and starts in the primary language.
- The game menus are translated only for Croatian; the others keep the English menus (a build warning says so; add a `ui` table in `config/languages.md`). For Arabic, Hebrew and Persian the build turns on Ren'Py's right-to-left text, but the layout is not mirrored. The built-in font has no Chinese, Japanese, Korean, Hindi or Thai glyphs: the build warns, and that text shows as boxes.

## Tools

| Area | Tools |
| --- | --- |
| Library and projects | `vno_list_books`, `vno_set_library`, `vno_import`, `vno_list_projects`, `vno_get_project`, `vno_update_settings`, `vno_delete_project`, `vno_languages` |
| Story | `vno_create_project`, `vno_get_story`, `vno_story_edit`, `vno_book_update`, `vno_character_set`, `vno_character_remove`, `vno_place_set`, `vno_place_remove`, `vno_chapter_add`, `vno_chapter_update`, `vno_chapter_remove`, `vno_scene_add`, `vno_scene_update`, `vno_scene_remove`, `vno_beat_add`, `vno_beat_update`, `vno_beat_remove` |
| Pipeline | `vno_run_pipeline`, `vno_plan`, `vno_status`, `vno_wait`, `vno_pause_all`, `vno_resume_all`, `vno_stop_now` |
| Editions | `vno_add_edition`, `vno_edition_set`, `vno_get_edition`, `vno_update_beat`, `vno_align_report` |
| Assets, music, staging | `vno_asset_list`, `vno_asset_set`, `vno_asset_replace`, `vno_asset_regen`, `vno_asset_pick`, `vno_asset_lock`, `vno_asset_unlock`, `vno_asset_generate`, `vno_set_music`, `vno_set_cues` |
| Voice | `vno_voice_status`, `vno_voice_plan`, `vno_voice_set`, `vno_voice_preview`, `vno_voice_generate` |
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
