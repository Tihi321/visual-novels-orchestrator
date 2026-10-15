---
kind: prompt
role: composer
task: plan_music
---
Book: "{{title}}". Genre: {{genre}}. Format: {{format}}.
Style: {{style}}
Music engine: {{engine}}

Plan the music for this visual novel. The tracks to write are: {{trackIds}}. The first one is the main menu theme; the others are chapter themes.

Chapters:
{{chapters}}

Rules:
- Calm, gentle, instrumental. No vocals, no lyrics, no sudden loud parts. The music plays under reading, so it stays in the background and loops well.
- Each track prompt names the mood, the instruments (for example soft piano, strings, harp, music box, light guitar), a slow tempo and the genre tint. Keep it to one line of 15 to 30 words. Start with "calm instrumental".
- `seconds`: the length of the track, between {{minSeconds}} and {{maxSeconds}}.
- `menuTrack`: the track of the main menu.
- `chapters`: for every chapter number, the track that plays in it. Use the chapter themes so the mood follows the story (a tense chapter gets a darker, quieter track, an ending a warmer or sadder one). A track may be used by several chapters. The menu track may be reused in a chapter too.

Answer with one JSON object and nothing else:
{"tracks": [{"id": "music_01", "prompt": "calm instrumental, ...", "seconds": 100}], "menuTrack": "music_01", "chapters": [{"n": 1, "trackId": "music_02"}]}
