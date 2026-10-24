# task-router

Cost-aware planning and subagent orchestration for T3 Code, Codex, Claude Code, and OpenCode. The resolver recommends models; the skill instructs the coordinator to dispatch, inspect results, and recover from limits. It does not migrate running agents or purchase subscriptions.

## Install or update

```sh
npx skills add thenitai/task-router -g -y -a claude-code codex opencode
```

Invoke `$task-router <task>` in Codex or `/task-router <task>` in the other supported hosts. The skill investigates and presents a routing plan before its explicit implementation approval gate.

## Personal configuration

Bundled `model.json` is unchanged by personal settings. Put overrides in `~/.config/task-router/user.json` so skill updates preserve them:

```json
{
  "plans": { "openai": 100, "claude": 100 },
  "apiBudgets": { "cloudflare": { "monthlyUsd": 0 } },
  "speed": "standard"
}
```

`plans` declares monthly subscription prices; `0` means no subscription. Changing JSON does not change billing or establish that an upgrade is active. Bundled defaults remain OpenAI $20 / Claude $20. Do not derive included usage from API token prices or linear scaling of subscription prices; provider dashboards and current telemetry are authoritative.

OpenCode is the harness. Cloudflare Workers AI is metered API spending, independent of OpenAI/Claude subscriptions:

- `apiBudgets.cloudflare.monthlyUsd: 0` blocks paid Cloudflare dispatch.
- A positive amount sets a local UTC calendar-month dispatch budget, using Cloudflare-only costs recorded in this machine's OpenCode database.
- Missing/incomplete spending blocks new Cloudflare dispatch under a configured budget. Missing costs and undated/invalid Cloudflare records make spending incomplete. They are not treated as zero. A recorded numeric zero remains zero. Boolean, text, negative, or non-finite costs are incomplete. Token limits independently require numeric input, output, and cache-read counts; absent or invalid counters are incomplete, without making a known dollar cost unknown.
- Omitting the budget preserves existing routing behavior. It is not a provider billing cap: other machines, outside applications, missing records, and work already running can affect the final invoice.

Nested objects merge with bundled defaults; arrays/scalars replace. `models` replaces the entire default pattern list; an empty list clears it. The first existing personal file wins:

1. `~/.config/task-router/user.json`
2. `~/.codex/task-router/user.json`
3. `~/.config/task-router/model.json`
4. `~/.config/task-router/models.json`
5. `~/.codex/task-router/model.json`
6. `~/.codex/task-router/models.json`

`--config <path>` selects an explicit override; missing/invalid files fail with the path. CLI flags win. Explicit weekly caps remain in force when `--plan` changes; only `--weekly-limit` replaces those caps. Invalid cap values, units, providers, or missing arguments fail with an error. Legacy `select` is accepted when `models` is absent.

## Quota and failover

Codex telemetry comes from the newest timestamp across session and archived-session JSONL files. The resolver retains both short and weekly windows. Weekly/five-hour rejection labels match window durations even when primary and secondary swap; explicit primary/secondary labels retain their positions. Claude usage comes from the same read-only OAuth endpoint used by Claude Code `/usage`, using its existing `~/.claude/.credentials.json` login. It never refreshes tokens, prints credentials, or generates model responses. Missing/expired login, request failure, or invalid windows show unknown usage and an error; use `/usage` to check manually. This endpoint is a CLI implementation detail and can change.

A hard provider rejection, current exhausted window, persistent block, or reached explicit cap removes that provider from **all** roles. An empty restricted pool is a blocker, not permission to use another provider. Soft throttling at 80% changes preference; it does not claim the provider has rejected work. Valid current Codex credit headroom bypasses included-quota demotion/exhaustion when no hard rejection exists; explicit caps and persisted blocks still win. Credit balances remain separate from percentages.

After a confirmed limit error, the coordinator must inspect/cancel the old task before reassigning unfinished work. Record the actual reset (retain original `--harness` restrictions on every call):

```sh
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --block 'claude=2026-10-24T01:30:00Z'
```

The timestamp above is only an example. Without a known reset, `--block claude` persists until verified recovery and `--unblock claude`. State is stored in `~/.config/task-router/provider-blocks.json`; timed blocks expire automatically. `cloudflare` blocks Workers AI only; `opencode` blocks the whole harness. Do not treat code/test failures or ordinary transport errors as exhausted quota.

Rerun the resolver, prefer an eligible alternative subscription, then allowed API models within their spending budget. Pass the original requirements, partial commits/work, failure, and remaining acceptance criteria. Never duplicate active workers, reset budgets, auto-enable overage, or expand a provider-only pool to escape a limit. Main-thread provider changes remain explicit; the resolver only recommends and filters.

## Speed and model roles

