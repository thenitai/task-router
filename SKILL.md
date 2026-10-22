---
name: task-router
description: Act as the planner, cost-aware adaptive multi-model router, and subagent coordinator for software tasks. Investigates read-only, resolves active models, subscription plans (default openai=20, claude=20), and rolling 7-day quota burn from model.json and local telemetry, load-balances across subscriptions while offloading routine work to fast/open-weight models, presents a routing plan with a hard approval gate, and orchestrates implementation, independent review within the allowed provider pool, frontend testing, and git integration.
---

# Task Router (`task-router`)

Act as the planner, cost-aware model router, and coordinator for the user's task. Follow the repository's `AGENTS.md` and relevant project instructions throughout.

---

## 0. Resolve the Active Model Pool, Subscription Plans & Quota Status (`model.json`)

Before assigning models to subagent roles, resolve the user's configured model pool and 7-day subscription headroom:

Configuration loads bundled `model.json` defaults and merges one personal override. A file at `~/.config/task-router/user.json` can contain only `{"plans":{"openai":200}}`; omitted values inherit defaults (both plans default to $20; set `claude: 0` for no subscription). Nested objects merge; arrays and scalar values replace. Select the first existing override from `~/.config/task-router/user.json`, `~/.codex/task-router/user.json`, then legacy `~/.config/task-router/{model,models}.json` and `~/.codex/task-router/{model,models}.json`, in that order. The `models` array replaces the default provider patterns (OpenCode defaults to `glm-5.3*` and `deepseek-v4*`); legacy `select` is accepted when `models` is absent. `--config <path>` selects an override instead; CLI flags win. Do not edit bundled defaults for personal settings.

1. Determine the allowed harnesses from the current host and the user's restrictions **before** resolving models:
   - **Standalone Codex:** always pass `--harness codex`. Every role, including reviewer, must use direct Codex/OpenAI models.
   - **Standalone Claude Code:** always pass `--harness claude`. Every role, including reviewer, must use direct Claude/Anthropic models.
   - **T3 Code or another host with cross-provider delegation:** use the available delegated provider pool unless the user restricts it. Explicit “Codex only” / “OpenAI only” means `--harness codex`; “Claude only” / “Anthropic only” means `--harness claude`, even in T3 Code.
   - Installed providers, subscriptions, local T3 settings, and model examples below do not grant permission to leave that pool. Do not infer the host from the coordinator's model alone: T3 can run a Codex or Claude coordinator.

   Run the resolver with that restriction and retain it on **every** subsequent resolver call. For example, in standalone Codex:
   ```fish
   node ~/.agents/skills/task-router/scripts/resolve-models.mjs --harness codex
   ```
   In standalone Claude Code, replace `codex` with `claude`. Omit `--harness` only when the host supports cross-provider delegation and the user has not restricted providers.

   Treat the resulting pool as a hard boundary for all roles, substitutions, quota throttling, and budget modes. Cross-family review is a preference **within** that pool, never a reason to add DeepSeek or another excluded provider. With one family, use an independent same-family reviewer (prefer a different model when available). If the allowed pool is empty or cannot support a role, report the blocker; do not expand it automatically.
   Supported flags:
   - `--plan openai=200,claude=100` (or `openai=20,claude=100`) — set monthly subscription plan tiers (`$20`, `$100`, `$200`). Automatically maps each plan to its empirical weekly capacity (`$200` OpenAI Pro ≈ `$1750/wk eq`, `$20` OpenAI Plus ≈ `$175/wk eq`, `$200` Claude Max ≈ `$1500/wk eq`, `$100` Claude Max ≈ `$450/wk eq`, `$20` Claude Pro ≈ `$90/wk eq`), reads OpenAI's live server-reported `used_percent` from Codex session files, and **load-balances (`spreadAcrossSubscriptions: true`) toward whichever subscription has more remaining headroom**.
   - `--config <path>` — merge the selected JSON override over bundled defaults; report missing or invalid files.
   - `--throttle` — enforce quota-based throttling even when credits remain. Explicit custom caps also take precedence over credits.
   - `--report` — generate a full **Usage, Cost & Subscription ROI Report** across T3 (`usage-scan-cache-v5.json`) and OpenCode (`opencode.db`), including a Plan Simulator comparing `$200`, `$120 ($20+$100)`, `$40 ($20+$20)`, and pay-per-token Google API.
   - `--budget economy|balanced|performance` — override `budget.mode` (`economy` ranks cheapest $/M models first; `balanced` prioritizes subscriptions + workhorse coordinator; `performance` promotes `@frontier`).
   - `--weekly-limit codex=150,claude=250` (or `codex=300M`) — custom weekly cap override in API-equivalent USD or raw token count (`M`/`k`).
   - `--harness codex|claude|opencode` — hard restriction for every role; mandatory in standalone Codex/Claude Code and whenever the user requests provider-only routing.
