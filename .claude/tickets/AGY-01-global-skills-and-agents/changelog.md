# Changelog — AGY-01: Global Skills, Subagents, and Rules Migration to Antigravity

## 2026-10-24 — `AGY-01-global-skills-and-agents`

**Summary:** Installed and adapted global rules (`AGENTS.md`), 10 custom subagents (`agents/*.md`), and 16 skills (`skills/*/SKILL.md`) into `C:\Users\Infplane\.gemini\config\`, preserving `C:\Users\Infplane\.claude\` untouched while keeping project-level `.claude/tickets/<ticket-name>/` and `.claude/temp/` as the shared source of truth.

### Files Created (`C:\Users\Infplane\.gemini\config\`)

- **`AGENTS.md`**: Global Antigravity rules enforcing `.claude/tickets/<ticket-name>/plan.md` (including in Plan mode), durable task artifacts (`handoff.md`, `changelog.md`) in `.claude/tickets/<ticket-name>/`, scratch files in `.claude/temp/`, and plan execution via the global `implement` skill.
- **`agents/` (10 custom subagents)**:
  - `implementer.md`: Bounded implementation worker subagent (`model: inherit`) reading `.claude/tickets/<ticket-name>/plan.md`, `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`, running verification, updating the plan checklist, and placing scratch files in `.claude/temp/`.
  - `handoff.md` & `resume-handoff.md`: Session handoff writer and read-only handoff verifier operating on `.claude/tickets/<ticket-name>/handoff.md` and `plan.md`.
  - `factory-spec-writer.md`, `factory-builder.md`, `factory-review-security.md`, `factory-review-ux.md`, `factory-review-ui.md`, `factory-review-code.md`, `factory-approver.md`: Factory stage subagents adapted to Antigravity frontmatter (`model: inherit`).
- **`skills/` (16 global skills)**:
  - `implement/SKILL.md`: Orchestrates on the active session model (no Opus nag), prepares the `<TICKET-ID>_<short-kebab-description>` branch, delegates bounded slices via `invoke_subagent(TypeName="implementer", Model="inherit")`, sends follow-ups via `send_message`, and writes `.claude/tickets/<ticket-name>/changelog.md`.
  - `handoff/SKILL.md` & `resume-handoff/SKILL.md`: Session handoff creation and read-only verification workflows.
  - `factory/SKILL.md` & `factory/dashboard.html`: Software factory orchestrator adapted to `invoke_subagent` and `send_message`.
  - `humanizer/SKILL.md` & `frontend-design/SKILL.md` (+ `LICENSE.txt`): Writing and UI design guidance skills.
  - `taste-skill/` & `taste-skill-v1/`: Anti-slop frontend skills with frontmatter `name` aligned to folder names (`taste-skill`, `taste-skill-v1`).
  - `design-system/`, `ui-styling/`, `ui-ux-pro-max/`, `design/`: Full skill trees (`data/`, `references/`, `scripts/`, `templates/`, `canvas-fonts/`) with `~/.gemini/config/skills/ui-ux-pro-max/scripts/search.py` path updates and `ask_question` tool mapping.
  - `design-html/`, `design-review/`, `design-shotgun/`, `design-consultation/` (+ `sections/`): Cleaned of ~750 lines of Claude-only `gstack` telemetry/preamble boilerplate and adapted to Antigravity's `ask_question`, `search_web`, and `invoke_subagent` tools while keeping `gstack` binary resolution intact.

### Verification

- **Passed:** Python validation script verified all 16 `skills/<name>/SKILL.md` files (frontmatter syntax, `name` == directory name, non-empty `description`), all 10 `agents/<name>.md` files (frontmatter syntax, `name` == file stem, `model: inherit`, non-empty `description`), and `AGENTS.md`.
- **Note:** Start a new Antigravity conversation (or restart the app/CLI) so startup discovery registers the newly created `~/.gemini/config/agents/` and `~/.gemini/config/skills/` entries in `/skills` and `/agents`.
