# task-router

Cost-aware, adaptive multi-model planning and subagent orchestration skill for **T3 Code**, **OpenCode**, **Codex**, and **Claude Code**.

`task-router` replaces hardcoded model names in planning prompts with a dynamic resolver (`scripts/resolve-models.mjs`) backed by `model.json` and your live local runtime settings:
1. **Resolves active models and gateways** from your live installations (`codex`, `claudeAgent`, `opencode`), skipping disabled T3 providers, hidden models, and unauthenticated gateways.
2. **Understands your monthly subscription plans (`openai=200, claude=100`)**, reads live server-reported quota % from Codex session logs, and **automatically spreads work across subscriptions** toward whichever provider has more remaining weekly headroom.
3. **Protects subscriptions over paid APIs** by prioritizing direct subscriptions (`codex`, `claudeAgent`) and blocking duplicate per-token API charges (`openai/*`, `anthropic/*` inside OpenCode).
4. **Generates Usage, Cost & Subscription ROI Reports (`--report`)** across T3 (`~/.t3/userdata/usage-scan-cache-v5.json`) and OpenCode (`~/.local/share/opencode/opencode.db`), including a **Plan Simulator** comparing `$200`, `$120 ($20+$100)`, `$40 ($20+$20)`, and pay-per-token Google API.

---

## Installation

Install or update globally across Claude Code, Codex, OpenCode, and T3 Code:

```fish
npx skills add thenitai/task-router -g -y -a claude-code codex opencode
```

Invoke in your agent:
- **T3 Code / OpenCode / Claude Code:** `/task-router <your task>`
- **Codex:** `$task-router <your task>`

---

## Setting Your Subscription Plans (`plans` & `--plan`)

Instead of guessing weekly token or dollar limits, you simply declare your monthly subscription tiers in `model.json` (or via `--plan`):

```json
"plans": {
  "openai": 200,
  "claude": 100
}
```

Or on the CLI:

```fish
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --plan openai=20,claude=100
```

### How Monthly Plans Map to Weekly Capacity & Load-Balancing

| Provider | Monthly Plan (`plans`) | Weekly API-Equivalent Capacity | How Usage % Is Calculated |
| :--- | :--- | :--- | :--- |
| **OpenAI (`codex`)** | `200` (Pro $200/mo)<br>`20` (Plus $20/mo) | **~$1,750 / week eq**<br>**~$175 / week eq** | Reads OpenAI's **live server-reported `used_percent`** directly from your latest Codex rollout log (`~/.codex/sessions/...`) when on Pro, or divides your rolling 7-day token cost by the plan's weekly capacity. |
| **Anthropic (`claude`)** | `200` (Max 20x $200/mo)<br>`100` (Max 5x $100/mo)<br>`20` (Pro $20/mo) | **~$1,500 / week eq**<br>**~$450 / week eq**<br>**~$90 / week eq** | Divides your rolling 7-day Claude token cost (`~/.t3/userdata/usage-scan-cache-v5.json`) by the plan's weekly capacity. |

When `"spreadAcrossSubscriptions": true` (default):
- If `codex` is at `44% used` and `claudeAgent` is at `5% used`, the router **automatically promotes `claudeAgent` (`claude-sonnet-5-5`) as Primary Implementer/Coordinator** and assigns `codex` (`gpt-6.1-sol`) to Secondary Parallel Slices until both subscriptions balance out.
- If either provider reaches `autoDowngradeAbovePercent` (default `80%`), it is marked `THROTTLED` and demoted behind your other subscription and cheap Cloudflare Workers AI models (`deepseek-v4-pro-0813`, `glm-5.3`).

---

## Pulling a Usage, Cost & Plan ROI Report (`--report`)

Run `--report` at any time to inspect your 7-day and all-time usage across every model (both subscription and paid OpenCode API) and see which subscription combination best fits your actual workload:

```fish
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --report
```

