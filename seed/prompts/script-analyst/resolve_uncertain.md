---
kind: prompt
role: script-analyst
task: resolve_uncertain
---
Book: "{{title}}" (script language: {{lang}}).

The parser read this visual novel script and could not settle the items below. Decide each one. Use only what the script and the bible say; do not invent story facts.

Bible characters (key, name, other names the story uses for them, looks):
{{characters}}

Bible places (key, name, looks):
{{places}}

Art that already exists. Prefer a time or an expression from this list; only pick another when the text clearly needs it. `backgrounds` are the times of day that have an image for each place, `sprites` the expressions that have an image for each character. Empty: nothing is drawn yet, so choose freely.
{{art}}

Items to settle. `kind` says what is unclear, `text` is the unclear text, `scene` is the scene it is in, `around` are the lines next to it. `present` says who is really in the scene: `speakers` speak in it, `named` are named in its narration. A `cast` item may have `candidates`: the bible characters whose looks share a word with the entry:
{{items}}

How to answer, per kind:
- `place`: the scene's place matches no bible place. If it is the same place as a bible place under another wording, give its `placeKey`. If it is a real new place, give `newPlace` (a short `name` in the script's language, and `looks` in a few words). If the text also names a time of day, give `time`.
- `time`: the scene line names no time of day. Give `time` as one of dawn, morning, day, afternoon, evening, dusk, night when the description or the lines clearly say it (a sunset is dusk, "bright sun" is day). Use null when it cannot be told.
- `speaker`: a speaker label that is not in the bible. If it is a bible character under another name, give `charKey`. If it is a stage direction or a sound that is not a person (SMASH CUT TO, FADE OUT, a sound effect), set `isDirection` true. If it is a real new speaking character (Mama, Splash), give `newCharacter` with its `name` and `looks` inferred from the lines. A label that is only a sound word such as SPLASH or BANG is a direction unless a person with that name speaks.
- `cast`: an ON SCREEN entry that is not a bible character (or a bible name that only seems to be there: `reason` says), with its look in brackets. Put on screen only someone who is physically there: a person who is only read, listed, mentioned or remembered is `isDirection: true`, and so is a prop or a sign. A description such as "the silver-haired man" goes to the character whose bible looks match it (`candidates`), by `charKey`; if nobody matches, give `newCharacter`. A `charKey` for someone who does not speak in the scene, is not named in it and does not match the looks is refused. For `more than 3 on screen`, say `isDirection: true` for a character who is not really there, and give its `charKey` for one who is.
- `alias`: two bible entries that may be one person (`entry` and `mayBeSamePersonAs`). If the entry is another name the story uses for that character (a nickname, how the narration calls them before their name is known), give `aliasOf` with the key of the character it belongs to; the two are merged. If they are different people, leave `aliasOf` null.
- `expression`: a free-form expression in a bracket. Give the closest of neutral, happy, sad, angry, surprised, worried, scared, thinking in `expression`. A voice quality (whisper, quiet, rumbly) or an action (nodding, pointing) is neutral unless the words around it show a feeling.

Answer with one JSON object and nothing else. Every decision has every field; use null or false for a field that does not apply:
{"decisions": [
  {"index": 0, "placeKey": null, "newPlace": null, "time": null, "charKey": null, "newCharacter": null, "expression": "happy", "isDirection": false, "aliasOf": null}
]}
Give exactly one decision per item, with the item's `index`.
