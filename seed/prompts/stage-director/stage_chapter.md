---
kind: prompt
role: stage-director
task: stage_chapter
---
Book: "{{title}}". Genre: {{genre}}.

Stage this chapter of the visual novel. Sprites stand in one of three slots: left, center, right. A cast beat (`ON SCREEN`) lists who is on screen from that beat on; a character that is left out of its slots is not shown (they have left the scene).

Chapter:
{{chapter}}

Music tracks you may choose from: {{musicIds}}

Decide:
- `scenes`: for every scene a `transition`: `dissolve` (a normal scene change), `fade` (through black: a time jump, a scene after a break, a dramatic change of place) or `none` (a continuation in the same place). `pause`: seconds to wait after the scene appears, 0 for none, at most 3; use 1 or 2 only for a big reveal.
- `casts`: for every cast beat, where each of its characters stands. One character stands in the center. Two stand left and right. Three stand left, center, right. Keep a character in the same slot as long as they stay, and put the speaker or the focus of the scene in the center when there are three. Never use a slot twice, never show more than three, and only use characters named in that cast beat.
- `music`: one of the tracks above that fits this chapter, or null to keep the default.

Answer with one JSON object and nothing else:
{"music": null, "scenes": [{"id": "ch01.s01", "transition": "dissolve", "pause": 0}], "casts": [{"beatId": "ch01.s01.b001", "slots": [{"charKey": "mara", "slot": "left"}]}]}