Example output:
```text
## Task-Router Usage, Cost & Subscription ROI Report

### 1. Per-Model Breakdown (Rolling 7 Days & All-Time)
| Provider | Model | Billing | 7d Turns (% Share) | 7d Tokens (In / Cache / Out) | 7d Cost / API-Eq (% Share) | All-Time Cost / Eq |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `codex` | `gpt-6-astra` | `subscription` | 4230 (53%) | 487.0M (8.8M / 477.2M / 1.04M) | $616.68 sub-eq (88%) | $733.13 |
| `codex` | `gpt-6.1-sol` | `subscription` | 3596 (45%) | 577.3M (7.6M / 568.3M / 1.39M) | $86.00 sub-eq (12%) | $89.26 |
| `opencode` | `google/gemini-3.8-flash` | `api` | 0 (0%) | 0.0M | $0.00 billed (0%) | $18.93 |

### 2. Subscription Plan Simulator (Based on Your Actual 7-Day Workload)
- Current 7d Codex burn (with Astra as Coordinator): $702.78/wk eq (Server-reported: 44% of $200 Pro weekly limit)
- Optimized 7d burn (replacing Astra Coordinator with `gpt-6.1-sol` / `claude-sonnet-5-5`): $161.71/wk eq (-77% quota burn for the exact same 1072M tokens!)
```

---

## Configuration Reference (`model.json`)

By default, the skill reads `model.json` in the skill folder (`~/.agents/skills/task-router/model.json`). To keep personal overrides that survive `npx skills` updates, place a file at **`~/.config/task-router/model.json`** (which takes precedence automatically).

### Full Default `model.json`

```json
{
  "defaults": {
    "latestGenerationOnly": true,
    "preferDirectProvider": true,
    "crossFamilyReview": true,
    "respectRuntimeSettings": true
  },
  "plans": {
    "openai": 200,
    "claude": 100
  },
  "budget": {
    "mode": "balanced",
    "coordinatorTier": "workhorse",
    "preferSubscriptionOverApi": true,
    "spreadAcrossSubscriptions": true,
    "blockApiSubproviders": ["openai", "anthropic"],
    "autoThrottle": true,
    "autoDowngradeAbovePercent": 80
  },
  "select": [
    "codex:all",

    "claude:all",
    "claude:!fable",

    "opencode:gemini-4*, gemini-3.8*, glm-5.3*, kimi-k3, deepseek-v4*"
  ],
  "reasoning": {
    "coordinator": "medium",
    "frontier": "high",
    "workhorse": "medium",
    "reviewer": "high",
    "fast": "medium"
  }
}
```

---

### 1. `plans` Settings & Examples

| Setting | Type | Default | Description & Example |
| :--- | :--- | :--- | :--- |
| `openai` | `number` (`20` \| `200`) | `200` | Monthly OpenAI subscription tier in USD (`200` for Pro, `20` for Plus). Automatically sets `codex` weekly capacity (`$1,750/wk eq` for `$200`, `$175/wk eq` for `$20`).<br>**Example:** `"openai": 20` |
| `claude` | `number` (`20` \| `100` \| `200`) | `100` | Monthly Anthropic Claude subscription tier in USD (`200` for Max 20x, `100` for Max 5x, `20` for Pro). Automatically sets `claudeAgent` weekly capacity (`$1,500/wk eq`, `$450/wk eq`, `$90/wk eq`).<br>**Example:** `"claude": 100` |

---

### 2. `defaults` Settings & Examples

| Setting | Type | Default | Description & Example |
| :--- | :--- | :--- | :--- |
| `latestGenerationOnly` | `boolean` | `true` | Automatically drops superseded model generations (`gpt-5.6-*`, `gpt-6-sol` when `gpt-6.1-sol` is present, `claude-opus-4-8`, `claude-opus-5` when `claude-opus-5-5` is present).<br>**Example:** Set `"latestGenerationOnly": false` to include legacy models. |
| `preferDirectProvider` | `boolean` | `true` | Deduplicates identical models across providers and gateways, preferring direct `codex` / `claudeAgent` first, then your T3 `favorites` and `modelOrder` (e.g., picking `cloudflare-workers-ai/@cf/zai-org/glm-5.3` over `opencode/glm-5.3-free`).<br>**Example:** `"preferDirectProvider": true` |
| `crossFamilyReview` | `boolean` | `true` | Ensures the independent `@reviewer` uses a **different model family** from the primary implementer whenever multiple families are active (e.g., `claude-opus-5-5` or `google/gemini-4-argon` reviewing `gpt-6.1-sol`).<br>**Example:** `"crossFamilyReview": true` |
| `respectRuntimeSettings` | `boolean` | `true` | Reads `~/.t3/userdata/settings.json` and `~/.local/share/opencode/auth.json` so disabled T3 providers (e.g., `claudeAgent.enabled: false`), `hiddenModels`, and unauthenticated OpenCode gateways (`github-copilot`, `amazon-bedrock`) are skipped automatically.<br>**Example:** Set `"respectRuntimeSettings": false` (or pass `--static`) to ignore local T3 state. |

---

