---
kind: prompt
role: art-critic
task: review_image
---
Review a generated image for a visual novel.

Asset: {{id}} ({{kind}})
Prompt it was generated from:
{{prompt}}

Images: {{hasSheet}}

Check:
- Does the image show what the prompt asks for (the right place, character, expression)?
- For a sprite: is it the same character as the character sheet (face, hair, clothes, colours)? Has it drifted?
- Are there stray words, letters, captions or signs in the image? Is there a border, a frame or a book page around it?
- For a character sheet: one character only, whole body in view, plain light background, no cut-off limbs, no extra fingers or limbs.
- For a sprite: one character only, whole body in view, no cut-off limbs, no extra fingers or limbs. A sprite is a cut-out with a transparent background; it is shown to you on a flat mid-grey backing that is not part of the picture. Do not judge that grey, do not list it as a problem, and do not ask for another background.
- For a background: no people, fills the whole image.

Approve it when it is usable, even if it is not perfect. Reject it only for real problems. When you reject it, give a `revisedPrompt`: the prompt with the problem fixed (add what was missing, remove what caused the problem, keep the style words). Otherwise `revisedPrompt` is null.
Write `problems` and `revisedPrompt` in English.

Answer with one JSON object and nothing else:
{"approved": true, "problems": [], "revisedPrompt": null}