`@fast` means a cheaper capability tier, not a provider's premium speed mode. `speed` defaults to `"standard"`; choose `"fast"` explicitly when worthwhile. Resolver entries include actual dispatch options:

| Provider | Standard | Fast | Reasoning option |
| --- | --- | --- | --- |
| Codex | `serviceTier: "default"` | `serviceTier: "priority"` | `reasoningEffort` |
| Claude Opus | `fastMode: false` | `fastMode: true` | `effort` |
| Claude Sonnet/Haiku | No separate speed toggle | No separate speed toggle | `effort` |
| OpenCode | Model default | Model default | `variant` |

In T3, call `orchestrator_capabilities` before resolving and save its structured JSON result (the object containing `providers`) to a temporary file. Pass `--catalog <file>` on every resolver call, alongside the original harness restriction. This live snapshot replaces cached model IDs and supplies advertised reasoning options; disabled/non-delegatable providers are excluded. Missing or empty reasoning descriptors for supported harnesses report a catalog mismatch instead of reviving cached options. Generated speed options must also match the live descriptors. The tool returns a shortened catalog: use its `search` argument for missing configured models and merge those results by provider/model ID before saving. Refresh the snapshot before dispatch or failover; never add IDs from favorites alone. Standalone clients omit `--catalog` and keep local cache discovery. Missing or unreadable Codex caches use bundled Codex models; a valid empty cache stays empty.

In T3, verify live `orchestrator_capabilities`, pass options in `delegate_task.target.options`, and check the returned provider/model/options. Unsupported options must be reported, not silently substituted. Explicit options prevent inherited premium-speed settings from accidentally carrying into a standard-speed task. Use a subscription workhorse such as Sol/Sonnet as coordinator; reserve Astra/Opus for bounded difficult slices and independent review. Keep expensive frontier agents out of repetitive exploration/tool loops.

The model list defaults to direct Codex/Claude plus OpenCode GLM 5.3 and DeepSeek V4 patterns; Fable/legacy models are excluded. Direct subscriptions rank before paid gateways, and OpenCode `openai/*` / `anthropic/*` are blocked to avoid accidental duplicate API billing. Disabled providers, hidden models, and unavailable gateways are respected. Cross-family review is a preference within the permitted pool.

## Commands

Standalone Codex must pass `--harness codex`; standalone Claude must pass `--harness claude`. T3 supports cross-provider routing unless the user restricts it. Never infer the host solely from the coordinator model.

```sh
# T3: save orchestrator_capabilities structured result to /tmp/task-router-catalog.json first
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --catalog /tmp/task-router-catalog.json

# Usage report: current supported T3 cache (v9 through v5) and OpenCode
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --report

# Declare plans for this invocation; does not purchase or persist them
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --plan openai=100,claude=100

# Examples for standalone Codex (retain restriction on all later calls)
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --harness codex --budget economy
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --harness codex --throttle
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --harness codex --weekly-limit codex=300M

# Static model/config inspection, without local usage or network access
node ~/.agents/skills/task-router/scripts/resolve-models.mjs --static --json
```

`budget.mode`: `balanced` (subscription workhorse first), `economy` (lowest API-equivalent model cost), or `performance` (frontier coordinator). `budget.spreadAcrossSubscriptions` balances valid reported weekly headroom when neither provider has usable credit headroom. `budget.autoThrottle` and `autoDowngradeAbovePercent` configure soft throttling. `budget.weeklyLimitUsdEquivalent` or `--weekly-limit` is an explicit local rolling-seven-day custom USD-equivalent/token cap, not provider quota. `--throttle` enforces quota demotion even with credits. Configured weekly dollar caps block dispatch when local spending is unavailable or incomplete; known zero remains zero. Configured token caps likewise require a finite, nonnegative recorded token total; missing totals block dispatch. Valid records dated before the current month do not make Cloudflare monthly spending incomplete. `reasoning` controls coordinator/frontier/workhorse/reviewer/fast effort; supported reasoning is resolved per model.

OpenCode totals are grouped inside SQLite, so accumulated message history does not overflow the command output buffer. Reports separate subscription API-equivalent estimates from locally recorded API cash costs and provider-reported usage. T3 message dedupe keys, tail rows, and cache creation tokens are included. Invalid T3 rows or containers produce warnings and incomplete totals for affected providers; later valid records still count. Explicit caps block potentially incomplete weekly usage, including when an unreadable newer cache falls back to an older file. Missing cost shows unknown/incomplete. Token-price comparisons do not prove task quality, which sessions were coordinators, or how much subscription capacity a different plan includes.

## Tests

```sh
node --test tests/*.test.mjs
```

Fixtures cover layered config, provider restrictions, credits, hard/soft limits, quota resets, short-window exhaustion, speed options, current cache decoding, Cloudflare-only monthly spending, and unknown costs. Tests mock Claude's endpoint and do not use development databases or run paid inference.
