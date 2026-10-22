# task-router

Cost-aware, adaptive multi-model planning and subagent orchestration skill for **T3 Code**, **OpenCode**, **Codex**, and **Claude Code**.

`task-router` replaces hardcoded model names in planning prompts with a dynamic resolver (`scripts/resolve-models.mjs`) backed by `model.json` and your live local runtime settings:
1. **Resolves active models and gateways** from your live installations (`codex`, `claudeAgent`, `opencode`), skipping disabled T3 providers, hidden models, and unauthenticated gateways.
2. **Understands your monthly subscription plans (default `openai=20, claude=20`)**, reads live server-reported quota % from Codex session logs, and **automatically spreads work across subscriptions** toward whichever provider has more remaining weekly headroom.
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

Set a provider's plan to `0` (for example, `"claude": 0` or `--plan claude=0`) to declare **No subscription** and exclude its subscription models. A configured subscription with a disabled runtime provider is reported separately as **Provider disabled**.

Quota output includes used/remaining percentages, a separate credit balance, observation time, weekly window duration, reset time, and source file. Valid current Codex telemetry with `has_credits: true`, a positive balance, and no reported restriction bypasses quota-based throttling and percentage balancing. Normal model/cost ranking still applies. Explicit custom caps and `--throttle` take precedence. Missing credit balances show as unknown; a reported zero stays zero. Credits are not converted into a subscription percentage. The resolver compares event timestamps across session and archive files; missing or expired weekly readings remain unknown. Estimated local costs do not drive subscription headroom balancing or throttling. Explicit custom caps still use local usage for throttling.

## Setting Your Subscription Plans (`plans` & `--plan`)

Instead of guessing weekly token or dollar limits, you simply declare your monthly subscription tiers in `~/.config/task-router/user.json` (or via `--plan`):

```json
{
  "plans": {
    "openai": 20,
    "claude": 20
  }
}
```

Or on the CLI:

```fish
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --plan openai=20,claude=100
```

### How Monthly Plans Map to Weekly Capacity & Load-Balancing

| Provider | Monthly Plan (`plans`) | Weekly API-Equivalent Capacity | How Usage % Is Calculated |
| :--- | :--- | :--- | :--- |
| **OpenAI (`codex`)** | `200` (Pro $200/mo)<br>`20` (Plus $20/mo) | **~$1,750 / week eq**<br>**~$175 / week eq** | Reads OpenAI's **live server-reported `used_percent`** directly from your latest Codex rollout log (`~/.codex/sessions/...`) for the explicitly identified weekly window, regardless of configured plan price. Missing or expired readings show **usage unknown**. |
| **Anthropic (`claude`)** | `200` (Max 20x $200/mo)<br>`100` (Max 5x $100/mo)<br>`20` (Pro $20/mo) | **~$1,500 / week eq**<br>**~$450 / week eq**<br>**~$90 / week eq** | Reports **usage unknown** without provider quota telemetry. Local token costs are API-equivalent estimates, not subscription usage. |

When `"spreadAcrossSubscriptions": true` (default):
- When neither provider has usable credit headroom and both have reported quota readings, if `codex` is at `44% used` and `claudeAgent` is at `5% used`, the router **automatically promotes `claudeAgent` (`claude-sonnet-5-5`) as Primary Implementer/Coordinator** and assigns `codex` (`gpt-6.1-sol`) to Secondary Parallel Slices until both subscriptions balance out.
- If a provider reaches `autoDowngradeAbovePercent` (default `80%`) without usable credit headroom, it can be marked `THROTTLED` and demoted behind your other subscription and cheap Cloudflare Workers AI models (`deepseek-v4-pro-0813`, `glm-5.3`).

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

The skill always loads bundled `model.json` as defaults, then merges one optional personal override. Keep only your changes in **`~/.config/task-router/user.json`**, outside the installed skill so updates preserve them:

```json
{"plans":{"openai":200}}
```

Omitted settings inherit the bundled defaults, including both $20 plans. Set `"claude": 0` explicitly if you have no Claude subscription. Nested objects merge; arrays (including `models`) and scalar values replace the corresponding default. An empty array clears a default list.

Create the directory with `mkdir -p ~/.config/task-router`, then save your overrides as `user.json`. The example above changes only OpenAI to $200; Claude stays at $20. To change model rules, add a `"models"` array using the same provider patterns as the defaults below; the array replaces the entire default list.

