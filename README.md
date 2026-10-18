# task-router

Cost-aware, adaptive multi-model planning and subagent orchestration skill for **T3 Code**, **OpenCode**, **Codex**, and **Claude Code**.

`task-router` replaces hardcoded model names in planning prompts with a dynamic resolver (`scripts/resolve-models.mjs`) backed by `model.json` and your live local runtime settings:
1. **Resolves active models and gateways** from your live installations (`codex`, `claudeAgent`, `opencode`), skipping disabled T3 providers, hidden models, and unauthenticated gateways.
2. **Protects subscriptions over paid APIs** by prioritizing direct subscriptions (`codex`, `claudeAgent`) and blocking duplicate per-token API charges (`openai/*`, `anthropic/*` inside OpenCode).
3. **Tracks 7-day rolling usage & spend** from T3 telemetry (`~/.t3/userdata/usage-scan-cache-v5.json`) in both **API-equivalent USD ($)** and **token volume (`M`/`k`)**.
4. **Enforces a 3-phase workflow**: Read-only investigation & cost-optimized routing table → explicit user approval gate → autonomous subagent implementation, cross-family code review, frontend browser testing, and git integration.

---

## Installation

Install globally across all supported agents (`claude-code`, `codex`, `opencode`, T3 Code, etc.):

```fish
npx skills add thenitai/task-router -g --all
```

Update to the latest version:

```fish
npx skills add thenitai/task-router -g --all
```

Invoke in your agent:
- **T3 Code / OpenCode / Claude Code:** `/task-router <your task>`
- **Codex:** `$task-router <your task>`

---

## How `--weekly-limit` Works (Price vs. Tokens)

Subscription plans (like OpenAI Pro/Plus and Claude Max/Pro) do not expose a live "remaining dollars" API endpoint; instead, they meter your rolling 7-day usage internally, weighting frontier models much more heavily than smaller models.

To mirror that accurately, `task-router` reads every turn recorded in `~/.t3/userdata/usage-scan-cache-v5.json` over the past 7 days and supports **two limit formats**:

### 1. API-Equivalent USD Price (Default — Number or `$`)
Computes what your rolling 7-day uncached input, cached input, and output tokens would cost at each model's per-million token rate (`~/.cache/opencode/models.json`):
- **Why this is the default:** 10M cached tokens on `gpt-6-astra` ($1.00/M = **$10.00**) drains your subscription window **10x faster** than 10M cached tokens on `gpt-6.1-sol` ($0.10/M = **$1.00**), and **100x faster** than `gpt-6-luna` ($0.01/M = **$0.10**). Weighting by price captures the real quota impact of frontier vs. workhorse models.
- **Example (`model.json`):**
  ```json
  "weeklyLimitUsdEquivalent": {
    "codex": 250,
    "claudeAgent": 250
  }
  ```
- **Example (CLI flag):**
  ```fish
  node ~/.agents/skills/task-router/scripts/resolve-models.mjs --weekly-limit codex=150,claude=200
  ```

### 2. Raw Token Count (`M` or `k` Suffix)
If you prefer to cap by raw 7-day token volume (uncached input + cached input + output tokens combined), pass a string ending in `M` (millions) or `k` (thousands):
- **Example (`model.json`):**
  ```json
  "weeklyLimitUsdEquivalent": {
    "codex": "500M",
    "claudeAgent": "400M"
  }
  ```
- **Example (CLI flag):**
  ```fish
  node ~/.agents/skills/task-router/scripts/resolve-models.mjs --weekly-limit codex=500M,claude=400M
  ```

