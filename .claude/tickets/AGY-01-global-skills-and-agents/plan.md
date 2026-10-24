# AGY-01: Adapt `.claude` Global Rules, Skills, and Agents to Antigravity (`~/.gemini/config`)

## Goal & Scope

Keep `C:\Users\Infplane\.claude\` untouched for Claude Code, and install Antigravity-adapted global rules, skills (16 total), and custom subagents (10 total) into `C:\Users\Infplane\.gemini\config\`, while continuing to use project-local `.claude/tickets/<ticket-name>/` and `.claude/temp/` across all workspaces.

### Key Decisions (Agreed with User)
1. **Separation of Global Configs, Shared `.claude/` Workspace Folder**:
   - Leave `C:\Users\Infplane\.claude\` untouched so Claude Code continues working identically.
   - Install Antigravity-adapted global rules, skills, and subagents under `C:\Users\Infplane\.gemini\config\`.
   - Continue storing durable project task artifacts in `<workspace>/.claude/tickets/<ticket-name>/` (`plan.md`, `handoff.md`, `changelog.md`) and scratch/temporary files in `<workspace>/.claude/temp/` as the single source of truth across both Claude Code and Antigravity.
2. **Model & Subagent Adaptation for `implement`, `implementer`, `handoff`, `resume-handoff`, and `factory`**:
   - Orchestrator (`implement` / `factory`) uses the active session model without nagging to switch to Claude Opus.
   - Subagents are invoked via Antigravity's native `invoke_subagent` tool (`TypeName`, `Role`, `Prompt`, `Model: "inherit"` or `"pro"`) and resumed/messaged via `send_message` (`Recipient: "<conversationId>"`, `Message: "..."`).
   - Take advantage of Antigravity's reactive subagent wakeup (no polling loops needed).
3. **Plan Mode Behavior**:
   - In Plan mode or whenever creating/updating a plan, always write and update `<workspace>/.claude/tickets/<ticket-name>/plan.md` as the authoritative source of truth, and place all temporary/scratch files in `<workspace>/.claude/temp/`.
4. **Scope of Skills & Agents**:
   - **Global Rules**: `C:\Users\Infplane\.gemini\config\AGENTS.md` (adapted from `C:\Users\Infplane\.claude\CLAUDE.md`).
   - **10 Global Subagents** (`C:\Users\Infplane\.gemini\config\agents\*.md`):
     - `implementer.md`
     - `handoff.md`
     - `resume-handoff.md`
     - `factory-spec-writer.md`
     - `factory-builder.md`
     - `factory-review-security.md`
     - `factory-review-ux.md`
     - `factory-review-ui.md`
     - `factory-review-code.md`
     - `factory-approver.md`
   - **16 Global Skills** (`C:\Users\Infplane\.gemini\config\skills\<name>\`):
     - Core workflow skills: `implement`, `handoff`, `resume-handoff`, `factory`
     - Writing & UI/UX/Design skills: `humanizer`, `frontend-design`, `taste-skill`, `taste-skill-v1`, `design-html`, `design-review`, `design-shotgun`, `design-system`, `ui-styling`, `ui-ux-pro-max`, `design`, `design-consultation`

---

## Implementation Checklist

Verified 2026-10-24: All 16 skills, 10 subagents, and `AGENTS.md` validated in `C:\Users\Infplane\.gemini\config\`.

- [x] **Step 1: Global Rules (`C:\Users\Infplane\.gemini\config\AGENTS.md`)**
  - Created `C:\Users\Infplane\.gemini\config\AGENTS.md` adapted from `C:\Users\Infplane\.claude\CLAUDE.md`:
    - **Plan Files**: Always save and revise plans at `<workspace>/.claude/tickets/<ticket-name>/plan.md` as the single source of truth (even in Plan mode). Keep durable task artifacts (`plan.md`, `handoff.md`, `changelog.md`, and related notes) in the same `.claude/tickets/<ticket-name>/` directory.
    - **Temporary Files**: Put all temporary, scratch, staging, and intermediate files created by the main agent or subagents under `<workspace>/.claude/temp/`.
    - **Plan Implementation**: When implementing an existing plan, always invoke the global `implement` skill (`C:\Users\Infplane\.gemini\config\skills\implement\SKILL.md`) and follow its workflow for branch setup, `implementer` subagent delegation, verification, and `changelog.md` generation.

- [x] **Step 2: Core Workflow Subagents (`C:\Users\Infplane\.gemini\config\agents\`)**
  - Created `C:\Users\Infplane\.gemini\config\agents\` and adapted the 10 subagents from `C:\Users\Infplane\.claude\agents\`:
    - Converted YAML frontmatter to Antigravity's native subagent schema (`name`, `description`, `model: inherit`).
    - Adapted `implementer.md`, `handoff.md`, `resume-handoff.md`, and all 7 `factory-*.md` subagents (`factory-spec-writer.md`, `factory-builder.md`, `factory-review-security.md`, `factory-review-ux.md`, `factory-review-ui.md`, `factory-review-code.md`, `factory-approver.md`).

- [x] **Step 3: Core Workflow Skills (`implement`, `handoff`, `resume-handoff`, `factory`)**
  - Created `C:\Users\Infplane\.gemini\config\skills\implement\SKILL.md`, `handoff\SKILL.md`, `resume-handoff\SKILL.md`, and `factory\SKILL.md` (+ `dashboard.html`), adapted to Antigravity's `invoke_subagent` and `send_message` tools and active session model orchestration.

- [x] **Step 4: Adapt & Install the 12 Design, UI/UX, and Writing Skills (`C:\Users\Infplane\.gemini\config\skills\`)**
  - Installed and adapted `humanizer`, `frontend-design`, `taste-skill`, `taste-skill-v1`, `design-system`, `ui-styling`, `ui-ux-pro-max`, `design`, `design-html`, `design-review`, `design-shotgun`, and `design-consultation`.

- [x] **Step 5: Verification**
  - Verified all 16 skills exist under `C:\Users\Infplane\.gemini\config\skills\<name>\SKILL.md` with valid YAML frontmatter (`name` matching folder name, non-empty `description`).
  - Verified all 10 agents exist under `C:\Users\Infplane\.gemini\config\agents\<name>.md` with valid YAML frontmatter (`name`, `description`, `model: inherit`).
  - Verified `C:\Users\Infplane\.gemini\config\AGENTS.md` exists and `C:\Users\Infplane\.claude\` remains untouched.
