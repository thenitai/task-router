import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { findLatestCodexRateLimits, scanUsageTelemetry, normalizePlans, formatMarkdown, formatUsageReport, planToWeeklyLimitUsd, resolveModels } from "../scripts/resolve-models.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "model.json"), "utf8"));

test("default model.json resolves expected models and excludes claude-fable and legacy models", () => {
	const resolved = resolveModels(defaultConfig);
	const ids = resolved.models.map((m) => m.id);
	assert.ok(ids.includes("gpt-6-astra"), "includes gpt-6-astra");
	assert.ok(ids.includes("gpt-6.1-sol"), "includes gpt-6.1-sol");
	assert.ok(ids.includes("gpt-6-luna"), "includes gpt-6-luna");
	assert.ok(ids.includes("claude-opus-5-5"), "includes claude-opus-5-5");
	assert.ok(ids.includes("claude-sonnet-5-5"), "includes claude-sonnet-5-5");
	assert.ok(ids.includes("claude-haiku-5-5"), "includes claude-haiku-5-5");
	assert.ok(!ids.includes("claude-fable-5-1"), "excludes claude-fable-5-1 via claude:!fable");
	assert.ok(!ids.includes("gpt-6-sol"), "excludes superseded gpt-6-sol via latestGenerationOnly");
	assert.ok(!ids.includes("gpt-5.6-sol"), "excludes legacy gpt-5.6-sol");
	assert.ok(!ids.includes("claude-opus-4-8"), "excludes legacy claude-opus-4-8");
	assert.ok(!ids.includes("google/gemini-4-argon"), "excludes google/gemini-4-argon after removing gemini from model.json");
	assert.ok(!ids.includes("opencode/gemini-3.8-flash"), "excludes opencode/gemini-3.8-flash after removing gemini from model.json");
	assert.ok(ids.includes("cloudflare-workers-ai/@cf/zai-org/glm-5.3"), "includes cloudflare-workers-ai glm-5.3");
	assert.ok(ids.includes("cloudflare-workers-ai/@cf/zai-org/glm-5.3-flash"), "includes cloudflare-workers-ai glm-5.3-flash");
	assert.ok(ids.includes("opencode/kimi-k3"), "includes opencode/kimi-k3");
	assert.ok(ids.includes("cloudflare-workers-ai/@cf/deepseek-ai/deepseek-v4-pro-0813"), "includes cloudflare-workers-ai deepseek-v4-pro");
	assert.ok(ids.includes("cloudflare-workers-ai/@cf/deepseek-ai/deepseek-v4-flash-0731"), "includes cloudflare-workers-ai deepseek-v4-flash");
});

