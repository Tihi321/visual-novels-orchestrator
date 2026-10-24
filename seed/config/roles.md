---
kind: roles
roles:
  director:
    models: [paid, strata, lmstudio]
  script-analyst:
    models: [strata, lmstudio, paid]
  art-director:
    models: [paid, strata, lmstudio]
  art-critic:
    models: [paid, strata, lmstudio]
  composer:
    models: [strata, lmstudio, paid]
  stage-director:
    models: [strata, lmstudio, paid]
  edition-aligner:
    models: [strata/qwen3.8-flash-next-low, lmstudio, paid]
  voice-director:
    models: [strata, lmstudio, paid]
---
# Roles

The default models for each role, as an ordered list of `provider/model` or an alias. The first model is the default. If it fails, is rate-limited or is over budget, the next one is tried. An agent's own `model` field (in `agents/<agent>.md`) goes in front of this list.

The aliases `paid`, `strata` and `lmstudio` stand for the first row of that kind in `config/settings.md` (also on the app's Models page). A kind can repeat: `paid-2` stands for the second API row, `lmstudio-2` for the second LM Studio row. The id of any other provider works as an alias too (`client`, `acp`, or a provider you added with Add provider, such as `acp-home`). Change a row there and every role that uses the alias follows.

The VN Studio roles:
- `director`: plans each book's job graph and decides what to redo after failures or edits.
- `script-analyst`: normalises the script lines the parser can't settle (place and time, props and cast, expressions, names).
- `art-director`: writes the English ComfyUI prompts for backgrounds, character sheets, expressions and the cover.
- `art-critic`: looks at generated images and approves them or asks for a retry. **It needs a vision model**: put a model with `vision: true` first in its list (a Qwen-VL in LM Studio, Claude or Gemini).
- `composer`: writes the music prompts and assigns tracks to chapters.
- `stage-director`: decides sprite slots, entrances and exits, transitions and music cues.
- `edition-aligner`: aligns a translated edition to the primary structure, beat by beat.
- `voice-director`: picks a voice for each character and tags lines with emotion (only when voice is on).

Changing a default here applies at once: a running job asks its current request again on the new model. `fallback_shared` in `config/settings.md` (the Models page's "One fallback order for every role") gives every role the fallback rows top to bottom instead. The engine rewrites this file when you change a role default in the UI, so comments in the YAML are not kept. The text below the frontmatter is.
