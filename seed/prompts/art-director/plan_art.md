---
kind: prompt
role: art-director
task: plan_art
---
Book: "{{title}}". Genre: {{genre}}. Format: {{format}}. Script language: {{lang}}.
Art mode: {{artStyle}}
Style prefix (fixed, the app adds it to every prompt for you; do not repeat it and do not invent another): {{stylePrefix}}
Writing note from the bible (this is about how the TEXT is written, not about the pictures; ignore it for the art, never copy words from it such as SCENE or ON SCREEN): {{writingNote}}

Write the ComfyUI prompts for these assets. Every prompt is in English, even when the bible is not: translate the looks into plain English.

Assets (id, what it shows):
{{assets}}

Rules for all prompts:
- Describe only what can be SEEN: shapes, colours, clothes, hair, species, size, materials, light. Never write personality, habits, feelings about things, backstory or what a character does for a living ("she is brave", "he loves shiny things" do not belong in an image prompt).
- Do not use the words book, storybook or frame (image models draw a book or a picture frame). Do not ask for text, letters, captions, labels or signs in the image.
- Keep each prompt under 70 words. Write the visual description only: the app adds the framing words (one figure, white background, empty place).

Per kind:
- background: an EMPTY place. Name the place, its main objects, materials, colours and the light for the time of day, and "wide landscape composition". No people, no characters, no creatures, no animals, not even asleep or small or in the distance. The data above has no people in it; do not add any.
- character sheet: ONE character, ONE full-body figure, front view, standing, plain white background. Describe only that character's visible looks from the bible. Never a model sheet, a turnaround, several views, face studies or a collage.
- sprite: the same character as the sheet, one single full-body figure, with the expression and a matching small gesture. Start with "same character". Do not repeat the style prefix.
- cover: a single illustration of the premise from the brief, portrait composition, no title text.
- `negative`: extra things to avoid for this asset (for example "modern clothes" in a fairy tale). The standard negatives are added for you, so keep it short or empty.

Answer with one JSON object and nothing else:
{"stylePrefix": "(the style prefix above, unchanged)", "assets": [{"id": "bg_harbour_dusk", "prompt": "...", "negative": ""}]}
Give one entry per asset id above, with the same id.
