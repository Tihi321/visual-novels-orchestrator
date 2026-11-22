# Changelog

## 2026-11-22 VNO-73: a stripped last clause keeps the final full stop; stripped revised prompts are logged

Repo visual-novels-orchestrator, branch `VNO-73_negation-full-stop` (from master).

- `src/engine/assets/derive.ts`: `stripTextNegations` remembers the separator of the last clause; when the last clause is removed and ended with ".", the last kept clause ends with "." ("A street. No text." -> "A street."; "a street, no text." -> "a street."). Other results unchanged. Doc comment updated.
- `src/engine/vn/handlers.ts`: art-critic loop logs "art-critic's revised prompt for <id>: text negations removed before the redraw" when the stripped prompt differs from the critic's.
- `tests/assets-derive-manifest.test.ts`: two expectations added to the existing stripTextNegations test.
- `ROADMAP.md`: VNO-73 line.

Failing first (old code, `npx vitest run tests/assets-derive-manifest.test.ts`):

    AssertionError: expected 'A street' to be 'A street.'
    tests/assets-derive-manifest.test.ts:90
    Tests  1 failed | 15 passed (16)

Verification: `yarn test` 89 files, 1157 tests pass; `yarn typecheck` exit 0; `yarn lint` exit 0. No build (VN Studio running from out/).
UNTESTED: stripper on a real critic answer (hub K4); the log line in a running VN Studio (after rebuild).
Deviations: none. Commit: see git log on the branch.

## Polish 1

- `src/engine/assets/derive.ts`: clause split shared in `splitClauses`; new `hasTextNegation(prompt)` (true when the stripper would drop a clause). When the removed last clause ended with ".", the full stop goes on the last kept clause with text, empty clauses after it are dropped ("A street.\nNo text." -> "A street."; "a street,\nno text." -> "a street."). Other inputs unchanged.
- `src/engine/vn/handlers.ts`: the "text negations removed" log line uses `hasTextNegation(review.revisedPrompt)`, so spacing normalisation alone no longer logs it.
- `tests/assets-derive-manifest.test.ts`: four lines in the existing stripTextNegations test.
Failing first (994eae6): expected 'A street..' to be 'A street.' (tests/assets-derive-manifest.test.ts:92).
Verification: `yarn test` 1157 pass (one unrelated 15 s timeout in vn-pack-editions on a loaded first run, passed on rerun); typecheck and lint exit 0. No build.
