# DSH ↔ .claude skill port

**Status:** implemented 2026-10-25
**Scope:** machine-global agent configuration (no project source changes)

## Goal

Make every skill authored in `~/.claude/skills` available to DeepSeek Harness, with the
hand-written orchestration skills rewritten for DSH's delegation and plan-mode model.
`.claude` remains the single authoring location and the artifact convention
(`.claude/tickets/`, `.claude/temp/`) stays unchanged.

## Findings that shaped the plan

- DeepSeek Harness scans `~/.dsh/skills` and `~/.agents/skills` for user-wide skills. It
  never scans `~/.claude/skills`.
- `~/.agents/skills` was a stale copy from 2026-09-29, mangled by a `Claude` → `Codex`
  substitution (e.g. "Codex Opus", `.Codex/tickets/`), and missing `factory`. DSH was
  running that copy.
- DSH loads global instructions from `$DSH_HOME/AGENTS.md` and `~/.agents/AGENTS.md`.
  `~/.claude/CLAUDE.md` was not loaded, so the plan-file, temp-file and
  "invoke the implement skill" rules were absent under DSH.
- DSH has no named subagent types (`subagent_type`), no `Task`/`SendMessage` tools, and no
  Opus/Sonnet split. Delegation is `subagent` / `subagent_fork` / `spawn_teammate`, follow-up
  is `send_message`, and the session runs one model.
- DSH plan mode forbids file writes, so `plan.md` cannot be written while planning.

## Decisions (user-confirmed)

1. Keep two directories and mirror `~/.claude/skills` → `~/.agents/skills` with a script.
2. Give DSH its own `~/.agents/AGENTS.md`; leave `~/.claude/CLAUDE.md` untouched.
3. Tiered adaptation: rewrite the core skills, add a tool map for generated skills, leave
   already-neutral skills alone.
4. Implementer delegation defaults to `subagent` + `send_message`.
5. Auto-run the sync every 10 minutes via a scheduled task, as the fallback after
   `gstack-upgrade`.
6. State the "important ones first" preference (implement / handoff / factory) in AGENTS.md.

## Steps

- [x] Back up the stale `~/.agents/skills` to
      `~/.claude/backups/agents-skills-20261025-000042/` (1.3 GB, 18 008 files).
- [x] Add `~/.claude/scripts/sync-agent-skills.ps1` (one-way full mirror, reports
      added/updated/removed, refuses a destination inside the source, supports `-NoDelete`,
      lock-guarded against overlapping runs).
- [x] Run the mirror.
- [x] Write `~/.agents/AGENTS.md` with: plan-file timing after `exit_plan_mode`, ticket and
      temp conventions, the implement/handoff/factory preference, the Claude-tool → DSH-tool
      map, the single-model reality, and the edit-then-sync rule.
- [x] Rewrite `~/.claude/skills/implement/SKILL.md` for `subagent` delegation.
- [x] Rewrite `~/.claude/skills/handoff/SKILL.md` in host-neutral wording.
- [x] Rewrite `~/.claude/skills/factory/SKILL.md`: role names instead of model tiers,
      `spawn_teammate` for the durable builder, parallel `subagent` reviewers, `send_message`.
- [x] Add a DSH tool note to `~/.claude/agents/implementer.md`.
- [x] Re-run the mirror and verify.
- [x] Write `changelog.md` beside this plan.

## Acceptance criteria

- `~/.agents/skills/factory/SKILL.md` exists, and every mirrored `SKILL.md` matches the
  `.claude` source by SHA256.
- No `.Codex` / "Codex Opus" mangling survives in the mirror.
- DSH's catalog shows `factory` and the adapted `implement` description without an app restart.
- `implement` names no model tiers, no `/model`, and no `subagent_type`, and it delegates with
  `subagent`.
- `factory` contains no model column and uses `spawn_teammate`/`send_message`.
- `~/.agents/AGENTS.md` carries the plan-mode timing rule.

## Verification evidence

- Mirror: 88 skills compared by SHA256 — 0 mismatches, 0 additions pending, 0 removals.
- First mirror run: 1 added (`factory`), 68 updated, 0 removed, 1.6 s.
- `implement` forbidden-token scan (`Sonnet|Opus|subagent_type|/model`): 0 hits.
- `.agents` mangling scan: 0 "Codex Opus" hits. Remaining `.Codex/` hits are legitimate
  install-path references inside the `codex` skill and gstack's own vendored docs.
- DSH catalog refreshed in-session twice without a restart: `factory` appeared in the first
  refresh, and the new `implement` / `handoff` descriptions in the second.
- Scheduled task `DSH skill mirror sync`: registered, Ready, manual trigger ran with
  `LastTaskResult 0`.
- `~/.agents/AGENTS.md` was injected into this session as workspace instructions, confirming
  DSH loads it.

## Deviations

- The auto-sync is a 10-minute scheduled task rather than a wrapper around `gstack-upgrade`
  (which has no single CLI entry point); it is the automatic fallback, and a manual run is
  still the way to make a change visible immediately.
- The "Under Claude Code…" compatibility sentence in `implement` originally contained
  `subagent_type`; reworded to "the `implementer` agent type" so the token scan stays clean.

## Not verified

- A live `implement` run with a real delegated child (no approved plan existed to drive it).
  The skill body, frontmatter and catalog entry are verified; end-to-end delegation is not.

## Rollback

- Restore `~/.agents/skills` from `~/.claude/backups/agents-skills-20261025-000042/`.
- Remove the scheduled task: `Unregister-ScheduledTask -TaskName 'DSH skill mirror sync'`.
- Delete `~/.claude/scripts/sync-agent-skills.ps1`, `~/.agents/AGENTS.md`, and revert the three
  `SKILL.md` files plus `~/.claude/agents/implementer.md` from version control or backups.

## Non-goals

- Editing the 51 AUTO-GENERATED gstack skills (regenerated by `gstack-upgrade`).
- Changing `~/.claude/CLAUDE.md`, the project repository, or DSH's profile configuration.
- Building a DSH agent preset for the implementer.
