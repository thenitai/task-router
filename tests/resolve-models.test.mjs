import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { formatMarkdown, resolveModels } from "../scripts/resolve-models.mjs";

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
	assert.ok(ids.includes("google/gemini-4-argon"), "includes google/gemini-4-argon");
	assert.ok(ids.includes("opencode/gemini-3.8-flash"), "includes opencode/gemini-3.8-flash");
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

test("throttles a provider when 7-day spend exceeds weekly limit threshold and supports --budget economy", () => {
	const runtimeState = {
		disabledProviders: new Set(),
		hiddenModelsByProvider: new Map(),
		favorites: new Set(),
		modelOrder: new Map(),
		connectedOpencodeSubproviders: new Set(["google", "cloudflare-workers-ai", "opencode"]),
		usage: {
			byProvider: {
				codex: { usd7d: 42, usd30d: 180, usdTotal: 690, turns7d: 500, turnsTotal: 4000 },
				claudeAgent: { usd7d: 10, usd30d: 25, usdTotal: 25, turns7d: 100, turnsTotal: 250 },
			},
		},
	};
	const resolved = resolveModels(defaultConfig, undefined, null, runtimeState, { weeklyLimits: { codex: 45, claudeAgent: 45 } });
	assert.equal(resolved.quotaStatus.codex.throttled, true, "codex is throttled at 42/45 (93%)");
	assert.equal(resolved.quotaStatus.claudeAgent.throttled, false, "claudeAgent is not throttled at 10/45 (22%)");
	assert.equal(resolved.recommended.coordinator.providerInstanceId, "claudeAgent", "shifts coordinator to unthrottled claudeAgent");
	assert.equal(resolved.recommended.primaryImplementer.id, "claude-sonnet-5-5", "shifts primary implementer to claude-sonnet-5-5");

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
	assert.ok(ids.includes("google/gemini-4-argon"), "includes connected google/gemini-4-argon");
	assert.equal(resolved.recommended.crossFamilyReviewer.id, "google/gemini-4-argon", "falls back reviewer to Gemini 4 Argon when Claude is disabled");
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

test("formatMarkdown renders markdown table and cost recommendations", () => {
	const resolved = resolveModels(defaultConfig);
	const md = formatMarkdown(resolved);
	assert.ok(md.includes("| `@frontier` |"));
	assert.ok(md.includes("Recommended Cost-Optimized Routing"));
});
