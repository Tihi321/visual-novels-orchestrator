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
- **Pictures and sounds**: the story lists `images` (`{key, description, display: "full"|"insert", characters?}`; a full one is a CG over the whole scene, an insert a small object or document in the middle) and `sounds` (`{key, kind: "sfx"|"ambience", description}`). In the story JSON a beat shows a picture with `image: "key"` (`null` hides it), plays a sound effect with `sfx: "key"`, and starts an ambience with `ambience: "key"` (`null` stops it). A scene has `music: "music_02"` (`null` is silence) and `ambience`. In the edit operations below `"none"` means the same, and null clears the cue. Their assets are `cg_<key>`, `sfx_<key>` and `amb_<key>`: a CG is drawn from the sheets of its characters (a `CG:` image from an imported script gets, as `characters`, the bible characters whose name or alias is in its cue text, at most 3, not counting a name in a possessive that names a place or thing ("Ivka's shop") or in a heading or quote on a document ("FOR IVKA"); an `INSERT:` never gets characters from its text; change them with `vno_image_set`), an ambience is made with the music engine, and a sound effect needs a file (`vno_asset_import`) unless a `sound.sfxEngine` is set in `vno_update_settings`: `"chiptune"` has Chiptune Studio make it (`compose_sfx` with a file path: the sound is picked from the key and description among its sfx names, such as coin, door, footstep, chime, thunder; no match uses `blip` with a warning, so import a file for the exact sound), `"custom:<comfy workflow>"` uses ComfyUI. `sound.ambienceEngine: "chiptune"` makes ambiences as seamless `compose_sfx` loops (wind, rain, waves, cave, night, fire, machine, drone) instead of the ComfyUI music engine; the default is unchanged. Neither is set by default, also not for a pixel book. Imported and locked files are never overwritten, and a sound that already has a file keeps its engine; `vno_asset_regen` with the sound's id makes a new version. Chiptune Studio must be running (`vno_studios_status`); if not, the asset fails with its start hint. A cue to a key that is not listed is an error; a cue to a sound with no file is skipped with a warning in the build.
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

## Google Flow (images, voices, music)

