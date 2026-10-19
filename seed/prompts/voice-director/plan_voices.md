---
kind: prompt
role: voice-director
task: plan_voices
---
Book: "{{title}}" ({{lang}}). Genre: {{genre}}.

Choose a voice for each speaking character and for the narrator. The text-to-speech voices are fixed (they are not designed): you pick from the list below. Each language has its own voices, so the same character can be a Kokoro voice in English and a Supertonic voice in Croatian. Voices per language (id, gender, label):
{{voiceList}}

Subjects (speakerKey, name, looks, voice notes from the bible, how many lines they speak, sample lines):
{{subjects}}

For each subject give:
- `speakerKey`: the same speakerKey as in the subject.
- `gender`: `female` or `male`, from the looks, the bible's voice notes and the sample lines. The narrator is a calm, steady voice: female unless the book calls for a male one.
- `voices`: an object from language code to a voice id taken from the list above for that language, for example {"en": "af_heart", "hr": "supertonic:F2"}. Give one entry per language in the list, a voice of the subject's gender, and different voices to different characters where the list is long enough. Never invent an id. Leave `voices` out when the list says "(none ...)".
- `description`: one short sentence about how the voice sounds (age, pitch, manner), for example "a teenage girl, bright and quick". Only used when the voices come from reference clips.
- `suggestedRef`: the file name of an uploaded reference clip that suits this subject, or null. Use a clip for one subject only; never invent a file name. Always null when the list below is empty.

Uploaded reference clips (file names; usually empty): {{clips}}

Answer with one JSON object and nothing else:
{"voices": [{"speakerKey": "petra", "gender": "female", "voices": {"en": "af_heart", "hr": "supertonic:F2"}, "description": "a teenage girl, bright and quick", "suggestedRef": null}]}
Give one entry per subject.
