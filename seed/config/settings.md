---
kind: settings
group_defaults:
  paid: deepseek/deepseek-flash
  strata: strata/qwen3.8-flash-next
  lmstudio: lmstudio/gemma-4-e4b-it-ultra-uncensored-heretic
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

The role lists in `roles.md` can name these aliases instead of a model: `paid`, `strata`, `lmstudio` and the id of any other provider (a custom provider such as `acp-home`, or `acp`). Change a default here (or in the app's Models panel) and every role that uses the alias follows. An agent's own model, picked in the app, still goes first.

- `group_defaults`: the model behind each alias, keyed by group. `paid`: the API model (DeepSeek V4.1 Flash; it can be a free one, such as an OpenRouter `:free` model). `strata`: the Strata model. `lmstudio`: the LM Studio model. A custom provider or `acp` can have its own entry (`acp-home: acp-home/some-model`); without one, its alias stands for its first ticked model. The older fields `default_paid_model`, `default_strata_model` and `default_lmstudio_model` are still read when `group_defaults` does not name the group, and the app writes only `group_defaults`.
- `model_order`: one fallback order for every role, for example `[paid, lmstudio, strata]`. The groups are `paid` (every API model of the built-in providers, free or paid), `strata`, `lmstudio`, and the id of every other provider (`acp`, a custom provider): each of those is its own group. Each role's list is sorted by group and keeps its own order inside a group, so a role that names Strata's `-low` model still uses that one when Strata's turn comes. A group left out goes last. `[]` keeps each role's own order from `roles.md`. Set it in the Models panel (One fallback order for every role, and the up and down buttons) or here. A change applies at once, to running jobs too.

## LM Studio loading

When a request goes to an LM Studio model that isn't loaded, the engine loads it first with these settings (also in the app's Models panel, under lmstudio) (through `lms load`, or LM Studio's API when the `lms` command isn't installed). A model that is already loaded is used as it is.

- `lmstudio_parallel`: how many requests the model serves at once (`--parallel`). 1 means one at a time.
- `lmstudio_context`: the context window (`-c`). The parallel requests share it: one request may use all of it (checked 2026-10-11). A long-book check takes about 23,000 tokens with its answer, so plan about 25,000 per request that runs at once: 131072 suits Gemma 4 E4B with 4 at once. A model in `providers.md` can have its own `load_context` and `load_parallel` (the big Qwen models use 65536 and 2).
- `lmstudio_ttl_minutes`: LM Studio unloads the model after this many idle minutes (`--ttl`).
