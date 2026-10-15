---
kind: prompt
role: voice-director
task: plan_voices
---
Book: "{{title}}" ({{lang}}). Genre: {{genre}}.

Design a voice for each speaking character and for the narrator. The text-to-speech engine (OmniVoice) makes a voice from a short description, so the description may use ONLY these words, comma-separated, at most one word per category:
{{vocabulary}}

Subjects (speakerKey, name, looks, voice notes from the bible, how many lines they speak, sample lines):
{{subjects}}

For each subject give:
- `speakerKey`: the same speakerKey as in the subject.
- `voiceName`: a short name for the voice, lower case letters, digits, `-` and `_` only, at most 32 characters (for example "petra" or "old-fisherman").
- `description`: only words from the list above, for example "female, young adult, high pitch". Always give gender and age; give pitch when the bible or the sample lines suggest one; use `whisper` only for a character who always whispers. Base it on the looks, the bible's voice notes and the sample lines. The narrator is calm and steady: middle-aged with a moderate pitch, unless the book calls for something else.
- `seed`: a whole number from 0 to 999999. It picks which voice the engine makes for the description; give different seeds to characters that share the same description so they do not sound alike.
- `suggestedRef`: the file name of an uploaded reference clip that suits this subject, or null. Use a clip for one subject only; never invent a file name. Always null when the list below is empty.

Uploaded reference clips (file names; usually empty): {{clips}}

Answer with one JSON object and nothing else:
{"voices": [{"speakerKey": "petra", "voiceName": "petra", "description": "female, teenager, high pitch", "seed": 11, "suggestedRef": null}]}
Give one entry per subject.