### 3. `budget` Settings & Examples

| Setting | Type | Default | Description & Example |
| :--- | :--- | :--- | :--- |
| `mode` | `"balanced" \| "economy" \| "performance"` | `"balanced"` | Controls how models are ranked inside each tier:<br>• `"balanced"` — Subscription `@workhorse` (`gpt-6.1-sol` / `claude-sonnet-5-5`) as Coordinator & primary implementer; `@fast` & open-weight models for recon/boilerplate.<br>• `"economy"` — Sorts every tier strictly by lowest $/M token cost (`deepseek-v4-pro-0813` and `glm-5.3` first for workhorse; `gpt-6-luna` / `glm-5.3-flash` first for fast; lowers workhorse reasoning to `low`/`medium`).<br>• `"performance"` — Promotes `@frontier` (`claude-opus-5-5`, `gpt-6-astra`) to the top of coordinator and review pools.<br>**Example:** `"mode": "economy"` |
| `coordinatorTier` | `"workhorse" \| "frontier"` | `"workhorse"` | Selects the tier used for the main Coordinator session. Keeping this as `"workhorse"` (`gpt-6.1-sol` or `claude-sonnet-5-5`) saves **~8–10x cached-token burn** compared to running `gpt-6-astra` as Coordinator.<br>**Example:** `"coordinatorTier": "workhorse"` |
| `preferSubscriptionOverApi` | `boolean` | `true` | In `"balanced"` mode, ranks flat-rate `subscription` providers (`codex`, `claudeAgent`) ahead of per-token `api` gateways (`opencode`) within the same tier.<br>**Example:** `"preferSubscriptionOverApi": true` |
| `spreadAcrossSubscriptions` | `boolean` | `true` | Dynamically load-balances between `codex` and `claudeAgent` based on which subscription has lower 7-day % usage (when they differ by ≥10%).<br>**Example:** `"spreadAcrossSubscriptions": true` |
| `blockApiSubproviders` | `string[]` | `["openai", "anthropic"]` | Prevents OpenCode from routing through paid per-token API keys for vendors you already cover via direct subscriptions (`openai/*`, `anthropic/*`).<br>**Example:** `"blockApiSubproviders": ["openai", "anthropic"]` |
| `autoThrottle` | `boolean` | `true` | Automatically marks any provider whose 7-day rolling usage exceeds `autoDowngradeAbovePercent` as `THROTTLED` and shifts primary tasks to unthrottled subscriptions or cheap open-weight models.<br>**Example:** `"autoThrottle": true` |
| `weeklyLimitUsdEquivalent` | `Record<string, number \| string>` | *(Derived from `plans`)* | Optional custom override for weekly rolling 7-day capacity per provider, either in API-equivalent USD (`250` or `"$250"`) or raw tokens (`"300M"`).<br>**Example:** `{"codex": "300M", "claudeAgent": "400M"}` |
| `autoDowngradeAbovePercent` | `number` | `80` | Percentage of weekly capacity at which a provider is throttled.<br>**Example:** `"autoDowngradeAbovePercent": 80` |

---

### 4. `select` & `reasoning` Examples

```json
  "select": [
    "codex:all",
    "codex:!luna",
    "claude:all",
    "claude:!fable",
    "opencode:gemini-4*, gemini-3.8*, glm-5.3*, kimi-k3, deepseek-v4*"
  ],
  "reasoning": {
    "coordinator": "medium",
    "frontier": "high",
    "workhorse": "medium",
    "reviewer": "high",
    "fast": "medium"
  }
```

---

## CLI Usage & Flags (`scripts/resolve-models.mjs`)

```fish
# Default (reads model.json + live T3 settings, OpenCode auth, and 7d usage telemetry)
node ~/.agents/skills/task-router/scripts/resolve-models.mjs

# Show full 7-day & all-time Usage, Cost & Plan Simulator Report
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --report

# Simulate or apply specific monthly subscription plans ($20, $100, $200)
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --plan openai=20,claude=100

# Force Economy or Performance mode
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --budget economy
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --budget performance

# Override weekly limits by USD-equivalent or raw token count (M / k)
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --weekly-limit codex=150,claude=250
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --weekly-limit codex=300M,claude=400M

# Restrict to a single harness (standalone Codex or Claude Code)
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --harness codex
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --harness claude

# Ignore local T3/OpenCode runtime files and test static model.json rules only
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --static

# Output machine-readable JSON
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --json
```

---

## Running Tests

```fish
node --test tests/resolve-models.test.mjs
```
