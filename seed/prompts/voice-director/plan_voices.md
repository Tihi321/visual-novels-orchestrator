---
kind: prompt
role: voice-director
task: plan_voices
---
Book: "{{title}}" ({{lang}}). Genre: {{genre}}.

Plan the voice of each speaking character and of the narrator for the provider it uses.

**Local ComfyUI engines** (the default): each language is read by one TTS engine from the list below (grouped by language). Pick the engine whose group includes the language and whose voice suits the subject, and write a delivery style for the speaker. Engines per language (id and label):
{{engines}}

**Google Flow voices** (the cloud fallback; only used when the list below is not "(none ...)"): you pick from a fixed list, no voice design. Voices per language (id, gender, label):
{{voiceList}}

Subjects (speakerKey, name, looks, voice notes from the bible, how many lines they speak, sample lines):
{{subjects}}

For each subject give:
- `speakerKey`: the same speakerKey as in the subject.
- `gender`: `female` or `male`, from the looks, the bible's voice notes and the sample lines. The narrator is a calm, steady voice: female unless the book calls for a male one.
- `engines`: for the LOCAL provider only, an object from language code to a TTS engine id taken from the local list above for that language, for example {"en": "omnivoice", "hr": "higgs-audio-v3"}. Give one entry per language in the list. Never invent an id, and never name an engine whose language list does not include the language. Leave `engines` out for the Flow provider.
- `voices`: for the FLOW provider only, an object from language code to a Flow voice id taken from the Flow list above, for example {"en": "gemini:Charon"}. Give one entry per language in the list, a voice of the subject's gender, and different voices to different characters where the list is long enough. Never invent an id. Leave `voices` out when the list says "(none ...)" or for the local provider.
- `description`: the delivery style of the speaker: one short sentence about how the voice sounds and speaks (age, pitch, pace, manner), for example "a teenage girl, bright and quick, a little breathless". It is the instruct text of OmniVoice/Qwen3-TTS and the style note of Google Flow; for Higgs Audio v3 it is only used when it is inline tags such as `<|emotion: happy|>`.
- `suggestedRef`: the file name of an uploaded reference clip that suits this subject, or null. Use a clip for one subject only; never invent a file name. Always null when the list below is empty.

Uploaded reference clips (file names; usually empty): {{clips}}

Answer with one JSON object and nothing else. Local example:
{"voices": [{"speakerKey": "petra", "gender": "female", "engines": {"en": "omnivoice", "hr": "omnivoice"}, "description": "a teenage girl, bright and quick, a little breathless", "suggestedRef": null}]}
Flow example:
{"voices": [{"speakerKey": "petra", "gender": "female", "voices": {"en": "gemini:Charon", "hr": "gemini:Charon"}, "description": "a teenage girl, bright and quick", "suggestedRef": null}]}
Give one entry per subject.