test("recommends workhorse coordinator (not gpt-6-astra) in balanced mode and blocks OpenCode openai/anthropic API duplicates", () => {
	const catalog = [
		{ providerInstanceId: "codex", id: "gpt-6-astra", label: "GPT-6-Astra" },
		{ providerInstanceId: "codex", id: "gpt-6.1-sol", label: "GPT-6.1-Sol" },
		{ providerInstanceId: "opencode", id: "anthropic/claude-sonnet-5-5", label: "Claude Sonnet 5.5 (API)" },
		{ providerInstanceId: "opencode", id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol (API)" },
		{ providerInstanceId: "opencode", id: "cloudflare-workers-ai/@cf/deepseek-ai/deepseek-v4-pro-0813", label: "DeepSeek V4 Pro" },
	];
	const cfg = { ...defaultConfig, select: ["codex:all", "opencode:all"] };
	const resolved = resolveModels(cfg, catalog);
	const ids = resolved.models.map((m) => `${m.providerInstanceId}:${m.id}`);
	assert.ok(!ids.includes("opencode:anthropic/claude-sonnet-5-5"), "blocks paid anthropic API via opencode");
	assert.ok(!ids.includes("opencode:openai/gpt-6.1-sol"), "blocks paid openai API via opencode");
	assert.equal(resolved.recommended.coordinator.id, "gpt-6.1-sol", "picks workhorse gpt-6.1-sol as coordinator instead of gpt-6-astra");
});

test("throttles a provider when 7-day spend or token volume exceeds weekly limit threshold and supports --budget economy", () => {
	const runtimeState = {
		disabledProviders: new Set(),
		hiddenModelsByProvider: new Map(),
		favorites: new Set(),
		modelOrder: new Map(),
		connectedOpencodeSubproviders: new Set(["google", "cloudflare-workers-ai", "opencode"]),
		usage: {
			byProvider: {
				codex: { usd7d: 42, usd30d: 180, usdTotal: 690, tokens7d: 350_000_000, tokensTotal: 550_000_000, turns7d: 500, turnsTotal: 4000 },
				claudeAgent: { usd7d: 10, usd30d: 25, usdTotal: 25, tokens7d: 15_000_000, tokensTotal: 30_000_000, turns7d: 100, turnsTotal: 250 },
			},
		},
	};
	const resolved = resolveModels(defaultConfig, undefined, null, runtimeState, { weeklyLimits: { codex: 45, claudeAgent: 45 } });
	assert.equal(resolved.quotaStatus.codex.throttled, true, "codex is throttled at $42/$45 (93%)");
	assert.equal(resolved.quotaStatus.claudeAgent.throttled, false, "claudeAgent is not throttled at $10/$45 (22%)");
	assert.equal(resolved.recommended.coordinator.providerInstanceId, "claudeAgent", "shifts coordinator to unthrottled claudeAgent");
	assert.equal(resolved.recommended.primaryImplementer.id, "claude-sonnet-5-5", "shifts primary implementer to claude-sonnet-5-5");

	const tokenResolved = resolveModels(defaultConfig, undefined, null, runtimeState, { weeklyLimits: { codex: "300M", claudeAgent: "300M" } });
	assert.equal(tokenResolved.quotaStatus.codex.unit, "tokens");
	assert.equal(tokenResolved.quotaStatus.codex.throttled, true, "codex is throttled at 350M / 300M tokens");
	assert.equal(tokenResolved.quotaStatus.claudeAgent.throttled, false, "claudeAgent is not throttled at 15M / 300M tokens");

	const economy = resolveModels(defaultConfig, undefined, null, null, { budgetMode: "economy" });
	assert.equal(economy.recommended.primaryImplementer.id, "cloudflare-workers-ai/@cf/deepseek-ai/deepseek-v4-pro-0813", "economy mode picks cheapest workhorse first");
});

test("skips disabled T3 providers and respects hiddenModels + connected OpenCode gateways", () => {
	const catalog = [
		{ providerInstanceId: "codex", id: "gpt-6.1-sol", label: "GPT-6.1-Sol" },
		{ providerInstanceId: "claudeAgent", id: "claude-opus-5-5", label: "Claude Opus 5.5" },
		{ providerInstanceId: "opencode", id: "opencode/glm-5.3", label: "GLM 5.3" },
		{ providerInstanceId: "opencode", id: "cloudflare-workers-ai/@cf/zai-org/glm-5.3", label: "GLM 5.3" },
		{ providerInstanceId: "opencode", id: "github-copilot/gemini-4-argon", label: "Gemini 4 Argon" },
		{ providerInstanceId: "opencode", id: "google/gemini-4-argon", label: "Gemini 4 Argon" },
	];
	const runtimeState = {
		disabledProviders: new Set(["claudeAgent"]),
		hiddenModelsByProvider: new Map([["opencode", new Set(["opencode/glm-5.3"])]]),
		favorites: new Set(["opencode:cloudflare-workers-ai/@cf/zai-org/glm-5.3"]),
		modelOrder: new Map(),
		connectedOpencodeSubproviders: new Set(["google", "cloudflare-workers-ai", "opencode"]),
	};
	const resolved = resolveModels(defaultConfig, catalog, null, runtimeState);
	const ids = resolved.models.map((m) => m.id);
	assert.ok(!ids.includes("claude-opus-5-5"), "skips disabled claudeAgent provider");
	assert.ok(!ids.includes("opencode/glm-5.3"), "skips hidden opencode/glm-5.3");
	assert.ok(ids.includes("cloudflare-workers-ai/@cf/zai-org/glm-5.3"), "selects connected cloudflare-workers-ai glm-5.3");
	assert.ok(!ids.includes("github-copilot/gemini-4-argon"), "skips unauthenticated github-copilot gateway");
	assert.ok(!ids.includes("google/gemini-4-argon"), "excludes google/gemini-4-argon when not in select");
	assert.equal(resolved.recommended.crossFamilyReviewer.id, "cloudflare-workers-ai/@cf/zai-org/glm-5.3", "falls back reviewer to cross-family OpenCode workhorse when Claude is disabled and Gemini is excluded");
});

test("uses post-reset window stats and does not throttle $200 OpenAI Pro plan when credits/resets remain", () => {
	const runtimeState = {
		disabledProviders: new Set(["claudeAgent"]),
		hiddenModelsByProvider: new Map(),
		favorites: new Set(),
		modelOrder: new Map(),
		connectedOpencodeSubproviders: new Set(["cloudflare-workers-ai", "opencode"]),
		usage: {
			byProvider: {
				codex: { usd7d: 702.78, usdWindow: 152.34, tokens7d: 1_070_100_000, tokensWindow: 119_300_000, turns7d: 5000, usdTotal: 702.78, tokensTotal: 1_070_100_000, turnsTotal: 5000 },
			},
			liveRateLimits: {
				codex: {
					planType: "pro",
					usedPercent: 49,
					windowMinutes: 10080,
					resetsAtSec: 1792875416,
					windowStartMs: (1792875416 - 10080 * 60) * 1000,
					hasCredits: true,
					creditsBalance: 30173.67,
					rateLimitReached: false,
				},
			},
		},
	};
	const resolved = resolveModels(defaultConfig, undefined, null, runtimeState);
	assert.equal(resolved.quotaStatus.codex.percentUsed, 49, "reports live post-reset 49% used instead of stale 100%");
	assert.equal(resolved.quotaStatus.codex.spent7dUsd, 152.34, "uses post-reset window spend instead of pre-reset 7d sum");
	assert.equal(resolved.quotaStatus.codex.tokens7dM, 119.3, "uses post-reset window tokens");
	assert.equal(resolved.quotaStatus.codex.throttled, false, "does not throttle codex");
	assert.equal(resolved.recommended.primaryImplementer.id, "gpt-6.1-sol", "keeps codex:gpt-6.1-sol as primary implementer");
});

test("gracefully falls back to single harness (claude-only or codex-only)", () => {
	const claudeOnly = resolveModels(defaultConfig, undefined, ["claudeAgent"]);
	assert.ok(claudeOnly.models.every((m) => m.providerInstanceId === "claudeAgent"));
	assert.equal(claudeOnly.recommended.primaryImplementer.id, "claude-sonnet-5-5");
	assert.equal(claudeOnly.recommended.crossFamilyReviewer.id, "claude-opus-5-5");

	const codexOnly = resolveModels(defaultConfig, undefined, ["codex"]);
	assert.ok(codexOnly.models.every((m) => m.providerInstanceId === "codex"));
	assert.equal(codexOnly.recommended.primaryImplementer.id, "gpt-6.1-sol");
	assert.equal(codexOnly.recommended.crossFamilyReviewer.id, "gpt-6-astra");
});

test("CLI provider-only restrictions cover every role across budget modes and throttling", () => {
	for (const [harness, provider, family] of [["codex", "codex", "openai"], ["claude", "claudeAgent", "anthropic"]]) {
		for (const budget of ["balanced", "economy", "performance"]) {
			const resolved = JSON.parse(execFileSync(process.execPath, [
				path.join(__dirname, "..", "scripts", "resolve-models.mjs"),
				"--config", path.join(__dirname, "..", "model.json"),
				"--static", "--json", "--harness", harness, "--budget", budget,
			], { encoding: "utf8" }));
			const throttled = resolveModels(defaultConfig, undefined, [provider], {
				usage: { liveRateLimits: { [provider]: { usedPercent: 100, rateLimitReached: true } } },
			}, { budgetMode: budget });
			assert.equal(throttled.quotaStatus[provider].throttled, true);
			for (const result of [resolved, throttled]) {
				assert.ok(result.recommended.crossFamilyReviewer, `${harness}/${budget} has a reviewer`);
				for (const model of [...result.models, ...Object.values(result.tiers).flat(), ...Object.values(result.recommended).filter(Boolean)]) {
					assert.equal(model.providerInstanceId, provider, `${harness}/${budget}: ${model.id}`);
					assert.equal(model.family, family);
				}
			}
		}
		const unavailable = resolveModels(defaultConfig, undefined, [provider], { disabledProviders: new Set([provider]) });
		assert.deepEqual(unavailable.models, []);
		assert.ok(Object.values(unavailable.recommended).every((model) => model === null));
	}
});

test("formatMarkdown renders markdown table and cost recommendations", () => {
	const resolved = resolveModels(defaultConfig);
	const md = formatMarkdown(resolved);
	assert.ok(md.includes("| `@frontier` |"));
	assert.ok(md.includes("Recommended Cost-Optimized Routing"));
});

test("maps monthly plans (openai=200, claude=100) to weekly capacity and load-balances across subscriptions", () => {
	assert.equal(planToWeeklyLimitUsd("codex", 200), 1750);
	assert.equal(planToWeeklyLimitUsd("codex", 20), 175);
	assert.equal(planToWeeklyLimitUsd("claudeAgent", 100), 450);
	assert.equal(planToWeeklyLimitUsd("claudeAgent", 20), 90);

	const runtimeState = {
		disabledProviders: new Set(),
		hiddenModelsByProvider: new Map(),
		favorites: new Set(),
		modelOrder: new Map(),
		connectedOpencodeSubproviders: new Set(["google", "cloudflare-workers-ai", "opencode"]),
		usage: {
			byProvider: {
				codex: { usd7d: 90, tokens7d: 150_000_000, inTok7d: 2_000_000, cacheRead7d: 147_000_000, outTok7d: 1_000_000, turns7d: 1000, usdTotal: 90, tokensTotal: 150_000_000, turnsTotal: 1000 },
				claudeAgent: { usd7d: 20, tokens7d: 30_000_000, inTok7d: 500_000, cacheRead7d: 29_000_000, outTok7d: 500_000, turns7d: 200, usdTotal: 20, tokensTotal: 30_000_000, turnsTotal: 200 },
			},
			byModel: {
				"codex:gpt-6.1-sol": { provider: "codex", model: "gpt-6.1-sol", billing: "subscription", usd7d: 90, usdTotal: 90, tokens7d: 150_000_000, tokensTotal: 150_000_000, inTok7d: 2_000_000, cacheRead7d: 147_000_000, outTok7d: 1_000_000, turns7d: 1000, turnsTotal: 1000 },
			},
			liveRateLimits: { codex: { usedPercent: 51 }, claudeAgent: { usedPercent: 4 } },
		},
	};
	const resolved = resolveModels(defaultConfig, undefined, null, runtimeState, { plans: { codex: 20, claudeAgent: 100 } });
	assert.equal(resolved.quotaStatus.codex.weeklyLimit, 175);
	assert.equal(resolved.quotaStatus.codex.percentUsed, 51);
	assert.equal(resolved.quotaStatus.claudeAgent.weeklyLimit, 450);
	assert.equal(resolved.quotaStatus.claudeAgent.percentUsed, 4);
	assert.equal(resolved.recommended.primaryImplementer.providerInstanceId, "claudeAgent", "load-balances toward claudeAgent (4% used) over codex (51% used)");
	assert.equal(resolved.recommended.secondaryImplementer.providerInstanceId, "codex", "keeps codex as secondary parallel implementer");

	const report = formatUsageReport(runtimeState, resolved);
	assert.ok(report.includes("Subscription Plan Simulator"));
	assert.ok(report.includes("openai=20, claude=100"));
});

test("zero plans mean no subscription; disabled providers remain distinct", () => {
	assert.deepEqual(normalizePlans({ openai: 200, claude: 0, invalid: -1, infinite: Infinity }), { codex: 200, claudeAgent: 0 });
	for (const options of [{}, { plans: { claude: 0 } }]) {
		const resolved = resolveModels({ ...defaultConfig, plans: { openai: 200, claude: 0 } }, undefined, null, null, options);
		assert.equal(resolved.plans.claudeAgent, 0);
		assert.equal(resolved.quotaStatus.claudeAgent.percentUsed, null);
		assert.ok(resolved.models.every((m) => m.providerInstanceId !== "claudeAgent"));
		assert.ok(formatMarkdown(resolved).includes("No subscription"));
		assert.ok(formatUsageReport(null, resolved).includes("No subscription"));
	}
	const disabled = resolveModels(defaultConfig, undefined, null, { disabledProviders: new Set(["claudeAgent"]) });
	assert.equal(disabled.quotaStatus.claudeAgent.status, "disabled");
	assert.ok(formatMarkdown(disabled).includes("Provider disabled"));
});

test("unknown quota is not zero; cost estimates do not claim subscription usage", () => {
	const resolved = resolveModels(defaultConfig, undefined, null, { usage: { byProvider: { codex: { usd7d: 1750, tokens7d: 100 } } } });
	assert.equal(resolved.quotaStatus.codex.percentUsed, null);
	assert.equal(resolved.quotaStatus.codex.estimatedPercentUsed, 100);
	assert.equal(resolved.quotaStatus.codex.throttled, false);
	assert.ok(formatMarkdown(resolved).includes("usage unknown"));
	assert.ok(formatMarkdown(resolved).includes("local API-equivalent estimate"));
});

test("finds newest weekly event across older sessions and beyond the tail, without a usage cache", (t) => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "router-quota-"));
	t.after(() => fs.rmSync(home, { recursive: true, force: true }));
	const dir = path.join(home, ".codex", "sessions");
	fs.mkdirSync(dir, { recursive: true });
	const now = Date.parse("2026-10-20T12:00:00Z");
	const reset = now / 1000 + 86400;
	const event = (ts, weekly, extra = {}) => JSON.stringify({ timestamp: new Date(ts).toISOString(), payload: { rate_limits: {
		primary: { used_percent: 49, window_minutes: 300, resets_at: reset },
		secondary: { used_percent: weekly, window_minutes: 10080, resets_at: reset }, ...extra,
	} } });
	for (let i = 1; i <= 20; i++) fs.writeFileSync(path.join(dir, `rollout-2026-10-${String(i).padStart(2, "0")}T00-00-00.jsonl`), event(now - 10000, 49));
	const source = path.join(dir, "rollout-2026-01-01T00-00-00.jsonl");
	fs.writeFileSync(source, event(now - 1000, 1) + "\n" + "{}\n".repeat(100) + "{broken\n" + event(now, 99, { limit_id: "model-specific" }));
	const reading = findLatestCodexRateLimits(home, [], now);
	assert.equal(reading.usedPercent, 1);
	assert.equal(reading.sourceFile, source);
	assert.equal(reading.windowMinutes, 10080);
	const usage = scanUsageTelemetry(home, now);
	assert.equal(usage.liveRateLimits.codex.usedPercent, 1);
	const cacheDir = path.join(home, ".t3", "userdata");
	fs.mkdirSync(cacheDir, { recursive: true });
	fs.writeFileSync(path.join(cacheDir, "usage-scan-cache-v5.json"), "{broken");
	assert.equal(scanUsageTelemetry(home, now).liveRateLimits.codex.usedPercent, 1);

	const resolved = resolveModels(defaultConfig, undefined, null, { usage });
	assert.equal(resolved.quotaStatus.codex.percentRemaining, 99);
	const md = formatMarkdown(resolved);
	assert.ok(md.includes("1% used / 99% remaining"));
	assert.ok(md.includes("2026-10-20T11:59:59.000Z"));
	assert.ok(md.includes(source));
	assert.ok(formatUsageReport({ usage }, resolved).includes("1% used / 99% remaining"));
	fs.writeFileSync(source, event(now, 99, { primary: { used_percent: 1, window_minutes: 10080, resets_at: reset }, secondary: null }));
	assert.equal(findLatestCodexRateLimits(home, [], now).usedPercent, 1, "weekly window can also be primary");

	assert.equal(findLatestCodexRateLimits(home, [], now + 2 * 86400000).usedPercent, null);
	fs.writeFileSync(source, event(now, 1, { secondary: null }));
	assert.equal(findLatestCodexRateLimits(home, [], now).usedPercent, null, "a newer event without weekly data must not revive an older reading");
	fs.writeFileSync(source, event(now, -1));
	assert.equal(findLatestCodexRateLimits(home, [], now).usedPercent, null);
});
