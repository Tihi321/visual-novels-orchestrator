---
status: done
request: creative-hub/REQ-0030
repos: [visual-novels-orchestrator]
branch: VNO-68_vision-fallback-inkling
updated: 2026-11-21
---

# VNO-68 Vision fallback: the art-critic gets Inkling through the ACP proxy

Part of creative-hub HUB-39 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-39-vision-fallback-inkling\plan.md`), a follow-up to HUB-38 / VNO-67. The art-critic's local entry `lmstudio` becomes `acp/llama/inkling-2-mini` (the ACP proxy's vision model). Today `lmstudio` resolves to `lmstudio/gemma-4-e4b-it-ultra-uncensored-heretic`, which has no `vision: true`, so the critic had no model at all (`tests/models.test.ts:81`). `paid` (`deepseek/deepseek-flash`) has no vision either, so after this ticket Inkling is the only vision model the role has. Code and seed only here: the user's `C:\Users\Infplane\VisualNovels` is changed by the hub (HUB-39 L1), never by this ticket.

## Scope

1. Seed `seed/config/providers.md`: the two Inkling rows (lines 172-179) get `extra_body` (V1); the prose at lines 231 and 233 says what V4 says.
2. Seed `seed/config/roles.md`: `art-critic` (line 11) per V2; the prose on line 25 (the sentence about `lmstudio`) and line 31 (the `art-critic` bullet).
3. `src/engine/vn/agents/art-critic.ts:45`: `maxTokens: 1200` becomes `2000` (V3).
4. Tests: update the existing seed assertion; change the sample in one existing extra_body test.
5. `ROADMAP.md` row.

## Out of scope

- The `lmstudio` provider row, its models, and the `lmstudio/gemma…` row of `BUILTIN_FALLBACKS` (`src/shared/schemas.ts:161-165`): they stay as they are.
- `src/engine/studios/autostart.ts:335-342` (the guard that knows only Strata on 8080): no change.
- Any per-model token field.
- The request timeout (15 min default, `src/engine/models/openaiCompat.ts:77`, not overridden at `registry.ts:377-386`: enough).
- A seed migration: an existing data folder is edited by the hub.
- `art.review` default (`src/shared/vn.ts:335`, stays false).
- The user's data folder.
- Freeing ComfyUI or unloading Inkling around a review.

## Contracts (copied from HUB-39; keep identical)

### V1 The Inkling rows of the `acp` provider

```yaml
      - id: llama/inkling-2-mini
        family: inkling
        context: 32768
        vision: true
        extra_body: { chat_template_kwargs: { reasoning_effort: none } }
      - id: llama/inkling-2-mini-dspark
        family: inkling
        context: 32768
        vision: true
        extra_body: { chat_template_kwargs: { reasoning_effort: none } }
