---
status: done
request: creative-hub/REQ-0030
repos: [visual-novels-orchestrator]
branch: VNO-71_signs-wait-delete
updated: 2026-11-22
---

# VNO-71 A rejected picture is redrawn without "no signs" in its prompt; vno_wait waits at most 240 s; a deleted project takes its job files with it

Hub ticket: creative-hub HUB-42 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-42-pending-ideas-and-proxy-monitor\plan.md`, triage rows P18, E2, E3), request REQ-0030. Checked on master 0f360c3 (2026-11-22).

Commands (Bash: `export PATH="/c/Users/Infplane/AppData/Roaming/fnm/aliases/default:$PATH"` first): test `yarn test`; typecheck `yarn typecheck`; lint `yarn lint`; engine build `yarn build:engine` (the hub rebuilds after the merge; VN Studio is running from `out/`, so do not build on the branch). Do not touch `C:\Users\Infplane\VisualNovels`.

## Scope

1. **P18, lettered signs after a rejection.** HUB-41 K2: after the critic rejected a background for a sign with lettering, its `revisedPrompt` ("..., no text, no letters, no signs, no captions, no borders") was drawn as the next positive prompt, and the next two pictures had lettered signs again. Cause, verified:
   - the `revisedPrompt` replaces the positive prompt unchanged (`src/engine/vn/handlers.ts:596-598`: `const revised = review.revisedPrompt?.trim()` ... `generateOne(ctx, slug, id, { force: true, prompt: revised })`);
   - the critic is told to "add what was missing, remove what caused the problem" (`seed/prompts/art-critic/review_image.md:22`), so it writes negations, and an image model draws what a prompt names;
   - backgrounds do have a negative prompt with "text, letters, words" (`src/engine/assets/derive.ts:34`, `:318-321`, kept on regeneration, `src/engine/assets/generate.ts:374`), but qwen-image-2.1 runs at cfg 1 (`src/engine/comfy/graphs.ts:392`), where ComfyUI's sampler ignores the negative.
   Fix, two small parts: (a) the critic prompt asks for a revised prompt without negations; (b) the code removes negation clauses about text and signs from a revised prompt before it is drawn (a model may still write them).
2. **E2, `vno_wait`.** `src/engine/mcp/tools.ts:341-349`, `timeoutSeconds` default 600, no maximum; MCP clients drop a call that sends nothing for about 300 s (HUB-41 K2: a 900 s wait was cut at 300 s). No progress support exists (`src/engine/mcp/server.ts:34` drops the handler's `extra`). Smallest fix: default and maximum 240 s, said in the tool and the guide.
3. **E3, `vno_delete_project`.** `deleteProject` (`src/engine/vn/service.ts:800-807`) removes only `queued` job files of the slug; `done` and `failed` ones stay (`VisualNovels\jobs\done` holds 1853 files; HUB-41 K2 left three).

## Out of scope

- Raising cfg so the negative prompt works (doubles sampling time; not tested); progress notifications for `vno_wait`; the art-director prompt; Edu's and Cartoon's critics (their revised prompts are not drawn the same way: not checked here).
- `running` job files (a running job moves its own file when it ends; deleting it under the worker is not safe).

## Files to touch (verified)

**`seed/prompts/art-critic/review_image.md:22`**, append to the paragraph (after "Otherwise `revisedPrompt` is null."): " Never put negations in `revisedPrompt` (no \"no text\", \"no letters\", \"no signs\", \"without people\"): image models draw what a prompt names. To remove something, delete every word that asks for it or invites it (signs, boards, shop names, posters, banners, labels, books, writing) and describe the plain thing instead (a blank wooden shop front, a bare plaster wall)." The live copy is refreshed from the seed on the next app start when it is unedited (`.seed-hashes.json`, as in HUB-40 L2).

**`src/engine/assets/derive.ts`**, a new exported pure function next to `DEFAULT_NEGATIVE` (`:34`):
```ts
/** Removes comma-separated clauses that negate text or signs ("no text", "no letters", "without signs", "no captions", "no writing", "no words", "no watermark", "no logo"): image models draw what a prompt names. The rest of the prompt is kept in order. */
export function stripTextNegations(prompt: string): string
```
Rule: split on commas, drop a clause (trimmed, case-insensitive) that matches `^(no|without)\s+(text|letters?|words?|writing|signs?|signage|captions?|labels?|watermarks?|logos?)(\s*(,|and|or|\/)\s*(text|letters?|words?|writing|signs?|signage|captions?|labels?|watermarks?|logos?))*$`, rejoin with ", ". Other negations ("no people", "no border") are left: they are not about text, and "no people" keeps working through the critic's existing background rule.

**`src/engine/vn/handlers.ts:596`**: `const revised = review.revisedPrompt?.trim()` becomes `const revised = review.revisedPrompt ? stripTextNegations(review.revisedPrompt).trim() : undefined` (import from `../assets/derive`; the worker checks the relative path).

**`src/engine/mcp/tools.ts:344-346`**: `timeoutSeconds: z.number().positive().max(240).optional().describe('Default and maximum: 240 (MCP clients drop a call that is silent for about 300 s); call again to keep waiting')` and `(a.timeoutSeconds ?? 240) * 1000`.

**`src/engine/vn/service.ts:800-807`** `deleteProject`: loop over `queued`, `done` and `failed` (the `JOB_STATES` list imported at `:47` minus `running`) and remove each `<slug>--*` file; a doc comment "removes the project and its job files (not a running job's file)".

**`docs/mcp-guide.md:15`**: "A client that times out on a long call should poll `vno_wait` with a short `timeoutSeconds` instead." becomes "A client that times out on a long call should poll `vno_wait` instead: it waits at most 240 s per call (MCP clients drop a call that is silent for about 300 s), so call it again to keep waiting." The worker also checks `docs/mcp-guide.md:9` and `:181` and adds "(at most 240 s per call)" where they describe `vno_wait`'s timeout.

**`ROADMAP.md`**, a new last row in the style of `ROADMAP.md:24`: "- **VNO-71** (2026-11-22, branch `VNO-71_signs-wait-delete`; creative-hub HUB-42, REQ-0030): a picture the art-critic rejected is redrawn from its revised prompt without "no text / no signs" clauses (image models draw what is named; qwen-image runs at cfg 1, where the negative prompt has no effect), and the critic is asked not to write them; `vno_wait` waits at most 240 s per call; `vno_delete_project` also removes the project's done and failed job files. Live check UNTESTED (hub K2)."

## Tests (test-discipline: three, in existing files)

- `stripTextNegations`: one test with four cases in the test file that already covers `derive.ts` (the worker finds it with `grep -ln "derive" tests`; else `tests/assets-generate.test.ts`): HUB-41 K2's real revised prompt "A small cobbled village square with a stone fountain at noon, no people, anime visual novel background, fills the whole image, no text, no letters, no signs, no captions, no borders" becomes "A small cobbled village square with a stone fountain at noon, no people, anime visual novel background, fills the whole image, no borders"; "no text or signs" is dropped; "a shop sign" is kept; a prompt with no negation is unchanged.
- `tests/mcp-http.test.ts:114-122` (the existing `vno_wait` case): add that `timeoutSeconds: 1000` is refused with a validation error.
- `tests/vn-interfaces.test.ts:140-145` (the existing delete case): before the delete, write a `done` and a `failed` job file for the slug and one `done` file for another slug; after it, the slug's files are gone and the other slug's file stays.

## Tasks for workers

One worker: the five changes, the tests, docs and ROADMAP; `yarn test`, `yarn typecheck`, `yarn lint`. Output: one commit on `VNO-71_signs-wait-delete` (`VNO-71: revised prompts without text negations, vno_wait max 240 s, delete removes job files`), `changelog.md` with the test count.

## Acceptance criteria

| # | criterion | proof |
|---|---|---|
| V1 | a revised prompt reaches generation without "no text / no letters / no signs" clauses, other words kept | the `stripTextNegations` test; code review of `handlers.ts:596` |
| V2 | the critic prompt asks for no negations | `grep -n "Never put negations" seed/prompts/art-critic/review_image.md` |
| V3 | `vno_wait` refuses more than 240 s and defaults to 240 | the mcp-http assertion |
| V4 | a deleted project leaves no queued, done or failed job file; other projects keep theirs | the vn-interfaces test |
| V5 | nothing else breaks | `yarn test`, `yarn typecheck`, `yarn lint` |

## UNTESTED

- Whether Qwen-Image draws fewer signs without the negations (hub K2 records it; one sample is weak evidence).
- The live prompt refresh (on the next VN start; edited live copies keep their text).