`flow-music-mcp` (the hub's `hub.ps1 start flow-music-mcp`; sign in to Google Flow once with `yarn login` in its repo) lets VN Studio make art, voices and music with Google Flow. It is a provider like ComfyUI, picked per project, and nothing changes for a project that does not pick it. `vno_studios_status` shows it (`flow`: reachable and signed in or not). Its settings are in `config/studios.md` (`flowUrl`, `flowRepo`, `flowToken` or `FLOW_MUSIC_MCP_TOKEN`, `flowPollS`, `flowJobTimeoutS`, `flowImageQuality`, ...; `VNO_FLOW_URL` overrides the URL).

- **Images** (free): `vno_update_settings {art: {provider: "flow", flowModel?: "Nano Banana Pro", flowProject?: "<name>"}}` (CLI: `--art-provider flow --flow-model ...`). Backgrounds, sheets, sprites, CGs, inserts and the cover are made by Flow's Nano Banana, one image per job and one Flow job at a time (about 30 to 70 s each: a small book takes 20 to 30 minutes). Every call passes `max_credits: 0`, so a paid image model is refused, never charged. All images of a book go to one Flow project, `vno-<slug>` unless `flowProject` is set. Backgrounds, full CGs and the cover are 16:9 and downloaded at 2K (`flowImageQuality: upscaled`; 1K is 1376x768, below 1920x1080), sheets and sprites 9:16, inserts 1:1. A sprite is a new image of the same character with its sheet as the reference (`asset:<media id>`, kept on the sheet version as `remote.id`; a sheet made by ComfyUI or by hand is uploaded as a file, which needs `FLOW_MUSIC_MCP_UPLOAD_RIGHTS=agree` in flow-music-mcp's `.env`), asked for on a plain flat grey background, so the cutout (`art.bgRemoval`, `key` needs no ComfyUI) works; a CG sends the sheets of its characters (at most 3). The raw sprite image is kept as `v<n>.raw.jpeg`. A pixel-style book gets the usual pixel finishing. The generate step checks flow-music-mcp once before the fan-out: not running or not signed in fails the step at once with the start hint. There is no silent fallback to ComfyUI (the look would change): `vno_asset_regen {id, engine: "<comfy engine>"}` makes one asset with ComfyUI on purpose.
- **Voices** (free): `vno_update_settings {voice: {enabled: true, provider: "flow", langs: ["en", "hr"]}}`. Clips come from `flow_narrate` with the free engines `gemini` (Google AI Studio text-to-speech: it needs a key in flow-music-mcp, `flow_set_key`; the language follows the text, so one voice reads every language of the book; Croatian is listed for the `gemini-3.8-flash-tts` model flow-music-mcp now uses by default) and `windows` (a voice installed on this PC, which reads only its own culture's language, so only English with the usual Zira and David). VN Studio never sends the paid engine `flow`. Voice ids are `gemini:<Name>` (`gemini:Charon`) or `windows:<Voice Name>`; `vno_voice_plan` picks them by gender (Flow's list gives it) and spreads the cast over the voices (Windows voices are used only when no Gemini key is set up); `vno_voice_set` / `vno_voice_preview` work with the same ids. `voice.flowStyles: {<speakerKey or narrator>: "gruffly, tired"}` is an optional Gemini delivery note, part of the clip's hash. A clip is `voice/<lang>/<beatId>.mp3` (the `format` of `config/voice.md`), one beat per call, one call at a time with `flowVoicePauseMs` between calls; a rate limit (the free Gemini tier allows only a few requests a minute) is retried after 10, 30 and 90 s (`flowVoiceRetries`), then that clip fails and the others go on; the index is saved after every clip, so a stopped job continues, and clips from `vno_voice_import` are kept. A beat over 4000 characters fails alone with a clear error. Flow's "voice" status is in `vno_studios_status`, not `vno_voice_status` (that one is VibeTTS).
- **Music** (SPENDS FLOW MUSIC CREDITS): `vno_update_settings {music: {provider: "flow", tracks: 2}}`. It is never a default (a pixel book without a provider still gets Chiptune Studio, any other book ComfyUI), so set it by hand and ask the user first: the cost per song is not known until flow-music-mcp can read the balance (each song's job log and version warnings show `credits_spent` when it read it). Each track is one instrumental song from Flow Music (`music_generate`, loop-friendly wording, mp3, about 2:40 to 3:00), then `music_loop` finds a seamless loop and writes it as the version `v<n>.mp3` (it starts at the loop point and repeats from its start; `loopStartSec` 0, `loopEndSec` its length); the whole song stays as `v<n>.src.mp3`. When no good loop is found (seam score under 0.5, or ffmpeg is missing) the whole song is the version with no loop point and a warning. The pipeline only makes tracks that have no file. A project may make at most `flowMusicMaxSongs` songs (default 4, counted from the versions with engine `flow-music`; `vno_asset_regen` counts too); at the cap the job fails before any call. A music job runs once (`max_attempts: 1`): a failed take may already have spent credits, so you decide whether to try again. The version's `remote` has the song id. The Flow Music Chrome window is used one job at a time.

## Puzzles

A story can stop for a logic puzzle: a `puzzle` beat (`vno_beat_add {sceneId, beats: [{puzzle: "dinner"}]}`) plays a puzzle of the book (`vno_puzzle_set`), and the story goes on when the player has solved it. Kinds so far: Murdle (3x3 or 4x4; `motive: true` adds a fourth category and a "why" to the accusation; `attrs: true` makes some clues point at an item by a trait, "the heavy weapon", so the prose is about who or what; the reader of the prose gets a legend of the traits). The Murdle (who did it, with what, where) is on one screen with a grid, a clue list, Hint, Undo, Clear and Accuse. Code makes the puzzle and proves it; a model writes only the flavour.

1. `vno_puzzle_generate {kind: "murdle" | "knights" | "testimony" | "logic", band: "easy" | "medium" | "hard", seed?, size?}` makes a puzzle with the library in `templates/puzzles/` run by the Ren'Py SDK's own Python (so `sdkPath` in `config/renpy.md` must be right; a call takes well under 2 s). It proves exactly one solution, solvable by deduction alone, minimal for its band. Nothing is saved. The answer is the core (categories of item ids `s1..`, `w1..`, `p1..`; the solution; the clues as structured data: `is`, `not`, `either`; the murder place and answer; the deduction steps; the difficulty) plus canonical English names and sentences. The same seed gives the same puzzle.
2. `vno_puzzle_set {slug, key, generate: {band, seed?}}` (or `data`: a core) adds it to a project. The core is proved again and refused if it is not unique or needs a guess. `names` (item id -> name) and `text` (clue id and `murder` -> prose) default to the canonical English ones. `links` says which character, place or image an item is (a character gives its grid header a portrait, the neutral sprite, and an image link a picture of the object, an insert; the build makes those images even when no beat shows them), `clueAt` (clue id -> beat id) makes the puzzle list a clue only after the story has shown it (the beat must come before the puzzle beat), `onFail` says what a wrong answer does, `hints: false` removes hints.
3. Prose you write is not trusted: `verified.textChecked` is false until `vno_puzzle_check_text` passes. The flavour check: `vno_puzzle_get` returns `readBackTask`, text for a SEPARATE reader (a model that has not seen the clues) that holds only the prose and the names; the reader writes each clue back as `{id, type, a, b}`; `vno_puzzle_check_text {slug, key, readBack}` compares it with the original clue by truth table (true in exactly the same assignments) and checks that the read-back clues still give one solution deduction finds. It lists the clues that differ: rewrite them and check again. A translated edition goes through the same check: `vno_edition_set {lang, puzzles: {key: {names, text}}}`, then `vno_puzzle_check_text {lang}` with a reader of that language.
4. `vno_build`: a book with a puzzle beat gets the library (`game/python-packages/vno_puzzles/`, `game/vno_puzzle.rpy`) and `game/vno_puzzles_data.rpy`; a book with none gets neither. Names and clue texts are `_("...")` strings, so an edition's words land in `tl/<language>/` and the screens show them translated (the hint sentences and the buttons stay English for now). A beat becomes `call vno_puzzle_play("dinner", vno_puzzle_data["dinner"])`.

Knights and Knaves (`kind: "knights"`, 2 to 5 speakers; hard needs 3 or more): knights always tell the truth, knaves always lie, each statement is a claim about the speakers (is a knight or a knave, same or different kinds, at least one of us is a knave, exactly k of us are knights, not, and, or). The proofs are one assignment out of all 2^n, and a way to find it without guessing: reading one statement at a time (`direct`) and case splits that end in a contradiction (`split`); the band is the number of splits (easy none, medium one, hard two or more). The player marks each speaker Knight or Knave and submits; hints name the next step. `names` are the speakers' names (`links` gives them portraits), `text` has one prose line per statement (`t1` ...) and `intro`. The reader of the prose writes each statement back as `{id, speaker, claim}` (`readBackTask` describes the claims) and the intro back as the rule `{id: "intro", truthTellers, liars}` (the story's words for who always tells the truth and who always lies); the words must be in the intro and agree with the statements.
Testimony (`kind: "testimony"`, an Ace Attorney cross-examination): a witness makes statements (`t1` ...), some of which say more when pressed (`t1.press`), and the player presents the one piece of evidence (`e1` ...) that proves a statement false. The core has `keys` (the vocabulary: a key such as `clock`, its values and the English templates of the default prose), `statements: [{id, claims: [{key, value}], press?: {claims}}]`, `evidence: [{id, facts: [{key, value}]}]` and `solution: {statement, evidence, press}`. A claim and a fact clash when they are about the same key with different values; the proof is that there is exactly one clash and it is the pair the solution names (`solutions: 1`, `deducible: true`: nothing is guessed, the evidence is compared). The band: easy, the clash is in what the witness says first; medium, it only comes out when the statement is pressed; hard, pressed and four or more claims agree with evidence (it looks relevant). An author can give their own `keys`, statements and evidence (`data` of `vno_puzzle_set`): the tools prove it the same way. The player reads one statement at a time (Back, Next), presses it, opens the court record (the evidence with its picture, from `links`: a character for the witness `wit`, an image for a piece of evidence) and presents; a wrong present costs one place of the penalty bar (5, or `onFail.maxTries`); with `retry` the bar refills after a recess, else the case is lost. `clueAt` can make a piece of evidence appear in the record only after a story beat. `names`: `wit` and the evidence; `text`: every statement (and `.press` where there is one), every piece of evidence, and `intro`. The reader of the prose writes back the `claims` of each statement line and the `facts` of each piece of evidence (`readBackTask`).
Logic grids (`kind: "logic"`, Puzzle Baron, `size` 3 to 5 items per category, 4 categories: the built-in scenario is a bakery's deliveries by day, customer, cake and town): the first category is ordinal (the days come in order), the player fills in the grid, there is no accusation and no `murder` note (`text` has the clues and `intro`). Clue types: `is`, `not`, `either` (a goes with one of two), `neither` (with none of two), `oneof` (of two items, one goes with one of two others and the other with the other), `before`, `after` and `apart` (`n`: exactly n places, in the ordinal category's `unit`). Each category has a `ref` ("the {n} delivery") that the canonical prose uses to refer to one of its items. Bands: easy (is, not, neither and the order clues, no either step and no transitive step), medium (needs an either or oneof clue, still no transitive step), hard (no `is` clue and at least `hardTrans` transitive steps). The proofs are the ones of Murdle: one solution (a search), found by deduction without guessing, minimal for the band. The reader of the prose writes each clue back with the names (`readBackTask` lists the order of the ordinal items and the clue types); "a came before b" read back as "b came after a" is the same clue.

