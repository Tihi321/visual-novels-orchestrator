---
status: done
request: creative-hub/REQ-0031
repos: [visual-novels-orchestrator]
branch: VNO-73_negation-full-stop
updated: 2026-11-22
---

# VNO-73 A stripped last clause keeps the prompt's final full stop; the art-critic's job log says when text negations were removed

Hub ticket: creative-hub HUB-44 (`C:\projects\Personal\creative-hub\.claude\tickets\HUB-44-pending-ideas\plan.md`, triage rows P-22 and P-21), request REQ-0031. Checked on master 12ee5c5 (2026-11-22).

Commands (Bash: `export PATH="/c/Users/Infplane/AppData/Roaming/fnm/aliases/default:$PATH"` first; `fnm exec yarn` fails): test `yarn test`; one file `npx vitest run tests/assets-derive-manifest.test.ts`; typecheck `yarn typecheck`; lint `yarn lint`. No build on the branch: VN Studio is RUNNING from `out/` (`yarn build:engine` is the hub's step after the merge, with VN stopped). Do not touch `C:\Users\Infplane\VisualNovels` (the 8 queued job files of P-23 are the hub's live step, not this ticket).

Rules: branch cut from `master`; regexes and backslashes only through the Edit tool; `*.md` and `seed/**` are LF in the tree, `.ts` CRLF (`core.autocrlf` true): keep each file's line endings, no whole-file rewrites; test-discipline (the one test change below, in the existing file); the new expectation must fail on the old code first (paste the failure into `changelog.md`).

## Scope

1. **P-22, the lost final full stop.** `stripTextNegations` (`src/engine/assets/derive.ts:50-63`) splits a prompt into clauses with `CLAUSE` (`:42`), drops a clause that matches `TEXT_NEGATION` (`:37-40`), and when the removed clause was the last one it clears the separator of the last kept clause (`:61`: `kept[kept.length - 1]!.sep = ''`). So "A street. No text." becomes "A street": the full stop that ended the prompt goes with the removed clause. Verified by reading: for that input `CLAUSE` gives `{text: 'A street', sep: '. '}` and `{text: 'No text', sep: '.'}`; the second is removed, then `:61` empties the first one's `'. '`.
   Fix: remember the separator character of the last removed clause (`m[2]`, the `.`, `,`, `;`, newline or empty end); at `:61` set the last kept clause's separator to `'.'` when that removed clause ended with `.`, else `''` as today. Results: "A street. No text." -> "A street."; "a street, no text." -> "a street."; "a street, no text, no letters, and no signs" -> "a street" (unchanged, `tests/assets-derive-manifest.test.ts:89`); "A quiet street at noon. No text. Warm light." unchanged (`:85`). The doc comment (`:44-49`) says: "A removed last clause gives its full stop to the clause before it."
   Kept on purpose (unchanged, per REQ-0030 and VNO-72): "no text on the walls", "a street and no text" without a comma, "a shop sign with no text", "no people", "no borders" (`:93` covers the last three).
2. **P-21, making the stripper visible in a live run.** `src/engine/vn/handlers.ts:595-598`: the critic's `revisedPrompt` is stripped and drawn, but nothing records whether the stripper removed anything, so a live check cannot tell (HUB-43 K2 had a positive revision). Add, after `:596`: when `review.revisedPrompt` and `revised` are both set and `revised !== review.revisedPrompt.trim()`, `ctx.log(\`art-critic's revised prompt for ${id}: text negations removed before the redraw\`)`. `ctx.log` writes to the agent's and the book's log (`src/engine/queue/scheduler.ts:487,563`). No test (a log line; the hub's live check K4 reads it).

## Files to touch

- `src/engine/assets/derive.ts:50-63` (item 1).
- `src/engine/vn/handlers.ts:596` (item 2).
- `tests/assets-derive-manifest.test.ts:76-95`: in the existing `it('drops only the clauses that negate text or signs')`, add `expect(stripTextNegations('A street. No text.')).toBe('A street.')` and `expect(stripTextNegations('a street, no text.')).toBe('a street.')`. Both fail on the old code ("A street", "a street").
- `ROADMAP.md`: a new line after line 26 (the VNO-71 line), in its style: "- **VNO-73** (2026-11-22, branch `VNO-73_negation-full-stop`; creative-hub HUB-44, REQ-0031): a revised prompt whose last clause was a text negation keeps its final full stop ("A street. No text." becomes "A street."); the job log says when the art-critic's revised prompt lost text negations. Live check UNTESTED (hub K4)."

## Out of scope

- P-24 (`vno_wait` progress events instead of the 240 s cap): OUT, reason in the hub triage (the client's behaviour on progress is unknown; the 240 s cap with a repeated call works).
- P-26 (Gufo probed by its health URL in the autostart check): OUT until the hub's probe P1 gives Gufo's endpoint.
- P-23 (the 8 queued job files): the hub's live step K2.
- "no text on the walls" and the other kept forms.

## Tasks for workers

One worker: inputs this plan and the three files; order: the test lines (show them failing), the fix, the log line, ROADMAP; `yarn test`, `yarn typecheck`, `yarn lint`. Output: one commit on `VNO-73_negation-full-stop` (`VNO-73: a stripped last clause keeps the final full stop; log stripped revised prompts`) and `.claude/tickets/VNO-73-negation-full-stop/changelog.md` with the failing output and the test count.

## Acceptance criteria

| # | criterion | proof |
|---|---|---|
| V1 | the final full stop survives when the last clause is removed; every existing case keeps its result | `tests/assets-derive-manifest.test.ts` (new lines failing first, old lines green) |
| V2 | a revised prompt that lost text negations leaves one log line | code review of `handlers.ts`; hub K4 reads the log |
| V3 | nothing else breaks | `yarn test`, `yarn typecheck`, `yarn lint` |

## UNTESTED

- The stripper on a real critic answer that writes "no text" (hub K4; depends on what Inkling writes, so it may stay UNTESTED).
- The log line in a running VN Studio (after the hub's rebuild).