The first existing personal file wins, in this order: `~/.config/task-router/user.json`, `~/.codex/task-router/user.json`, `~/.config/task-router/model.json`, `~/.config/task-router/models.json`, `~/.codex/task-router/model.json`, `~/.codex/task-router/models.json`. Lower-priority files are not merged. `--config /path/to/file.json` selects that override instead of autodiscovery; CLI flags apply last. Missing explicit files and invalid JSON produce an error that names the file. Existing personal `model.json`/`models.json` files and the legacy `select` key remain supported. Within a file, `models` takes precedence over `select`. A legacy bundled `models.json` is supported when bundled `model.json` is absent.

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
    "openai": 20,
    "claude": 20
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
  "models": [
    "codex:all",

    "claude:all",
    "claude:!fable",

    "opencode:glm-5.3*"
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
| `openai` | `number` (`20` \| `200`) | `20` | Monthly OpenAI subscription tier in USD (`200` for Pro, `20` for Plus). Automatically sets `codex` weekly capacity (`$1,750/wk eq` for `$200`, `$175/wk eq` for `$20`).<br>**Example:** `"openai": 20` |
| `claude` | `number` (`20` \| `100` \| `200`) | `20` | Monthly Anthropic Claude subscription tier in USD (`200` for Max 20x, `100` for Max 5x, `20` for Pro). Automatically sets `claudeAgent` weekly capacity (`$1,500/wk eq`, `$450/wk eq`, `$90/wk eq`).<br>**Example:** `"claude": 20` |

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
| `mode` | `"balanced" \| "economy" \| "performance"` | `"balanced"` | Controls how models are ranked inside each tier:<br>• `"balanced"` — Subscription `@workhorse` (`gpt-6.1-sol` / `claude-sonnet-5-5`) as Coordinator & primary implementer; `@fast` & open-weight models for recon/boilerplate.<br>• `"economy"` — Sorts every tier strictly by lowest $/M token cost (only configured models participate; `gpt-6-luna` / `glm-5.3-flash` first for fast; lowers workhorse reasoning to `low`/`medium`).<br>• `"performance"` — Promotes `@frontier` (`claude-opus-5-5`, `gpt-6-astra`) to the top of coordinator and review pools.<br>**Example:** `"mode": "economy"` |
| `coordinatorTier` | `"workhorse" \| "frontier"` | `"workhorse"` | Selects the tier used for the main Coordinator session. Keeping this as `"workhorse"` (`gpt-6.1-sol` or `claude-sonnet-5-5`) saves **~8–10x cached-token burn** compared to running `gpt-6-astra` as Coordinator.<br>**Example:** `"coordinatorTier": "workhorse"` |
| `preferSubscriptionOverApi` | `boolean` | `true` | In `"balanced"` mode, ranks flat-rate `subscription` providers (`codex`, `claudeAgent`) ahead of per-token `api` gateways (`opencode`) within the same tier.<br>**Example:** `"preferSubscriptionOverApi": true` |
| `spreadAcrossSubscriptions` | `boolean` | `true` | Dynamically load-balances between `codex` and `claudeAgent` based on which subscription has lower reported weekly % usage (when they differ by ≥10%). Percentage balancing is skipped when either provider has usable credit headroom.<br>**Example:** `"spreadAcrossSubscriptions": true` |
| `blockApiSubproviders` | `string[]` | `["openai", "anthropic"]` | Prevents OpenCode from routing through paid per-token API keys for vendors you already cover via direct subscriptions (`openai/*`, `anthropic/*`).<br>**Example:** `"blockApiSubproviders": ["openai", "anthropic"]` |
| `autoThrottle` | `boolean` | `true` | Demotes providers above `autoDowngradeAbovePercent` using reported weekly quota or an explicit custom cap. Available credit headroom bypasses quota demotion, except with explicit caps or `--throttle`.<br>**Example:** `"autoThrottle": true` |
| `weeklyLimitUsdEquivalent` | `Record<string, number \| string>` | *(Derived from `plans`)* | Optional custom override for weekly rolling 7-day capacity per provider, either in API-equivalent USD (`250` or `"$250"`) or raw tokens (`"300M"`).<br>**Example:** `{"codex": "300M", "claudeAgent": "400M"}` |
| `autoDowngradeAbovePercent` | `number` | `80` | Percentage of weekly capacity at which a provider is throttled.<br>**Example:** `"autoDowngradeAbovePercent": 80` |

---

### 4. `models` & `reasoning` Examples

```json
  "models": [
    "codex:all",
    "codex:!luna",
    "claude:all",
    "claude:!fable",
    "opencode:glm-5.3*"
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

Standalone Codex must use `--harness codex`; standalone Claude Code must use `--harness claude`. These restrictions apply to every role, including reviewers and budget workers. Explicit provider-only requests use the same flags even in T3 Code. Cross-family review never overrides the restriction: a single-family pool uses an independent reviewer from that family. An empty allowed pool is a blocker, not permission to switch providers.

The CLI does not infer the host from environment variables (T3 can itself run Codex or Claude). Unscoped commands below are for hosts with cross-provider delegation; retain the appropriate `--harness` flag on every call in provider-only sessions.

```fish
# Default (merges bundled defaults + one personal override; reads live settings and usage)
node ~/.agents/skills/task-router/scripts/resolve-models.mjs

# Show full 7-day & all-time Usage, Cost & Plan Simulator Report
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --report

# Simulate or apply specific monthly subscription plans ($20, $100, $200)
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --plan openai=20,claude=100

# Force Economy or Performance mode
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --budget economy
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --budget performance

# Enforce quota throttling even when credits remain
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --throttle

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