```

`chat_template_kwargs` is the only field that reaches Inkling's chat template (the proxy forwards it since AAP-42). Top-level `reasoning_effort` or `enable_thinking` have no effect on Inkling. Thinking gets shorter but cannot be switched off.

### V2 The critic list

`art-critic: models: [paid, acp/llama/inkling-2-mini]`. Always the full ref, never the alias `acp` (that is LOCAL, the Strata text model). No other role names `lmstudio` or Inkling. `fallbacks` do not change.

### V3 Token cap and timeout

`reviewImage` asks for 2000 tokens, for every model (was 1200). This is a ceiling: harmless for cloud models, and the budget reserve grows by under $0.002. The request timeout stays at 15 minutes, the client default. Measured for this prompt on Inkling: 586 to 1157 completion tokens; 2000 was valid in 6 of 6 tests.

### V4 Wording

"The critic's local model is `acp/llama/inkling-2-mini` through the ACP proxy (HUB-39): about 2 minutes per review, thinking kept short with `chat_template_kwargs`, and the proxy switches the GPU from Strata to Inkling (about 20 s) and back (about 55 s). It shares GPU memory with ComfyUI's image model while a run makes pictures."

## What the code already does (checked; nothing to change)

- **Nested `extra_body` reaches the request as it is.** Path: schema `src/shared/schemas.ts:39` (`z.record(z.string(), z.unknown())`), then `registry.ts:241,278` (`extraBody: m.extra_body ?? null`), then `router.ts:184`, then `openaiCompat.ts:65-71` (spread into the body). `max_tokens` is set after the spread (`:72`), so the cap stays the call's.
- **Images.** `art-critic.ts:22-25` converts every image to JPEG (q85, at most 1024 px). A sprite sends its sheet first, then the image (`:50-51`); every other kind sends one image. No webp is sent.
- **Routing.** `router.ts:118` drops non-vision models for `visionOnly`. `handlers.ts:542` turns the review on only when `art.review` is true and a vision candidate exists. The critic agent (`agents/art-critic-default.md`, `max_parallel: 1`) runs one review at a time. `chatJson` (`src/engine/pipeline/llm.ts:69-111`) repairs once with the same cap and the images again.

## Files and modules to touch (lines verified 2026-11-21 on master)

| file | lines | change |
|---|---|---|
| `seed/config/providers.md` | 172-179 | V1: add the `extra_body` line under `vision: true` of both rows |
| `seed/config/providers.md` | 231 | "so roles and the fallback list name only the strata one" becomes "so the text roles and the fallback list name only the strata one; the art-critic names `llama/inkling-2-mini` (HUB-39)" |
| `seed/config/providers.md` | 233 | the whole bullet becomes: "- The cloud models are text only. The art-critic's local model is `acp/llama/inkling-2-mini` through the ACP proxy (HUB-39): about 2 minutes per review, thinking kept short with `chat_template_kwargs`, and the proxy switches the GPU from Strata to Inkling (about 20 s) and back (about 55 s). It shares GPU memory with ComfyUI's image model while a run makes pictures. `lmstudio` is no longer named by any role." |
| `seed/config/roles.md` | 11 | `models: [paid, acp/llama/inkling-2-mini]` |
| `seed/config/roles.md` | 25 | "`lmstudio` is only for the art-critic's vision model." becomes "No role names `lmstudio` any more; the art-critic names `acp/llama/inkling-2-mini` directly (the alias `acp` is the text model)." |
| `seed/config/roles.md` | 31 | the bullet becomes: "- `art-critic`: looks at generated images and approves them or asks for a retry. **It needs a vision model** (`vision: true`): `paid` (DeepSeek) has none, so it uses `acp/llama/inkling-2-mini` through the ACP proxy (HUB-39), about 2 minutes per image, thinking kept short; it shares GPU memory with ComfyUI. Put Claude, Gemini or `client/claude-code` first (here, or the project's `models`) for a faster review." |
| `src/engine/vn/agents/art-critic.ts` | 45 | `maxTokens: 1200` becomes `maxTokens: 2000` |
| `tests/models.test.ts` | 78-82 | comment and assertion: see T2 |
| `tests/models.test.ts` | 548 | `extraBody: { thinking: false }` becomes `extraBody: { chat_template_kwargs: { reasoning_effort: 'none' } }`, plus the matching body assertion in that test |
| `ROADMAP.md` | after line 21 | the row below |

`seedRefresh.ts` lists only prompt hashes: config files are not refreshed, so there is no hash to update. Check that `prompts/art-critic/review_image.md` is untouched.

## Tasks for workers

One worker can do all three, in order. Each starts from master on branch `VNO-68_vision-fallback-inkling`.

- **T1 Seed and code.**
  - Inputs: V1 to V4 and the table above.
  - Outputs: the edits to `seed/config/providers.md`, `seed/config/roles.md` and `src/engine/vn/agents/art-critic.ts`.
  - Contract with T2: the seed lists `art-critic` as exactly `[paid, acp/llama/inkling-2-mini]`, and the Inkling rows carry exactly the V1 `extra_body`.
  - Check: the YAML front matter still parses. `yarn typecheck`.
- **T2 Tests (test-discipline: extend the existing ones, no new test file, no near-duplicates).**
  - Inputs: T1's seed.
  - In `tests/models.test.ts:78-82`, the art-critic branch becomes `expect(refs).toEqual(['deepseek/deepseek-flash', 'acp/llama/inkling-2-mini'])`, with the comment "the art-critic names Inkling (HUB-39)".
  - In the same test block, add two lines:
    - `expect(registry.getModel('acp/llama/inkling-2-mini')).toMatchObject({ vision: true, extraBody: { chat_template_kwargs: { reasoning_effort: 'none' } } })`
    - `expect(new ModelRouter(registry, undefined).candidates('art-critic', { visionOnly: true }).map((m) => m.ref)).toEqual(['acp/llama/inkling-2-mini'])`
  - In the extra_body test at `:539-548`, the sample becomes the nested object, and the body assertion checks `chat_template_kwargs` arrives nested.
  - Run `yarn test`. If a test builds an engine from the seed and runs a review job, it must not reach 8787: check `tests/vn-handlers.test.ts` (it uses mock providers today) and fix only the expectation if one now sees a vision model.
  - Outputs: green tests.
- **T3 ROADMAP and verification.**
  - Add the row.
  - Run `yarn test`, `yarn typecheck` and `yarn build:engine`, with the fnm default alias dir on PATH (yarn under fnm: `fnm exec yarn` fails).
  - Commit on the branch, one commit; the message with a heredoc.

## Acceptance criteria and the test that proves each

| # | criterion | proof |
|---|---|---|
| A1 | a fresh folder from the seed gives the art-critic `[deepseek/deepseek-flash, acp/llama/inkling-2-mini]`, and its only vision candidate is Inkling | `tests/models.test.ts` seed block (T2) |
| A2 | the Inkling row sends `chat_template_kwargs: { reasoning_effort: "none" }` nested in the body | the changed extra_body test (`tests/models.test.ts:539`) and the `extraBody` assertion (T2) |
| A3 | the art-critic asks for 2000 tokens | code review of `art-critic.ts:45` (a constant; no test) |
| A4 | nothing else changes: other roles, `fallbacks`, the `lmstudio` provider | the existing seed assertions in `tests/models.test.ts:73-82`, still green |
| A5 | `yarn test`, `yarn typecheck`, `yarn build:engine` pass | T3 |
| Live | a real review on Inkling (1 and 2 images, ComfyUI next to it) | hub HUB-39 K2 after the hub's L1. UNTESTED in this ticket. |

## ROADMAP row

`- **VNO-68** (2026-11-21, branch \`VNO-68_vision-fallback-inkling\`; creative-hub HUB-39, REQ-0030): the art-critic's local model is \`acp/llama/inkling-2-mini\` through the ACP proxy (in place of \`lmstudio\`, whose row had no vision); the Inkling rows send \`chat_template_kwargs: { reasoning_effort: none }\`; the review asks for 2000 tokens. Live check UNTESTED (hub K2).`
