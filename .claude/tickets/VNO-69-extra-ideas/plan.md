---
status: done
request: creative-hub/REQ-0030
repos: [visual-novels-orchestrator]
branch: VNO-69_extra-ideas
updated: 2026-11-22
---

# VNO-69 The art-critic stops rejecting sprites for the grey backing, notes in English, and leftovers of VNO-67/68

Part of creative-hub HUB-40 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-40-extra-ideas\plan.md`, ideas 2, 6, 8, 11, 35, 39, 40 of REQ-0030).

Why the sprite change (hub live check K2, `creative-hub/runs/hub-39-vision-checks.md`): `reviewThumbnail` (`src/engine/vn/agents/art-critic.ts:22-25`) flattens a transparent sprite on `#808080` before the critic sees it, while the prompt (`seed/prompts/art-critic/review_image.md:18`) asks every character or sprite for a "plain light background". A good sprite was rejected three times for "solid medium gray background" and the revised prompt could not fix it. Decision (director): keep the mid-grey backing (it shows both light and dark edges) and tell the critic it is not part of the picture.

## Scope

1. The art-critic prompt: the grey backing of a sprite, and the answer in English.
2. Autostart: ComfyUI is not started while Gufo (8081) answers, as for Strata.
3. Wording: Models page help text, the Strata script path and the `lmstudio` comment in the seed.
4. Test sample URL 7461 to 8787 in `tests/custom-providers.test.ts`.
5. ROADMAP row.

## Out of scope

- The flatten colour, the thumbnail size, the critic's token cap, the review retry count.
- Llama.cpp (8082) in the autostart check: it serves only Inkling, which runs beside ComfyUI by design (HUB-39 K2: no ComfyUI error with both loaded); blocking ComfyUI while Inkling is loaded would stop pictures after a review.
- The live data folder `C:\Users\Infplane\VisualNovels` (the live prompt is unedited and recorded in `.seed-hashes.json`, so `initDataFolder` replaces it with the new seed on the next start; the hub checks that).
- Other stale prose in `seed/config/providers.md` (for example line 248 about LM Studio).

## Files and modules to touch (verified on master, 2026-11-22)

**`seed/prompts/art-critic/review_image.md`**
- Line 18 today: "- For a character or sprite: one character only, whole body in view, plain light background, no cut-off limbs, no extra fingers or limbs."
  Replace with two lines:
  "- For a character sheet: one character only, whole body in view, plain light background, no cut-off limbs, no extra fingers or limbs."
  "- For a sprite: one character only, whole body in view, no cut-off limbs, no extra fingers or limbs. A sprite is a cut-out with a transparent background; it is shown to you on a flat mid-grey backing that is not part of the picture. Do not judge that grey, do not list it as a problem, and do not ask for another background."
- After line 21 (the "Approve it when it is usable..." paragraph), add one line: "Write `problems` and `revisedPrompt` in English."
- Nothing else; the `{{...}}` variables stay.

**`src/engine/vn/agents/art-critic.ts`**: no code change. The doc comment of `reviewThumbnail` (line 21) may add "the prompt tells the critic the grey is not part of the picture".

**`src/engine/studios/autostart.ts:335-342`** today:
```ts
    if (id === 'comfyui') {
      const strata = reg.entries.find((e) => e.id === 'strata')
      if (strata && (await probe(strata))) {
        const reason = 'ComfyUI not started: Strata is running and uses most of the GPU'
        this.say(`autostart ${id}: ${reason}`, o)
        return reason
      }
    }
```
After: a module constant above the class, `GPU_HOLDERS = [{ id: 'strata', name: 'Strata', port: 8080 }, { id: 'gufo', name: 'Gufo', port: 8081 }]`, with the comment "Local model servers that take most of the GPU: ComfyUI is not started while one answers. Llama.cpp (8082, Inkling) is left out: it runs beside ComfyUI (creative-hub HUB-39)." The check loops over it: the entry is the registry entry with that id if `services.json` lists one, else `{ id, port }` (services.json has no `gufo` entry; `defaultProbe` then connects to the port). The first that answers returns `ComfyUI not started: ${name} is running and uses most of the GPU` (said and returned as today). The Strata message stays word for word.

