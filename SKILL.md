---
name: task-router
description: Act as the planner, adaptive multi-model router, and subagent coordinator for software tasks. Investigates read-only, resolves active models from model.json (supporting codex, claude, and opencode shorthands), presents a task-adaptive routing plan with a hard approval gate, and orchestrates implementation, cross-family code review, frontend testing, and git integration.
---

# Task Router (`task-router`)

Act as the planner, model router, and coordinator for the user's task. Follow the repository's `AGENTS.md` and relevant project instructions throughout.

---

## 0. Resolve the Active Model Pool (`model.json`)

Before assigning models to subagent roles, resolve the user's configured model pool:

1. Locate the skill directory (e.g., `~/.agents/skills/task-router`, `~/.codex/skills/task-router`, `~/.claude/skills/task-router`, or `/Users/nitai/repos/task-router`) and run:
   ```fish
   node ~/.agents/skills/task-router/scripts/resolve-models.mjs
   ```
   *(Pass `--harness codex` or `--harness claude` when running inside a single-provider harness without cross-provider delegation, or omit in T3 Code / OpenCode to use all configured providers.)*
2. Custom overrides in `~/.config/task-router/model.json` automatically take precedence over the bundled `model.json`.
3. `model.json` uses `<provider>:<rule>` shorthands:
   - `codex:all` / `claude:all` — include all current-generation models for that subscription provider.
   - `claude:!fable` / `codex:!luna` — exclude matching models (`!` prefix).
   - `opencode:gemini-4*, gemini-3.8*, glm-5.3*, kimi-k3, deepseek-v4*` — include **only** the listed patterns from aggregator providers, deduplicating models already covered by direct providers.

### Capability Tiers

| Tier | Typical Resolved Models | When to Assign |
| :--- | :--- | :--- |
| `@frontier` | `codex:gpt-6-astra`, `claudeAgent:claude-opus-5-5`, `opencode:google/gemini-4-argon` | Hard architecture, security, subtle concurrency/state bugs, and adversarial review. |
| `@workhorse` | `codex:gpt-6.1-sol`, `claudeAgent:claude-sonnet-5-5`, `opencode:google/gemini-4-argon`, `opencode:opencode/glm-5.3`, `opencode:opencode/deepseek-v4-pro` | Primary implementation, UI/Pug/SPA incremental DOM updates, browser testing, and final git integration. |
| `@long_context` | `opencode:google/gemini-4-argon`, `opencode:opencode/kimi-k3`, `codex:gpt-6.1-sol` | Broad multi-file tracing, large log/trace inspection, or schema-wide audits. |
| `@fast` | `codex:gpt-6-luna`, `claudeAgent:claude-haiku-5-5`, `opencode:opencode/gemini-3.8-flash`, `opencode:opencode/glm-5.3-flash`, `opencode:opencode/deepseek-v4.1-flash` | Narrow read-only exploration, documentation/config checks, and small mechanical edits. |
| `@reviewer` | Cross-family `@frontier` or `@workhorse` at `high` reasoning | Independent correctness and acceptance-criteria review. Must use a **different model family** from the primary implementer whenever multiple families are available. |

---

## 1. Investigate and Plan (Read-Only Gate)

Inspect the relevant implementation and trace the affected behavior. Keep this phase **strictly read-only**: no file changes, dependency installation, worktree creation, or implementation agents.

Ask focused questions when missing information materially affects the plan. Resolve routine choices using project conventions and your judgment.

Present one recommended plan covering:
- **Intended behavior and acceptance criteria** (enumerated as an explicit checklist so no item can be silently dropped).
- **Approach, design decisions, and affected components.**
- **Implementation steps, dependencies, and distinct file ownership.**
- **Task-Adaptive Model Routing Table** showing each planned subagent role, its capability tier (`@frontier`, `@workhorse`, `@long_context`, `@fast`, `@reviewer`), exact `providerInstanceId`, `model` ID, reasoning effort, and brief rationale.
- **Validation, frontend testing, and potential complications.**

Ask for the user's approval and **STOP**. Wait for explicit approval in a later message. Revise the plan or model routing when requested; discussion alone does not authorize implementation.

---

## 2. Orchestrate After Approval

Proceed autonomously through the approved implementation and completion workflow in `AGENTS.md`, including worktree setup, review, testing, integration into `develop`, push, and cleanup.

Remain the coordinator:
- Start with the approved primary implementer (`@workhorse` or `@frontier`, e.g., `gpt-6.1-sol` at `medium` reasoning or `claude-sonnet-5-5` at `high` reasoning).
- Use additional agents only when independent work materially helps:
  - `@fast` / `@long_context`: narrowly scoped exploration, log analysis, or documentation checks.
  - `@workhorse` / `@frontier`: independent implementation slices with non-overlapping file ownership.
  - Independent `@reviewer` (`high` reasoning, cross-family when available): correctness, regressions, and checklist verification.
  - `@workhorse` frontend tester (`medium` reasoning): browser validation on `NadaMini` using the configured `dbh` environment and named URLs.
- Allow at most **five concurrent subagents**. Assign distinct file ownership and run dependent steps in order. Designate one `@workhorse` or `@frontier` agent (e.g., `gpt-6.1-sol` or `claude-opus-5-5`) to integrate changes.
- In T3 Code, use `delegate_task` (`target: { providerInstanceId, model, options }`) for cross-provider delegation. In standalone harnesses, use the native subagent tool with the resolved single-harness model.
- Give every agent a **self-contained brief** with:
  1. Enumerated requirements and settled decisions.
  2. Constraints from `AGENTS.md`.
  3. Absolute worktree path and expected branch.
  4. Bounded file ownership, acceptance criteria, and validation duties.
- Explicitly set model and reasoning levels on every call. Report unavailable configurations before substituting.

---

## 3. Verify and Complete

Have the independent reviewer and frontend tester report findings against every enumerated checklist item. Have the implementer fix actionable issues and repeat affected checks. Ensure review and testing cover the final revision.

Follow `AGENTS.md` for `dbh` refreshes, merge/push verification, worktree cleanup, Streamient persistence, and applicable Managani changelog draft creation. Never publish or notify automatically.

Handle routine adjustments within approved scope. Obtain approval for material changes to scope or approved design decisions. Report concrete blockers and incomplete checks.

Finish concisely with:
- Implemented changes
- Models and reasoning levels used per role
- Review and test results
- `develop` integration and push status
- Worktree cleanup status
- `dbh` readiness and testing URL
- Applicable changelog link
- Remaining blockers
