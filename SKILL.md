---
name: task-router
description: Act as the planner, cost-aware adaptive multi-model router, and subagent coordinator for software tasks. Investigates read-only, resolves active models and rolling 7-day quota burn from model.json and local telemetry, prioritizes subscriptions (Codex/Claude) over paid API keys while offloading routine work to fast/open-weight models, presents a routing plan with a hard approval gate, and orchestrates implementation, cross-family review, frontend testing, and git integration.
---

# Task Router (`task-router`)

Act as the planner, cost-aware model router, and coordinator for the user's task. Follow the repository's `AGENTS.md` and relevant project instructions throughout.

---

## 0. Resolve the Active Model Pool & Quota Status (`model.json`)

Before assigning models to subagent roles, resolve the user's configured model pool and rolling 7-day quota burn:

1. Run the resolver script:
   ```fish
   node ~/.agents/skills/task-router/scripts/resolve-models.mjs
   ```
   Supported flags:
   - `--budget economy|balanced|performance` — override `budget.mode` from `model.json` (`economy` sorts every tier strictly by lowest $/M token cost and lowers workhorse reasoning to `low`/`medium`; `balanced` prioritizes subscriptions + workhorse coordinator; `performance` promotes `@frontier` models).
   - `--weekly-limit codex=45,claude=45` — override rolling 7-day equivalent USD quota caps. When a provider exceeds `autoDowngradeAbovePercent` (default `80%`), it is automatically marked `THROTTLED` and demoted behind unthrottled providers and cheap open-weight models.
   - `--harness codex|claude|opencode` — restrict to a single harness when cross-provider delegation is unavailable.
2. **Subscription vs API Protection:**
   - Direct `codex` (OpenAI subscription) and `claudeAgent` (Anthropic subscription) are always prioritized over paid API gateways.
   - `blockApiSubproviders: ["openai", "anthropic"]` blocks OpenCode's `openai/*` and `anthropic/*` API keys so Claude/OpenAI models never accidentally bill per-token over OpenCode.
3. **Why the Coordinator Should Be a `@workhorse` (`gpt-6.1-sol` or `claude-sonnet-5-5`), Not `gpt-6-astra`:**
   - A coordinator executes 40–100+ tool turns per task, re-reading its cached context on every turn.
   - `gpt-6-astra` burns **$1.00/M cached input** ($10/$50 in/out), whereas `gpt-6.1-sol` and `claude-sonnet-5-5` burn **$0.10/M cached input** ($2/$10 in/out) — **~8–10x lower quota burn** over a full task lifecycle.
   - Reserve `@frontier` (`gpt-6-astra`, `claude-opus-5-5`) strictly for bounded, short-lived subagent calls (independent code review or genuinely complex architectural/concurrency slices).

### Cost & Capability Tiers

| Tier | Typical Resolved Models | Cost Profile ($/M In / Out / Cache) | When to Assign |
| :--- | :--- | :--- | :--- |
| `@fast` | `codex:gpt-6-luna`, `claudeAgent:claude-haiku-5-5`, `cloudflare-workers-ai/@cf/zai-org/glm-5.3-flash`, `cloudflare-workers-ai/@cf/deepseek-ai/deepseek-v4-flash-0731`, `opencode/gemini-3.8-flash` | **$0.10–$0.44** / $0.50–$1.32 / **$0.01–$0.03** | First choice for read-only recon, file/doc/config checks, log scanning, and simple mechanical edits. |
| `@workhorse` (Budget / Open-Weight) | `cloudflare-workers-ai/@cf/deepseek-ai/deepseek-v4-pro-0813`, `cloudflare-workers-ai/@cf/zai-org/glm-5.3` | **$1.32–$1.40** / $3.96–$4.40 / **$0.044–$0.26** | Unit tests, boilerplate, data transforms, and secondary implementation slices to preserve OpenAI/Claude subscription quota. |
| `@workhorse` (Subscription) | `codex:gpt-6.1-sol`, `claudeAgent:claude-sonnet-5-5`, `opencode:google/gemini-4-argon` | **$2.00** / $10.00 / **$0.10** | Coordinator, primary feature/UI/Pug/SPA DOM implementation, browser testing (`NadaMini`), and final git integration. |
| `@frontier` | `claudeAgent:claude-opus-5-5` ($4/$20/$0.20), `codex:gpt-6-astra` ($10/$50/$1.00) | **$4.00–$10.00** / $20–$50 / **$0.20–$1.00** | Bounded complex backend/security/concurrency slices and adversarial code review. Prefer `claude-opus-5-5` (2.5x cheaper) over `gpt-6-astra` when both are active. |
| `@reviewer` | Cross-family `@frontier` or `@workhorse` at `high` reasoning | Bounded 1–3 turn review | Independent correctness and acceptance-criteria review from a **different model family** than the primary implementer. |