**`src/renderer/ui/ModelsPage.tsx`**
- Line 408: "Fallback models: each row is a kind (API, Strata, LM Studio ...) and its model. roles.md names a kind for its first row (paid, strata, lmstudio ...) and kind-2, kind-3 for the next ones." becomes "Fallback models: each row is a kind (API, ACP proxy, LM Studio ...) and its model. roles.md names a kind for its first row (paid, acp, lmstudio ...) and kind-2, kind-3 for the next ones."
- Line 428: "A role's own model of the same kind (Strata's -low for the checks) takes that row's place." becomes "A role's own model of the same kind takes that row's place." (rest of the string unchanged).
- Line 429: "The rows set what paid, paid-2, strata, lmstudio ... stand for." becomes "The rows set what paid, paid-2, acp, lmstudio ... stand for."
- The doc comments at lines 19-30 describe the `loaded` Strata rows that still exist in code: leave them.

**`seed/config/providers.md`**
- Line 245: "chosen by the `run-*.bat` you start in `D:\Strata`:" becomes "chosen by the `run-*.bat` you start in `D:\Strata\terminal`:" (the scripts are there, checked on disk).
- Lines 80-83 today (inside the `lmstudio` block):
  ```yaml
      # For the art-critic, add a vision model you have in LM Studio (for example a Qwen-VL) with `vision: true`:
      #   - id: qwen2.5-vl-7b-instruct
      #     family: qwen
      #     vision: true
  ```
  becomes one line: `    # Not for the art-critic: its local vision model is acp/llama/inkling-2-mini through the ACP proxy (HUB-39).`

**`tests/custom-providers.test.ts`**: the sample address `http://127.0.0.1:7461/v1` becomes `http://127.0.0.1:8787/v1` at lines 54 (both the input `' http://127.0.0.1:7461/v1/ '` and the expected value), 61, 67, 107, 113. They are a custom provider `acp-proxy-home`; the 7461 migration touches only the id `acp`. Leave `tests/seed-migrations.test.ts:69-70` as it is (7461 is the old address under test there).

**`tests/autostart.test.ts:294-301`** (`'does not start ComfyUI while Strata answers, and starts it when Strata is down'`): rename to "...while Strata or Gufo answers..." and add, before the `free` part: `const gufo = setup({ up: new Set(['gufo']) })`, `expect(await gufo.starter.ensure('comfyui', URLS.comfyui!)).toMatch(/Gufo is running/)`, `expect(gufo.spawned).toHaveLength(0)`. No new test.

## Tasks for workers

- **T1 prompt** (review_image.md). Contract: the variables `{{id}} {{kind}} {{prompt}} {{hasSheet}}` stay; the JSON example line stays.
- **T2 autostart** (autostart.ts and its test). Contract: the existing Strata reason text is unchanged (`tests/autostart.test.ts:297` and `:420-422` match on "Strata is running").
- **T3 wording** (ModelsPage.tsx, seed providers.md) and **T4 test URLs** (custom-providers.test.ts).
- **T5 ROADMAP** (`ROADMAP.md`, after the VNO-68 bullet at line 22, same style):
  `- **VNO-69** (2026-11-22, branch `VNO-69_extra-ideas`; creative-hub HUB-40, REQ-0030): the art-critic prompt says a sprite is shown on a mid-grey backing that is not part of the picture (no more rejections for it) and asks for English notes; autostart does not start ComfyUI while Gufo answers (as for Strata); Models page help, Strata script path and the seed's LM Studio comment updated. Live check UNTESTED (hub N1).`

## Acceptance criteria and the command that proves each

Commands (Bash): `export PATH="/c/Users/Infplane/AppData/Roaming/fnm/aliases/default:$PATH"; cd /c/projects/Personal/visual-novels-orchestrator`, then `yarn test`, `yarn typecheck`, `yarn lint`, `yarn build:engine`.

| # | criterion | proof |
|---|---|---|
| A1 | The prompt tells the critic the sprite's grey is not part of the picture; "plain light background" applies only to the sheet | `grep -n "background" seed/prompts/art-critic/review_image.md` |
| A2 | The critic is asked for English | the added line in the prompt |
| A3 | ComfyUI is not auto-started while Gufo answers; the Strata case is unchanged | `tests/autostart.test.ts` |
| A4 | No help text or seed comment names Strata's `-low` or an LM Studio vision model; the Strata script path exists | `grep -nF -e "Strata's -low" -e "vision model you have in LM Studio" -e 'start in `D:\Strata`:' src/renderer/ui/ModelsPage.tsx seed/config/providers.md` finds nothing |
| A5 | No 7461 left in `tests/custom-providers.test.ts` | `grep -n 7461 tests/custom-providers.test.ts` finds nothing |
| A6 | Nothing else broke | the four commands pass |

## UNTESTED

- A real sprite review on Inkling with the new prompt (hub N1, GPU, the user's go-ahead).
- The Models page text in the running app (renderer only; typecheck covers it).
- The Gufo check against a real Gufo server (the test uses the probe stub).
