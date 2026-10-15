---
kind: prompt
role: edition-aligner
task: resolve_alignment
---
Book: "{{title}}". Primary language: {{primaryLang}}. The translated edition you align is in: {{lang}}. The translation was written by a person; you never translate or write any text yourself.

The beat-by-beat aligner paired most beats by position. These are left over:
- `missing`: primary beats that got no translated text (with the beats around them).
- `extra`: translated texts that were not paired to any beat (with an `index`, the chapter and the scene).

Primary characters (key, name):
{{characters}}
Names found so far (character key -> name in the translation):
{{nameMap}}

Missing beats:
{{missing}}

Extra translated texts:
{{extra}}

Other warnings from the aligner:
{{warnings}}

Do two things:
1. `fixes`: for a missing beat whose meaning is clearly one of the extra texts (same chapter, same place in the scene, same speaker and sense), give `{"beatId": ..., "extraIndex": <index of that extra text>}`. Use each extra text at most once. Leave a beat out when no extra text matches: it stays untranslated and is shown in the report.
2. `names`: confirm the translated name of each character you are sure about, as `{"charKey": ..., "name": ...}`. Names usually stay the same ("Petra" stays "Petra"); a translated nickname or a declined form is the character's name as the translator wrote it in its base form. Leave out a character you are not sure about.

Answer with one JSON object and nothing else:
{"fixes": [{"beatId": "ch01.s01.b004", "extraIndex": 0}], "names": [{"charKey": "petra", "name": "Petra"}]}
