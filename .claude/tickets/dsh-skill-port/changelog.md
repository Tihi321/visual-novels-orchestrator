# Changelog

## 2026-10-25 — dsh-skill-port

Ported the global `.claude` skills into DeepSeek Harness: DSH now reads the current skill tree
instead of a two-week-old mangled copy, and the orchestration skills delegate through DSH tools.

### Machine-level configuration (no repository branch)

**`C:\Users\Infplane\.agents\skills`** — replaced (mirrored) from `~/.claude/skills`.

- Was a stale 2026-09-29 copy whose text had been run through a `Claude` → `Codex` substitution
  (`Codex Opus`, `.Codex/tickets/`) and which lacked `factory`.
- The original directory is preserved at
  `~/.claude/backups/agents-skills-20261025-000042/` (1.3 GB, 18 008 files).
- After the mirror: 88 skills, 0 mismatches against the `.claude` source.

**`C:\Users\Infplane\.claude\scripts\sync-agent-skills.ps1`** — new.

- One-way mirror `~/.claude/skills` → `~/.agents/skills` using `robocopy /MIR`.
- Prints added / updated / removed / unchanged; `-NoDelete` for update-only runs; refuses a
  destination nested inside the source; lock file prevents overlapping runs.
- `~/.claude/CLAUDE.md` is never touched by a run.

**`C:\Users\Infplane\.agents\AGENTS.md`** — new.

- DSH's global instruction file, and the reason the `.claude` conventions now apply under DSH:
  plan-file timing (after `exit_plan_mode`, since plan mode forbids writes), `.claude/tickets/`
  and `.claude/temp/` conventions, and the implement/handoff/factory preference.
- Carries the Claude-tool → DSH-tool map, the single-model reality, and the edit-then-sync rule.
- `~/.claude/CLAUDE.md` is deliberately unchanged; the two files are maintained separately.

**Scheduled task `DSH skill mirror sync`** — new.

- Runs the mirror every 10 minutes with `-NoDelete`; this is the automatic fallback after
  `gstack-upgrade`, which regenerates the AUTO-GENERATED gstack skills in the `.claude` source.
- Removable with `Unregister-ScheduledTask -TaskName 'DSH skill mirror sync'`.

### Skill rewrites (authored in `~/.claude/skills`, then mirrored)

**`implement/SKILL.md`** — replaced the Opus/Sonnet orchestration split with the harness reality.

- Removed: the "ask the user to switch model via `/model`" step, the Sonnet pinning rule, the
  `subagent_type: "implementer"` delegation, and the Agent/SendMessage instructions.
- Added: a single-model statement (children inherit the session route; no per-child model
  selection), `subagent` per bounded assignment with a self-contained brief built from
  `~/.claude/agents/implementer.md`, `send_message` to return corrections to the same child,
  `spawn_teammate` for durable workers, `subagent_fork` for read-only research.
- Unchanged on purpose: plan resolution order, plan-readiness checks, branch preparation, the
  no-recursive-orchestrator rule, honest checklist discipline, and the changelog contract.
- One compatibility sentence notes the Claude Code equivalent (Agent tool with the `implementer`
  agent type, then SendMessage).

**`handoff/SKILL.md`** — wording made harness-neutral ("agent session" rather than "Claude Code
session"), with a new requirement that the handoff stand on its own for a reader in a different
harness. Paths, evidence rules and replace-don't-append semantics are unchanged.

**`factory/SKILL.md`** — mapped the factory loop onto DSH delegation.

- Removed the per-role model column (opus/sonnet) and the model labels in the loop diagram.
- Added a "Starting agents" section: `spawn_teammate` for the durable builder that gets resumed
  across review rounds, `subagent` for one-shot roles, four reviewer `subagent` calls issued in a
  single block for concurrency, and `send_message` in place of SendMessage.
- Every agent prompt now names the role file in `~/.claude/agents/` to read first, since named
  agent types do not exist in DSH.
- Unchanged: board.json schema, bootstrap, file layout, verdict rules, merge rules.

**`agents/implementer.md`** — body reworded for DSH (`read`/`write`/`edit`/`pwsh`/`grep`/`glob`,
no further delegation, no model choice), and the instruction line now points at `CLAUDE.md` or
`AGENTS.md`. The Claude-only `model: sonnet` frontmatter was left in place so Claude Code still
pins its model.

### Verification

- Mirror SHA256 parity across 88 skills: 0 mismatches.
- `implement` scan for `Sonnet|Opus|subagent_type|/model`: 0 hits.
- "Codex Opus" scan across the mirror: 0 hits.
- DSH catalog refreshed live twice without an app restart — `factory` appeared first, then the new
  `implement` and `handoff` descriptions.
- `~/.agents/AGENTS.md` is injected into this session as workspace instructions.
- Scheduled task manual trigger: `LastTaskResult 0`.

### Not run

- End-to-end `implement` delegation against a real approved plan (none was in scope here). The
  skill parses, loads and appears in the catalog with its new description; the delegation path
  itself is untested.

### Follow-ups

- Run a real `implement` job soon to exercise the subagent brief end to end.
- If the 10-minute scheduled mirror proves noisy, replace it with a post-`gstack-upgrade` hook.
- Consider a DSH agent preset for `implementer` later if per-role tools or models become worth it.