2. **Subscription vs API Protection:**
   - Direct `codex` (OpenAI subscription) and `claudeAgent` (Anthropic subscription) are always prioritized over paid API gateways.
   - `blockApiSubproviders: ["openai", "anthropic"]` blocks OpenCode's `openai/*` and `anthropic/*` API keys so Claude/OpenAI models never accidentally bill per-token over OpenCode.
3. **Why the Coordinator Must Be a Subscription `@workhorse` (`gpt-6.1-sol` or `claude-sonnet-5-5`), Not `gpt-6-astra` or a Pay-Per-Token API:**
   - A coordinator executes 40–100+ tool turns per task (~1B cached tokens/week across tasks).
   - `gpt-6-astra` burns **$1.00/M cached input** ($10/$50 in/out), whereas `gpt-6.1-sol` and `claude-sonnet-5-5` burn **$0.10/M cached input** ($2/$10 in/out) — **~8–10x lower quota burn** over a full task lifecycle.
   - Running 1B cached tokens/week on a pay-per-token API (such as `google/gemini-4-argon` at $0.10/M cache) would bill **~$160/week (~$700/month)** in cash, whereas flat-rate subscriptions (`codex` + `claudeAgent`) absorb high-turn coordinator cache reads at fixed monthly cost.

### Cost & Capability Tiers

| Tier | Typical Resolved Models | Cost Profile ($/M In / Out / Cache) | When to Assign |
| :--- | :--- | :--- | :--- |
| `@fast` | `codex:gpt-6-luna`, `claudeAgent:claude-haiku-5-5`, `cloudflare-workers-ai/@cf/zai-org/glm-5.3-flash`, `cloudflare-workers-ai/@cf/deepseek-ai/deepseek-v4-flash-0731`, `opencode/gemini-3.8-flash` | **$0.10–$0.44** / $0.50–$1.32 / **$0.01–$0.03** | First choice for read-only recon, file/doc/config checks, log scanning, and simple mechanical edits. |
| `@workhorse` (Budget / Open-Weight) | `cloudflare-workers-ai/@cf/deepseek-ai/deepseek-v4-pro-0813`, `cloudflare-workers-ai/@cf/zai-org/glm-5.3` | **$1.32–$1.40** / $3.96–$4.40 / **$0.044–$0.26** | Unit tests, boilerplate, data transforms, and secondary implementation slices to preserve OpenAI/Claude subscription quota. |
| `@workhorse` (Subscription) | `codex:gpt-6.1-sol`, `claudeAgent:claude-sonnet-5-5` | **$2.00** / $10.00 / **$0.10** | Coordinator, primary feature/UI/Pug/SPA DOM implementation, browser testing (`NadaMini`), and final git integration. |
| `@frontier` | `claudeAgent:claude-opus-5-5` ($4/$20/$0.20), `codex:gpt-6-astra` ($10/$50/$1.00), `opencode:google/gemini-4-argon` ($2/$10/$0.10) | **$2.00–$10.00** / $10–$50 / **$0.10–$1.00** | Bounded complex backend/security/concurrency slices and adversarial code review. |
| `@reviewer` | Independent `@frontier` or `@workhorse` at `high` reasoning | Bounded 1–3 turn review | Independent correctness and acceptance-criteria review within the allowed pool; prefer a different family only when available. |