In both modes, the status header displays **both** metrics side-by-side:
```text
- 7-Day Rolling Quota Burn: `codex`: $702.78 / $250 7d eq (551.1M tok) (281%) | `claudeAgent`: $0.88 / $250 7d eq (2.3M tok) (0%)
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
  "budget": {
    "mode": "balanced",
    "coordinatorTier": "workhorse",
    "preferSubscriptionOverApi": true,
    "blockApiSubproviders": ["openai", "anthropic"],
    "autoThrottle": false,
    "weeklyLimitUsdEquivalent": {
      "codex": 250,
      "claudeAgent": 250
    },
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

### 1. `defaults` Settings & Examples

| Setting | Type | Default | Description & Example |
| :--- | :--- | :--- | :--- |
| `latestGenerationOnly` | `boolean` | `true` | Automatically drops superseded model generations (`gpt-5.6-*`, `gpt-6-sol` when `gpt-6.1-sol` is present, `claude-opus-4-8`, `claude-opus-5` when `claude-opus-5-5` is present).<br>**Example:** Set `"latestGenerationOnly": false` if you explicitly want to test against legacy `gpt-5.6-sol` or `claude-opus-4-8`. |
| `preferDirectProvider` | `boolean` | `true` | Deduplicates identical models across providers and gateways, preferring direct `codex` / `claudeAgent` first, then your T3 `favorites` and `modelOrder` (e.g., picking `cloudflare-workers-ai/@cf/zai-org/glm-5.3` over `opencode/glm-5.3-free`).<br>**Example:** Set `"preferDirectProvider": false` to list every gateway variant of the same model in the routing table. |
| `crossFamilyReview` | `boolean` | `true` | Ensures the independent `@reviewer` uses a **different model family** from the primary implementer whenever multiple families are active (e.g., `claude-opus-5-5` or `google/gemini-4-argon` reviewing `gpt-6.1-sol`).<br>**Example:** Set `"crossFamilyReview": false` if you want the highest-ranked reviewer regardless of whether it matches the implementer's vendor. |
| `respectRuntimeSettings` | `boolean` | `true` | Reads `~/.t3/userdata/settings.json` and `~/.local/share/opencode/auth.json` so disabled T3 providers (e.g., `claudeAgent.enabled: false`), `hiddenModels`, and unauthenticated OpenCode gateways (`github-copilot`, `amazon-bedrock`) are skipped automatically.<br>**Example:** Set `"respectRuntimeSettings": false` (or pass `--static`) to resolve against the static catalog ignoring local T3 settings. |

---

### 2. `budget` Settings & Examples

| Setting | Type | Default | Description & Example |
| :--- | :--- | :--- | :--- |
| `mode` | `"balanced" \| "economy" \| "performance"` | `"balanced"` | Controls how models are ranked inside each tier:<br>• `"balanced"` — Subscription `@workhorse` (`gpt-6.1-sol` / `claude-sonnet-5-5`) as Coordinator & primary implementer; `@fast` & open-weight models for recon/boilerplate.<br>• `"economy"` — Sorts every tier strictly by lowest $/M token cost (`deepseek-v4-pro-0813` and `glm-5.3` first for workhorse; `gpt-6-luna` / `glm-5.3-flash` first for fast; lowers workhorse reasoning to `low`/`medium`).<br>• `"performance"` — Promotes `@frontier` (`claude-opus-5-5`, `gpt-6-astra`) to the top of coordinator and review pools.<br>**Example:** `"mode": "economy"` when conserving subscription quota at the end of a billing cycle. |
| `coordinatorTier` | `"workhorse" \| "frontier"` | `"workhorse"` | Selects the tier used for the main Coordinator session. Keeping this as `"workhorse"` (`gpt-6.1-sol` or `claude-sonnet-5-5`) saves **~8–10x cached-token burn** compared to running `gpt-6-astra` as Coordinator.<br>**Example:** `"coordinatorTier": "workhorse"` |
| `preferSubscriptionOverApi` | `boolean` | `true` | In `"balanced"` mode, ranks flat-rate `subscription` providers (`codex`, `claudeAgent`) ahead of per-token `api` gateways (`opencode`) within the same tier.<br>**Example:** Set `"preferSubscriptionOverApi": false` to rank purely by $/M token price even in `"balanced"` mode. |
| `blockApiSubproviders` | `string[]` | `["openai", "anthropic"]` | Prevents OpenCode from routing through paid per-token API keys for vendors you already cover via direct subscriptions (`openai/*`, `anthropic/*`).<br>**Example:** Remove `"anthropic"` (`"blockApiSubproviders": ["openai"]`) if you do not have a Claude subscription and want to use `anthropic/claude-sonnet-5-5` via your OpenCode API key. |
| `autoThrottle` | `boolean` | `false` | When `true` (or when `--throttle` / `--weekly-limit` is passed on the CLI), any provider whose 7-day rolling usage exceeds `autoDowngradeAbovePercent` of `weeklyLimitUsdEquivalent` is marked `THROTTLED` and demoted behind unthrottled subscriptions and cheap open-weight models.<br>**Example:** Set `"autoThrottle": true` to automatically shift tasks from OpenAI (`codex`) to Claude (`claudeAgent`) or Cloudflare Workers AI once OpenAI hits 80% of its weekly target. |
| `weeklyLimitUsdEquivalent` | `Record<string, number \| string>` | `{"codex": 250, "claudeAgent": 250}` | Weekly rolling 7-day target per provider, either in API-equivalent USD (`250` or `"$250"`) or raw tokens (`"500M"`).<br>**Example:** `{"codex": 150, "claudeAgent": 250}` after downgrading your OpenAI plan and adding a Claude subscription. |
| `autoDowngradeAbovePercent` | `number` | `80` | Percentage of `weeklyLimitUsdEquivalent` at which a provider is considered over threshold (`overThreshold: true`, and throttled when `autoThrottle: true`).<br>**Example:** `"autoDowngradeAbovePercent": 75` |

---

### 3. `select` Rules & Examples

Each entry in `select` is `<provider>:<comma-separated-rules>`.
Supported provider names:
- `codex` (alias `openai`) — Direct OpenAI Codex subscription provider
- `claude` (aliases `anthropic`, `claudeAgent`) — Direct Anthropic Claude subscription provider
- `opencode` (alias `google`) — OpenCode connected sub-providers (`google`, `cloudflare-workers-ai`, `cloudflare-ai-gateway`, `opencode`, etc.)

#### Rule Examples

1. **Include all current-generation models from OpenAI and Claude, excluding specific models (`!pattern`):**
   ```json
   "select": [
     "codex:all",
     "codex:!luna",
     "claude:all",
     "claude:!fable"
   ]
   ```
   *(Note: Separate lines for the same provider merge automatically—`["codex:all", "codex:!luna"]` is identical to `["codex:all, !luna"]`.)*

2. **Include only specific open-weight and Gemini models from OpenCode:**
   ```json
   "select": [
     "opencode:gemini-4*, gemini-3.8*, glm-5.3*, kimi-k3, deepseek-v4*"
   ]
   ```

3. **Claude-only setup:**
   ```json
   "select": [
     "claude:all",
     "claude:!fable"
   ]
   ```

---

### 4. `reasoning` Settings & Examples

Sets the default reasoning effort requested for each role/tier (automatically clamped to each model's supported options, e.g., `low`, `medium`, `high`, `xhigh`, `max`):

```json
"reasoning": {
  "coordinator": "medium",
  "frontier": "high",
  "workhorse": "medium",
  "reviewer": "high",
  "fast": "medium"
}
```

- If a model only supports `["low", "high", "max"]` (such as `cloudflare-workers-ai/@cf/zai-org/glm-5.3` or `deepseek-v4-pro-0813`), requesting `"medium"` automatically resolves to `"high"`.

---

## CLI Usage & Flags (`scripts/resolve-models.mjs`)

Run the resolver directly to inspect your active model pool, connected gateways, and 7-day quota burn:

```fish
# Default (reads model.json + live T3 settings, OpenCode auth, and 7d usage telemetry)
node ~/.agents/skills/task-router/scripts/resolve-models.mjs

# Force Economy mode (ranks cheapest $/M models like DeepSeek V4 Pro & GLM 5.3 first)
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --budget economy

# Force Performance mode (promotes frontier Opus 5.5 & GPT-6-Astra)
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --budget performance

# Enable automatic throttling with custom 7-day USD-equivalent caps
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --weekly-limit codex=150,claude=250

# Enable automatic throttling with raw 7-day token caps (Millions of tokens)
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --weekly-limit codex=300M,claude=400M

# Enable throttling using the limits already in model.json
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --throttle

# Restrict to a single harness (e.g., standalone Codex or standalone Claude Code)
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
