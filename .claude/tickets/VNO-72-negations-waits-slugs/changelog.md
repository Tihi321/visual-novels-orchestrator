# Changelog VNO-72

## 2026-11-22 VNO-72: wider text-negation stripping, 240 s waits, no `--` in slugs

Repo visual-novels-orchestrator, branch `VNO-72_negations-waits-slugs` (from master fe42e25).

- `src/engine/assets/derive.ts`: `stripTextNegations` also drops "without any text", "no text and no signs", "No text." and clauses after a newline or ";". Clauses end at `,` `;` newline or a full stop before whitespace/end; a removed clause takes its following separator (the preceding one when last); the rest is rejoined with its own separators (no more forced ", " spacing). Linear scan, no nested quantifiers.
- `src/engine/mcp/tools.ts`, `tools-import.ts`, `tools-plan.ts`: `WAIT_LIMIT_MS = 240_000` exported and used as the `settle` default and in `vno_wait`; `wait` describe text says "at most 240 s".
- `src/engine/vn/project.ts`: `SLUG_RE` refuses `--`.
- Tests: extended `tests/assets-derive-manifest.test.ts` (5 new expectations plus an unchanged-prompt one) and `tests/vn-interfaces.test.ts` (delete with `<slug>--vn.analyse` refused, project still loads). No new file.
- `ROADMAP.md`: VNO-72 row.

Deviations: none.

Verification: `yarn test` 89 files / 1157 tests passed; `yarn typecheck` and `yarn lint` exit 0. UNTESTED: running app (hub R2 build/restart, K2 real critic rejection, slug refusal over MCP). No build was run.

Commit: committed on the branch (not merged, not pushed).

## Polish 1

- `src/engine/assets/derive.ts`: `TEXT_NEGATION` accepts an optional leading "and " or "or " before `no`/`without`, so a list ending ", and no signs" or ", or without any text" loses that clause too. "and no people", "and a red door" and "or a shop sign with no text" are kept. Doc comment mentions the joined form.
- `tests/assets-derive-manifest.test.ts`: 3 expectations added to the existing `it` (no new `it`).
- Verification: `yarn test` 89 files / 1157 tests passed; typecheck and lint exit 0. Timing on 100,000-character inputs: `and no text, ` x8000 2.06 ms, `and ` x25000 0.28 ms, `a, ` x33000 9.02 ms (limit 50 ms). UNTESTED: running app.
