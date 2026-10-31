---
kind: prompt
role: composer
task: plan_music
---
Book: "{{title}}". Genre: {{genre}}. Format: {{format}}.
Style: {{style}}
Music provider: {{provider}} (engine: {{engine}}; chiptune chip chosen by the user: {{chip}})

Plan the music for this visual novel. The tracks to write are: {{trackIds}}. The first one is the main menu theme; the others are chapter themes.

Chapters:
{{chapters}}

Scenes (id, place, time, description; `music` is a track the story already chose for the scene, which stays):
{{scenes}}

Rules:
- Calm, gentle, instrumental. No vocals, no lyrics, no sudden loud parts. The music plays under reading, so it stays in the background and loops well.
- `seconds`: the length of the track, between {{minSeconds}} and {{maxSeconds}}.
- `menuTrack`: the track of the main menu.
- `scenes`: only when a scene's mood is clearly not its chapter's (a flashback, a quiet night scene in a tense chapter, a reveal): the scene id and the track for it. Most books need none, so an empty list is the usual answer. Never choose for a scene that has `music` already.
- `chapters`: for every chapter number, the track that plays in it. Use the chapter themes so the mood follows the story (a tense chapter gets a darker, quieter track, an ending a warmer or sadder one). A track may be used by several chapters. The menu track may be reused in a chapter too.

If the music provider is `comfy` (ACE-Step): each track has a `prompt` that names the mood, the instruments (for example soft piano, strings, harp, music box, light guitar), a slow tempo and the genre tint. Keep it to one line of 15 to 30 words. Start with "calm instrumental". Leave the chiptune fields out.

If the music provider is `chiptune` (Chiptune Studio, a chip-music composer): each track is composed from `mood`, `chip`, `bpm`, `key` and `bars`; no prompt is needed (use an empty string).
- `mood`: one of {{moods}}. The synth moods (dreamwave, synthwave, darkwave, outrun) only for a book whose setting or tone is 80s, neon, retro-futuristic, cyber or noir: `dreamwave` is the calmest and the usual pick, `darkwave` for dark chapters, `synthwave` for driving ones, `outrun` only for a chase or a climax. Every other book keeps to the calm moods.
- `chip`: one of {{chips}}. If the user chose a chip above, use it; otherwise pick a soft one that fits the book (snes for warm and gentle, gb for small cozy stories, nes for bright simple ones, ps1 for late-90s, moody, noir, gothic or melancholy books with deep reverb, dreamcast for lush, neon, dreamy or retro-futuristic books with chorus). A book can mix chips, but keep to one when unsure.
- `bpm`: slow, 55 to 90 for the calm moods and 80 to 110 for the synth moods. `key`: a note name such as C, F, G, D, A, Eb. Give neighbouring tracks different keys.
- `bars`: the length in bars (4/4): about seconds x bpm / 240, in a multiple of 4, between 8 and 48.

Answer with one JSON object and nothing else:
{"tracks": [{"id": "music_01", "prompt": "calm instrumental, ...", "seconds": 100, "mood": "peaceful", "chip": "snes", "bpm": 72, "key": "C", "bars": 32}], "menuTrack": "music_01", "chapters": [{"n": 1, "trackId": "music_02"}], "scenes": []}