---

## 1. Investigate and Plan (Read-Only Gate)

Inspect the relevant implementation and trace the affected behavior. Keep this phase **strictly read-only**: no file changes, dependency installation, worktree creation, or implementation agents.

Run the resolver with the required harness restriction from section 0 to inspect active models and 7-day subscription headroom. Ask focused questions when missing information materially affects the plan. Resolve routine choices using project conventions and your judgment.

Present one recommended plan covering:
- **Intended behavior and acceptance criteria** (enumerated as an explicit checklist so no item can be silently dropped).
- **Approach, design decisions, and affected components.**
- **Implementation steps, dependencies, and distinct file ownership.**
- **Cost-Optimized Model Routing Table** showing:
  - Subscription status and active budget mode. A plan of `0` means **No subscription**; a configured but disabled provider means **Provider disabled**. Report valid weekly quota as **X% used / Y% remaining**, including observation time, window duration, reset time, and source. Report credits separately, preserving zero versus unknown, with the telemetry observation time and source. `hasCreditHeadroom: true` means valid current telemetry reports positive credits, `has_credits: true`, and no restriction: do not demote that provider for its included quota percentage; use normal model/cost ranking. Explicit custom caps and `--throttle` still apply. Credits are not a reset buffer or a subscription percentage. Missing or expired quota is **usage unknown**. Never present local API-equivalent estimates as provider-reported quota or infer zero usage from missing telemetry.
  - Each planned subagent role, its tier (`@fast`, `@workhorse`, `@frontier`, `@reviewer`), exact `providerInstanceId:model`, billing type (`subscription` vs `api`), reasoning level, and why that tier is sufficient.
- **Validation, frontend testing, and potential complications.**

Ask for the user's approval and **STOP**. Wait for explicit approval in a later message. Revise the plan or model routing when requested; discussion alone does not authorize implementation.

---

## 2. Orchestrate After Approval

Proceed autonomously through the approved implementation and completion workflow in `AGENTS.md`, including worktree setup, review, testing, integration into `develop`, push, and cleanup.

Remain the coordinator. Assign every role only from the restricted resolved pool; the model examples below apply only when included in that pool:
- Offload narrow exploration/doc checks to `@fast` (`gpt-6-luna`, `claude-haiku-5-5`, `glm-5.3-flash`, `deepseek-v4-flash`) and boilerplate/test slices to budget `@workhorse` (`deepseek-v4-pro`, `glm-5.3`).
- Use subscription `@workhorse` (`gpt-6.1-sol` or `claude-sonnet-5-5`, automatically preferring whichever subscription has more remaining headroom) for core implementation, UI/Pug/SPA incremental DOM updates, browser testing on `NadaMini`, and final integration.
- Reserve `@frontier` (`claude-opus-5-5`, `gpt-6-astra`, or `google/gemini-4-argon`) for bounded hard slices and independent `@reviewer` (`high` reasoning).
- Allow at most **five concurrent subagents**. Assign distinct file ownership and run dependent steps in order.
- Give every agent a **self-contained brief** with:
  1. Enumerated requirements and settled decisions.
  2. Constraints from `AGENTS.md`.
  3. Absolute worktree path and expected branch.
  4. Bounded file ownership, acceptance criteria, and validation duties.
- Explicitly set model and reasoning levels on every call. Report unavailable configurations before substituting.

---

## 3. Verify and Complete

Have the independent reviewer (same-family when the allowed pool has only one family) and frontend tester report findings against every enumerated checklist item. Have the implementer fix actionable issues and repeat affected checks. Ensure review and testing cover the final revision.

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