---

## 1. Investigate and Plan (Read-Only Gate)

Inspect the relevant implementation and trace the affected behavior. Keep this phase **strictly read-only**: no file changes, dependency installation, worktree creation, or implementation agents.

Run `node ~/.agents/skills/task-router/scripts/resolve-models.mjs` to inspect active models and 7-day rolling quota status. Ask focused questions when missing information materially affects the plan. Resolve routine choices using project conventions and your judgment.

Present one recommended plan covering:
- **Intended behavior and acceptance criteria** (enumerated as an explicit checklist so no item can be silently dropped).
- **Approach, design decisions, and affected components.**
- **Implementation steps, dependencies, and distinct file ownership.**
- **Cost-Optimized Model Routing Table** showing:
  - Current 7-day quota status and active budget mode (`balanced`, `economy`, or `performance`).
  - Each planned subagent role, its tier (`@fast`, `@workhorse`, `@frontier`, `@reviewer`), exact `providerInstanceId:model`, billing type (`subscription` vs `api`), reasoning level, and why that tier is sufficient (preferring `@fast` and budget `@workhorse` whenever frontier reasoning is unnecessary).
- **Validation, frontend testing, and potential complications.**

Ask for the user's approval and **STOP**. Wait for explicit approval in a later message. Revise the plan or model routing when requested; discussion alone does not authorize implementation.

---

## 2. Orchestrate After Approval

Proceed autonomously through the approved implementation and completion workflow in `AGENTS.md`, including worktree setup, review, testing, integration into `develop`, push, and cleanup.

Remain the coordinator:
- Offload narrow exploration/doc checks to `@fast` (`gpt-6-luna`, `claude-haiku-5-5`, `glm-5.3-flash`, `deepseek-v4-flash`) and boilerplate/test slices to budget `@workhorse` (`deepseek-v4-pro`, `glm-5.3`).
- Use subscription `@workhorse` (`gpt-6.1-sol` at `medium` or `claude-sonnet-5-5` at `medium`/`high`) for core implementation, UI/Pug/SPA incremental DOM updates, browser testing on `NadaMini`, and final integration.
- Reserve `@frontier` (`claude-opus-5-5` or `gpt-6-astra`) for bounded hard slices and cross-family `@reviewer` (`high` reasoning).
- Allow at most **five concurrent subagents**. Assign distinct file ownership and run dependent steps in order.
- Give every agent a **self-contained brief** with:
  1. Enumerated requirements and settled decisions.
  2. Constraints from `AGENTS.md`.
  3. Absolute worktree path and expected branch.
  4. Bounded file ownership, acceptance criteria, and validation duties.
- Explicitly set model and reasoning levels on every call. Report unavailable configurations before substituting.

---

## 3. Verify and Complete

Have the independent cross-family reviewer and frontend tester report findings against every enumerated checklist item. Have the implementer fix actionable issues and repeat affected checks. Ensure review and testing cover the final revision.

Follow `AGENTS.md` for `dbh` refreshes, merge/push verification, worktree cleanup, Streamient persistence, and applicable Managani changelog draft creation. Never publish or notify automatically.

Handle routine adjustments within approved scope. Obtain approval for material changes to scope or approved design decisions. Report concrete blockers and incomplete checks.

Finish concisely with:
- Implemented changes
- Models, billing type, and reasoning levels used per role
- Review and test results
- `develop` integration and push status
- Worktree cleanup status
- `dbh` readiness and testing URL
- Applicable changelog link
- Remaining blockers