`onFail`: `{mode: "retry"}` (default) lets the player try as often as they like, with a hint offered after 2 wrong accusations. `{mode: "continue", maxTries}` ends the puzzle after that many wrong accusations (default 3) and the story goes on. `{mode: "chapter", to, maxTries}` jumps to chapter `to` (a bad ending). Give up always ends the puzzle the same way. The puzzle is fixed per book. The player's own grid is a notebook: only the accusation is checked.

### A puzzle book from Scriptorium (`mystery-puzzle-visual-novel`)

`vno_import` reads a Scriptorium book of the format `mystery-puzzle-visual-novel` (the grammar is in Scriptorium's `docs/visual-novel.md`, "Puzzles"). Besides the normal script lines it reads four puzzle lines and `bible/puzzles.md`:

- `CLUE: <puzzle>/<clue>: <prose>` is a narration beat that shows the clue; the puzzle's `clueAt` is that beat, so the puzzle screen lists the clue only once the story has shown it. `EVIDENCE: <key>: <prose>` is a narration beat, and the item is an `insert` picture (`images`, key `<key>`) that the beat shows with its line (hidden at the next beat of the scene, or at the scene end) in every book, whatever its puzzles are, and that the court record of a testimony shows. `PUZZLE: <key> (<kind>)` is the `puzzle` beat. `TESTIMONY: <witness>` ... `END TESTIMONY` keeps its statements as ordinary speaker lines, and statement n becomes the words of the core's statement `t<n>`. Croatian keywords work (`TRAG`, `DOKAZ`, `ZAGONETKA`, `SVJEDOČENJE`, `KRAJ SVJEDOČENJA`). A line that does not fit its pattern is read like any unknown line.
- The clue ids a `CLUE:` line may name depend on the kind (they are the ids of the core, as `vno_puzzle_generate` returns them; any other id is a warning and the line stays narration). The id is letters, digits, `_` and `-`, so a testimony's `t1.press` cannot be a `CLUE:` id (a pressed statement's words come from the `TESTIMONY:` block).
  - Murdle and logic grids: `c1`, `c2`, ... one per clue, plus `murder` (the murder note, Murdle) or `intro` (logic). Each clue is found where its line is (`clueAt`), so the clues can be spread over chapters, and a clue after the `PUZZLE:` line is a warning. A clue with no line is listed from the start (a warning).
  - Knights and Knaves: `intro` and `t1`, `t2`, ... one per statement (`t<n>` is the statement of the core with that id; the number of statements is the core's, not the number of speakers, and every speaker has at least one). These ids give the story's words only; all statements are on the screen from the start, so there is no `clueAt` and no warning for a statement with no line (its canonical sentence stays). A chapter may still spread the lines (`CLUE: <puzzle>/t1:` in chapter 1, `t2` in chapter 2, ...) as the speakers talk; the puzzle shows them all when it is played, so the story should have said them by then.
  - Testimony: statements are `TESTIMONY:` lines (statement n is `t<n>`), the evidence is `e1`, `e2`, ... (a `CLUE:` line with an evidence id sets `clueAt` for that evidence, so the court record lists it only after that beat), and `intro` is the opening line.
- `bible/puzzles.md` (frontmatter `puzzles: [{key, kind, core, names, text, testimony?}]`) gives each puzzle's core (as `vno_puzzle_generate` returns it), its names and its canonical sentences; the importer trusts the core for the logic and the lines only for the story. Items named like a bible character or place get a portrait or place link; a testimony's evidence list pairs by order with the core's evidence (`e1` ...), its witness is `wit`.
- At import the core of every puzzle is proved with the puzzle library (`verified.unique`, `deducible`, `by: "import"`; without the Ren'Py SDK they are left unproved, with a warning). The prose in the story's own words is not the canonical sentence: such a clue or statement is a warning that names its chapter, and `verified.textChecked` stays false until `vno_puzzle_get` (the `readBackTask`) and `vno_puzzle_check_text` pass; the hub sends a failing clue back to Scriptorium as a rewrite note. Other warnings: a clue never found, found after the `PUZZLE:` line or twice, a clue the core does not have, a `PUZZLE:` line for a puzzle that is not in the bible or two of them, evidence never planted, a bible that disagrees with its core (which statement breaks, with what).
- A translated book folder (`vno_add_edition`) lines up by clue id: the edition's words for the puzzle are the translated `CLUE:` and statement lines, with the names and other sentences from its `bible/puzzles.md` and the primary words where a translation is missing (a warning says which).

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
- The game menus are translated for every built-in language (49 strings each, and Croatian also the help screen; written by a language model: native review is welcome). A `ui` table in `config/languages.md` overrides single strings; a language you add without `ui` keeps the English menus and the build says so.
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
| Puzzles | `vno_puzzle_generate`, `vno_puzzle_set`, `vno_puzzle_get`, `vno_puzzle_check_text`, `vno_puzzle_remove` (the beat: `vno_beat_add {puzzle: key}`) |
| Voice | `vno_voice_status`, `vno_voice_plan`, `vno_voice_set`, `vno_voice_preview`, `vno_voice_generate`, `vno_voice_import` |
| Generators | `vno_studios_status`, `vno_comfy_status`, `vno_comfy_free`, `vno_themes` (status tools only probe; art and music jobs start Pixel Studio, Chiptune Studio and ComfyUI themselves when they are down, see `config/autostart.md`) |
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
