---
kind: prompt
role: script-analyst
task: resolve_uncertain
---
Book: "{{title}}" (script language: {{lang}}).

The parser read this visual novel script and could not settle the items below. Decide each one. Use only what the script and the bible say; do not invent story facts.

Bible characters (key, name, looks):
{{characters}}

Bible places (key, name, looks):
{{places}}

Items to settle. `kind` says what is unclear, `text` is the unclear text, `scene` is the scene it is in, `around` are the lines next to it:
{{items}}

How to answer, per kind:
- `place`: the scene's place matches no bible place. If it is the same place as a bible place under another wording, give its `placeKey`. If it is a real new place, give `newPlace` (a short `name` in the script's language, and `looks` in a few words). If the text also names a time of day, give `time`.
- `time`: the scene line names no time of day. Give `time` as one of dawn, morning, day, afternoon, evening, dusk, night when the description or the lines clearly say it (a sunset is dusk, "bright sun" is day). Use null when it cannot be told.
- `speaker`: a speaker label that is not in the bible. If it is a bible character under another name, give `charKey`. If it is a stage direction or a sound that is not a person (SMASH CUT TO, FADE OUT, a sound effect), set `isDirection` true. If it is a real new speaking character (Mama, Splash), give `newCharacter` with its `name` and `looks` inferred from the lines. A label that is only a sound word such as SPLASH or BANG is a direction unless a person with that name speaks.
- `cast`: an ON SCREEN entry that is not a bible character, with its look in brackets. If it is a bible character, give `charKey`. If it is a new person or creature that is shown on screen, give `newCharacter`. If it is a prop or a sign (not a character), set `isDirection` true.
- `expression`: a free-form expression in a bracket. Give the closest of neutral, happy, sad, angry, surprised, worried, scared, thinking in `expression`. A voice quality (whisper, quiet, rumbly) or an action (nodding, pointing) is neutral unless the words around it show a feeling.

Answer with one JSON object and nothing else. Every decision has every field; use null or false for a field that does not apply:
{"decisions": [
  {"index": 0, "placeKey": null, "newPlace": null, "time": null, "charKey": null, "newCharacter": null, "expression": "happy", "isDirection": false}
]}
Give exactly one decision per item, with the item's `index`.
