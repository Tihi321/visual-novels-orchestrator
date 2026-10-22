# VNO-17-18: VN Studio's roadmap items as tasks

Branch `VNO-17-18_roadmap-tasks` from `master` (6e25fa0). One commit per ticket, in the order below. Cross-tool work stays in the creative hub (`HUB-NN`); VNO-10 to VNO-16 are reserved by hub tasks (HUB-07 `VNO-10`, HUB-08 `VNO-11`, HUB-10 `VNO-12`-`VNO-15`, HUB-06 `VNO-16`), so these tickets start at VNO-17.

## Tasks, in order

| # | Ticket | What | Plan |
|---|---|---|---|
| 1 | VNO-17 | The unit tests VNO-08 phase 6 planned for media cues and expression sets (story, import, derive, generate, emit, stage, MCP) | `.claude/tickets/VNO-17-media-cue-tests/plan.md` |
| 2 | VNO-18 | The hand-mode test covers `key` background removal through `vno_asset_import` | `.claude/tickets/VNO-18-hand-mode-key-test/plan.md` |

## Commits

1. `VNO-17-18: Roadmap items as ordered tasks with plans` (this plan, the ticket plans, ROADMAP as a task table).
2. `VNO-17: Unit tests for media cues and expression sets` (tests, changelog, ROADMAP row to Done).
3. `VNO-18: Hand-mode test for key background removal on import` (test, changelog, ROADMAP row to Done).

## Verification (whole branch)

`yarn test`, `yarn typecheck` and `yarn lint` exit 0 after each commit. Test-only tickets: if a new test finds a bug, the fix goes in the same ticket's commit and its changelog says so.

## Status (2026-10-22)

- [x] Commit 1: roadmap as tasks, plans.
- [x] VNO-17: 22 new tests, no bug found (`VNO-17-media-cue-tests/changelog.md`).
- [x] VNO-18: 2 new tests, no bug found (`VNO-18-hand-mode-key-test/changelog.md`).
- `yarn test` 56 files, 741 passed (717 on master); `yarn typecheck`, `yarn lint` exit 0. Not pushed, no PR.
