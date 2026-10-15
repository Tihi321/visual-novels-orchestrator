---
kind: settings
default_paid_model: deepseek/deepseek-flash
default_strata_model: strata/qwen3.8-flash-next
default_lmstudio_model: lmstudio/gemma-4-e4b-it-ultra-uncensored-heretic
model_order: []
lmstudio_parallel: 4
lmstudio_context: 131072
lmstudio_ttl_minutes: 60
scriptoriumData: ~/Scriptorium
---
# Settings

## Scriptorium

- `scriptoriumData`: the Scriptorium data folder. The Library lists the books in its `books/` folder. `~` is your home folder.

## Default models

The role lists in `roles.md` can name these aliases instead of a model: `paid`, `strata` and `lmstudio`. Change a default here (or in the app's Models panel) and every role that uses the alias follows. An agent's own model, picked in the app, still goes first.

- `default_paid_model`: the API model behind `paid` (DeepSeek V4.1 Flash). It can be a free one, such as an OpenRouter `:free` model.
- `default_strata_model`: the Strata model behind `strata`.
- `default_lmstudio_model`: the LM Studio model behind `lmstudio`.
- `model_order`: one fallback order for every role, for example `[paid, lmstudio, strata]`. The groups are `paid` (every API model, free or paid), `strata` and `lmstudio`. Each role's list is sorted by group and keeps its own order inside a group, so a role that names Strata's `-low` model still uses that one when Strata's turn comes. A group left out goes last. `[]` keeps each role's own order from `roles.md`. Set it in the Models panel (One fallback order for every role, and the up and down buttons) or here. A change applies at once, to running jobs too.

## LM Studio loading

When a request goes to an LM Studio model that isn't loaded, the engine loads it first with these settings (also in the app's Models panel, under lmstudio) (through `lms load`, or LM Studio's API when the `lms` command isn't installed). A model that is already loaded is used as it is.

- `lmstudio_parallel`: how many requests the model serves at once (`--parallel`). 1 means one at a time.
- `lmstudio_context`: the context window (`-c`). The parallel requests share it: one request may use all of it (checked 2026-10-11). A long-book check takes about 23,000 tokens with its answer, so plan about 25,000 per request that runs at once: 131072 suits Gemma 4 E4B with 4 at once. A model in `providers.md` can have its own `load_context` and `load_parallel` (the big Qwen models use 65536 and 2).
- `lmstudio_ttl_minutes`: LM Studio unloads the model after this many idle minutes (`--ttl`).
