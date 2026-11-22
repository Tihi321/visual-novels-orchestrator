---
status: done
request: creative-hub/REQ-0030
repos: [visual-novels-orchestrator]
branch: VNO-72_negations-waits-slugs
updated: 2026-11-22
---

# VNO-72 Wider text-negation stripping, 240 s waits on every tool, no `--` in project slugs

Hub ticket: creative-hub HUB-43 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-43-open-ideas\plan.md`, triage item 9), request REQ-0030. The user said on 2026-11-22: "Ok build open idea first". Follows VNO-71 (`.claude/tickets/VNO-71-signs-wait-delete/plan.md`). Checked on master fe42e25.

Notes for workers:
- VN Studio runs from this repo's `out/` and is RUNNING (hub `vn-studio`, port 7459). No `yarn build` on this branch: tests, typecheck and lint only. Hub R2 builds and restarts after the merge, with the user's go-ahead.
- Do not touch `C:\Users\Infplane\VisualNovels` (live data; another worker edits its config today).
- Commands (Bash: `export PATH="/c/Users/Infplane/AppData/Roaming/fnm/aliases/default:$PATH"` first): test `yarn test`; typecheck `yarn typecheck`; lint `yarn lint`; build `yarn build` (NOT in this ticket).

## Scope

1. **`stripTextNegations`** (`src/engine/assets/derive.ts:37-47`) today splits on commas only and matches a clause `^(?:no|without)\s+WORD(?:\s*(?:,|and|or|/)\s*WORD)*$`. It keeps: "without any text", "No text." (a sentence with a full stop), "no text and no signs", and clauses separated by newlines or `;` (VNO-71 deep check). Widen it to exactly these, keeping "no people", "no borders" and "a shop sign with no text" (verified: the pattern is anchored at the start of a clause, so the last one never matches):
   - an optional `any ` after `no`/`without`: `(?:no|without)\s+(?:any\s+)?WORD`;
   - joiners may repeat the negation: `(?:\s*(?:,|and|or|/)\s*(?:no\s+|without\s+)?(?:any\s+)?WORD)*`;
   - clause separators: `,`, `;`, a newline, and a full stop followed by whitespace or the end. A removed clause takes its following separator with it (the preceding one when it is the last clause); kept clauses and their separators are rejoined as they were, each clause trimmed. A clause's trailing full stop does not stop it matching.
   - Not in scope: "no text on the walls" (a negation with a trailing phrase; widening to it risks "no signs of life"), recorded in the VNO-71 discoveries.
2. **`wait:` on the other tools.** `vno_wait` is capped at 240 s (`src/engine/mcp/tools.ts:344-346`), but `settle` in `tools.ts:77-81`, `tools-import.ts:12-16` and `tools-plan.ts:17-21` waits `opts.waitTimeoutMs ?? 10 * 60_000` (600 s), past the MCP client's ~300 s idle cutoff. One exported constant `export const WAIT_LIMIT_MS = 240_000` in `tools.ts`, used as the default in all three `settle`s and in `vno_wait`; `opts.waitTimeoutMs` (tests, `controller.ts:31-32,107`) still overrides it. The `wait` describe text (`tools.ts:65`, `tools-import.ts:8`, `tools-plan.ts:10`) becomes `'Wait until the jobs finish before answering (at most 240 s; then call vno_wait to keep waiting)'`.
3. **`--` in slugs.** `SLUG_RE` (`src/engine/vn/project.ts:34`, `/^[a-z0-9][a-z0-9._-]*$/`) allows `--`; job ids are `<slug>--<task>--<scope>--r<n>` (e.g. `circuit-breaker-2--vn.analyse--all--r1.md` in the live `jobs\done`), and `deleteProject` removes job files by the prefix `${slug}--` (`src/engine/vn/service.ts:801-811`). So `vno_delete_project {slug: "foo--vn.analyse", confirm: true}` passes `assertSlug` and deletes project `foo`'s analyse job files, even though no such project exists. The same prefix is used by the status counts (`:630`), the queue clear (`:752`), run numbers (`:818`) and the running check (`:878`). Smallest safe fix: `SLUG_RE = /^[a-z0-9](?!.*--)[a-z0-9._-]*$/` (refuses `--` anywhere). No real project has `--`: every slug is made by `projectSlug`/`asciiSlug` (`src/engine/vn/ids.ts:40-52`), which turns every run of non-alphanumerics into one `-` and trims them (the live `VisualNovels\projects` has no folder with `--`, checked 2026-11-22). The listing (`project.ts:101`) uses the same regex, so a hand-made `a--b` folder is neither listed nor reachable, consistently.

## Out of scope

- Progress notifications for long waits; "no text on the walls"-style negations; any change to the critic prompt or the negative prompt.

## Files and modules to touch

| file | change |
|---|---|
| `src/engine/assets/derive.ts:37-47` | the widened pattern and the separator-keeping split; the doc comment lists the forms: "no text", "no letters", "without any signs", "no text and no signs", "No text." |
| `src/engine/mcp/tools.ts` | `WAIT_LIMIT_MS`; `settle` default (`:75`); `vno_wait` uses it (`:344-346`, text unchanged); `wait` describe (`:65`) |
| `src/engine/mcp/tools-import.ts` | import `WAIT_LIMIT_MS`; `settle` default (`:14`); describe (`:8`) |
| `src/engine/mcp/tools-plan.ts` | same (`:19`, `:10`) |
| `src/engine/vn/project.ts:34` | the new `SLUG_RE` |
| `tests/assets-derive-manifest.test.ts:76-85` | extend the existing `it` (below) |
| `tests/vn-interfaces.test.ts:130` area | extend the existing invalid-slug case with `foo--vn.analyse` (below) |
| `ROADMAP.md` | the row below, above the VNO-71 row (line 25; newest first) |

ROADMAP row: `- **VNO-72** (2026-11-22, branch \`VNO-72_negations-waits-slugs\`; creative-hub HUB-43, REQ-0030): a revised prompt also loses "without any text", "no text and no signs" and sentence-style "No text." clauses (also after a newline or ";"); every tool's \`wait\` stops after 240 s like \`vno_wait\`; a project slug may not contain "--", so a delete can never reach another project's job files. Live check UNTESTED (hub K2).`

## Contracts

- `stripTextNegations(prompt: string): string`: as above; an empty result still ends the retries (`handlers.ts:596` unchanged).
- `settle(...)` waits at most `opts.waitTimeoutMs ?? WAIT_LIMIT_MS` and returns `{ waited: true, timedOut: true, ... }` past it, as today.
- `assertSlug` throws `invalid project slug "<slug>"` for a slug with `--`.

## Tasks for workers

1. One worker: the three changes, the two test extensions, ROADMAP; `changelog.md` in this folder (test count, UNTESTED). One commit `VNO-72: wider text-negation stripping, 240 s waits, no -- in slugs` on `VNO-72_negations-waits-slugs`.

## Tests (test-discipline: extend two existing tests, no new file)

- `tests/assets-derive-manifest.test.ts` "drops only the clauses that negate text or signs": add
  - `'a quiet street, without any text, soft light'` -> `'a quiet street, soft light'`
  - `'A quiet street at noon. No text. Warm light.'` -> `'A quiet street at noon. Warm light.'`
  - `'a quiet street, no text and no signs, soft light'` -> `'a quiet street, soft light'`
  - `'a quiet street\nno text\nsoft light'` -> `'a quiet street\nsoft light'`
  - `'a quiet street; no signs; soft light'` -> `'a quiet street; soft light'`
  - unchanged: `'a market, no people, a shop sign with no text, no borders'`
  - the existing five expectations stay as they are.
- `tests/vn-interfaces.test.ts:129-130` (the `getProject` `'../etc'` case): add `await e.handleCommand({ type: 'deleteProject', slug: \`${done.slug}--vn.analyse\` })` and expect `last('command.error')?.message` to match `/invalid project slug/`, and the project `done.slug` still to load (`getProject` gives no error). That proves the refusal comes before any job file is touched.
- The 240 s default has no new test (a constant; `tests/mcp-http.test.ts:131` already covers a timed-out wait through `waitTimeoutMs`).

## Acceptance criteria

| # | criterion | proof |
|---|---|---|
| V1 | the new negation forms are stripped; "no people", "no borders", "a shop sign with no text" stay | extended derive test |
| V2 | no tool waits longer than 240 s by default | `grep -rn "10 \* 60_000" src/engine/mcp` finds nothing; `grep -rn "WAIT_LIMIT_MS" src/engine/mcp` shows the four uses |
| V3 | a slug with `--` is refused before any file is touched | extended interfaces test |
| V4 | nothing else breaks | `yarn test`, `yarn typecheck`, `yarn lint` |

## UNTESTED

- Against the running app until hub R2 (build and restart) and K2 (a real critic rejection; the slug refusal over MCP).
