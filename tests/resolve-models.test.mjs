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

test("supports codex:!luna exclusion shorthand", () => {
	const custom = { ...defaultConfig, select: ["codex:all", "codex:!luna"] };
	const resolved = resolveModels(custom);
	const ids = resolved.models.map((m) => m.id);
	assert.deepEqual(ids, ["gpt-6-astra", "gpt-6.1-sol"]);
});

test("enforces cross-family reviewer when multiple model families are active", () => {
	const resolved = resolveModels(defaultConfig);
	const impl = resolved.recommended.primaryImplementer;
	const reviewer = resolved.recommended.crossFamilyReviewer;
	assert.ok(impl, "selects a primary implementer");
	assert.ok(reviewer, "selects a reviewer");
	assert.notEqual(impl.family, reviewer.family, "reviewer must be a different family from implementer");
	assert.equal(reviewer.reasoning, "high");
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

test("deduplicates aggregator models when preferDirectProvider is true", () => {
	const noisyCatalog = [
		{ providerInstanceId: "codex", id: "gpt-6.1-sol", label: "GPT-6.1-Sol" },
		{ providerInstanceId: "opencode", id: "opencode/gpt-6.1-sol", label: "GPT-6.1 Sol" },
		{ providerInstanceId: "opencode", id: "github-copilot/gemini-4-argon", label: "Gemini 4 Argon" },
		{ providerInstanceId: "opencode", id: "google/gemini-4-argon", label: "Gemini 4 Argon" },
	];
	const cfg = { defaults: { latestGenerationOnly: true, preferDirectProvider: true, crossFamilyReview: true }, select: ["codex:all", "opencode:all"] };
	const resolved = resolveModels(cfg, noisyCatalog);
	const solEntries = resolved.models.filter((m) => m.id.includes("gpt-6.1-sol"));
	assert.equal(solEntries.length, 1);
	assert.equal(solEntries[0].providerInstanceId, "codex");

	const geminiEntries = resolved.models.filter((m) => m.id.includes("gemini-4-argon"));
	assert.equal(geminiEntries.length, 1);
	assert.equal(geminiEntries[0].id, "google/gemini-4-argon");
});

test("formatMarkdown renders markdown table", () => {
	const resolved = resolveModels(defaultConfig);
	const md = formatMarkdown(resolved);
	assert.ok(md.includes("| `@frontier` |"));
	assert.ok(md.includes("| `@workhorse` |"));
	assert.ok(md.includes("Default Cross-Family Pairing"));
});
