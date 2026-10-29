import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { readClaudeQuota, readProviderBlocks, recordProviderBlock, clearProviderBlock } from "../scripts/provider-quota.mjs";
import { resolveModels, scanUsageTelemetry, findLatestCodexRateLimits, formatUsageReport, formatMarkdown } from "../scripts/resolve-models.mjs";

const config = JSON.parse(fs.readFileSync(new URL("../model.json", import.meta.url), "utf8"));
const tempHome = (t) => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "router-controls-"));
	t.after(() => fs.rmSync(home, { recursive: true, force: true }));
	return home;
};
const writeJson = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); };

test("five-hour exhaustion excludes Claude from every role despite weekly headroom", () => {
	const now = Date.now();
	const runtime = { usage: { liveRateLimits: { claudeAgent: { usedPercent: 23, windows: [{ usedPercent: 100, windowMinutes: 300, resetsAtSec: now / 1000 + 3600 }] } } } };
	for (const budgetMode of ["balanced", "economy", "performance"]) {
		const result = resolveModels(config, undefined, null, runtime, { budgetMode });
		assert.equal(result.quotaStatus.claudeAgent.percentUsed, 23);
		assert.equal(result.quotaStatus.claudeAgent.blocked, true);
		assert.ok(result.models.every((m) => m.providerInstanceId !== "claudeAgent"));
		assert.ok(Object.values(result.recommended).filter(Boolean).every((m) => m.providerInstanceId !== "claudeAgent"));
	}
	runtime.usage.liveRateLimits.claudeAgent.windows[0].resetsAtSec = now / 1000 - 1;
	assert.equal(resolveModels(config, undefined, null, runtime).quotaStatus.claudeAgent.blocked, false);
	runtime.usage.liveRateLimits.claudeAgent.rateLimitReached = true;
	assert.equal(resolveModels(config, undefined, null, runtime).quotaStatus.claudeAgent.blocked, true);
});

test("explicit provider blocks persist, expire and respect provider-only boundaries", (t) => {
	const home = tempHome(t);
	const now = Date.now();
	recordProviderBlock("claudeAgent", new Date(now + 60_000).toISOString(), home, now);
	recordProviderBlock("codex", null, home, now);
	const runtime = { providerBlocks: readProviderBlocks(home, now) };
	assert.ok(resolveModels(config, undefined, ["codex"], runtime).models.length === 0);
	assert.ok(resolveModels(config, undefined, null, runtime).models.every((m) => m.providerInstanceId === "opencode"));
	assert.deepEqual(Object.keys(readProviderBlocks(home, now + 61_000)), ["codex"]);
	clearProviderBlock("codex", home);
	assert.ok(!Object.hasOwn(readProviderBlocks(home), "codex"));
	assert.throws(() => recordProviderBlock("unknown", null, home));
	assert.throws(() => recordProviderBlock("codex", "not-a-time", home));
	const lock = path.join(home, ".config", "task-router", "provider-blocks.json.lock");
	fs.writeFileSync(lock, "");
	assert.throws(() => recordProviderBlock("opencode", null, home), { code: "EEXIST" });
	assert.ok(!Object.hasOwn(readProviderBlocks(home), "opencode"));
});

test("Cloudflare cash budget preserves zero, unknown and gateway separation", () => {
	const cfg = { ...config, apiBudgets: { cloudflare: { monthlyUsd: 0 } } };
	let result = resolveModels(cfg);
	assert.equal(result.apiBudgetStatus.cloudflare.monthlyUsd, 0);
	assert.equal(result.apiBudgetStatus.cloudflare.blocked, true);
	assert.ok(!result.models.some((m) => m.id.startsWith("cloudflare-workers-ai/")));
	cfg.apiBudgets.cloudflare.monthlyUsd = 10;
	result = resolveModels(cfg);
	assert.equal(result.apiBudgetStatus.cloudflare.spentUsd, null);
	assert.equal(result.apiBudgetStatus.cloudflare.blocked, true);
	const runtime = { usage: { apiSpending: { cloudflare: { complete: true, spentUsd: 3 } } } };
	result = resolveModels(cfg, undefined, null, runtime);
	assert.equal(result.apiBudgetStatus.cloudflare.blocked, false);
	assert.ok(result.models.some((m) => m.id.startsWith("cloudflare-workers-ai/")));
	runtime.usage.apiSpending.cloudflare.spentUsd = 10;
	assert.equal(resolveModels(cfg, undefined, null, runtime).apiBudgetStatus.cloudflare.blocked, true);
	runtime.usage.apiSpending.cloudflare = { complete: false, spentUsd: 3 };
	assert.equal(resolveModels(cfg, undefined, null, runtime).apiBudgetStatus.cloudflare.blocked, true);
	cfg.apiBudgets.cloudflare.monthlyUsd = -1;
	assert.throws(() => resolveModels(cfg), /non-negative/);
});

test("Anthropic API budget caps OpenCode anthropic/* without touching the Claude subscription", () => {
	const catalog = [
		{ providerInstanceId: "claudeAgent", id: "claude-sonnet-5-5", label: "Sonnet", billing: "subscription", reasoningOptions: ["medium"] },
		{ providerInstanceId: "opencode", id: "anthropic/claude-sonnet-5-5", label: "Sonnet API", billing: "api", reasoningOptions: ["medium"] },
	];
	const cfg = { ...config, budget: { ...config.budget, blockApiSubproviders: [] }, models: ["claude:all", "opencode:anthropic/*"], apiBudgets: { anthropic: { monthlyUsd: 100 } } };
	const runtime = { usage: { apiSpending: { anthropic: { complete: true, spentUsd: 40 } } } };
	let result = resolveModels(cfg, catalog, ["opencode"], runtime);
	assert.equal(result.apiBudgetStatus.anthropic.blocked, false);
	assert.ok(result.models.some((m) => m.id === "anthropic/claude-sonnet-5-5"));
	runtime.usage.apiSpending.anthropic.spentUsd = 100;
	result = resolveModels(cfg, catalog, null, runtime);
	assert.equal(result.apiBudgetStatus.anthropic.reason, "monthly budget reached");
	assert.ok(!result.models.some((m) => m.id.startsWith("anthropic/")));
	assert.ok(result.models.some((m) => m.id === "claude-sonnet-5-5"), "subscription stays available");
	assert.throws(() => resolveModels({ ...cfg, apiBudgets: { openai: { monthlyUsd: 1 } } }, catalog), /Unknown apiBudgets provider: openai/);
});

test("speed settings produce explicit role-specific dispatch options", () => {
	for (const speed of ["standard", "fast"]) {
		const result = resolveModels({ ...config, speed });
		assert.deepEqual(result.recommended.coordinator.options, { reasoningEffort: "medium", serviceTier: speed === "standard" ? "default" : "priority" });
		assert.deepEqual(result.recommended.crossFamilyReviewer.options, { effort: "high", fastMode: speed === "fast" });
		const sonnet = result.tiers.workhorse.find((m) => m.id.includes("sonnet"));
		assert.deepEqual(sonnet.options, { effort: "medium" });
	}
	assert.throws(() => resolveModels({ ...config, speed: "turbo" }), /speed/);
});

test("Claude live quota handles current windows, auth errors and unavailable credentials safely", async (t) => {
	const home = tempHome(t);
	const now = Date.now();
	writeJson(path.join(home, ".claude", ".credentials.json"), { claudeAiOauth: { accessToken: "fixture-token", expiresAt: now + 60_000 } });
	const read = await readClaudeQuota(home, async (url, request) => {
		assert.equal(url, "https://api.anthropic.com/api/oauth/usage");
		assert.equal(request.headers.Authorization, "Bearer fixture-token");
		return { ok: true, json: async () => ({ five_hour: { utilization: 100, resets_at: new Date(now + 3600_000).toISOString() }, seven_day: { utilization: 23, resets_at: new Date(now + 86400_000).toISOString() } }) };
	}, now);
	assert.equal(read.usedPercent, 23);
	assert.equal(read.windows[0].usedPercent, 100);
	assert.equal(read.eventTsMs, now);
	const failed = await readClaudeQuota(home, async () => ({ ok: false, status: 401 }), now);
	assert.match(failed.error, /HTTP 401/);
	assert.ok(!JSON.stringify(failed).includes("fixture-token"));
	assert.ok((await readClaudeQuota(home, async () => { throw new Error("fixture-token"); }, now)).error);
	const limited = await readClaudeQuota(home, async () => ({ ok: false, status: 429 }), now + 30_000);
	assert.equal(limited.usedPercent, 23, "429 reuses the last reading");
	assert.equal(limited.eventTsMs, now, "reused reading keeps its original observed time");
	writeJson(path.join(home, ".config", "task-router", "claude-quota.json"), { ...limited, eventTsMs: now - 16 * 60_000 });
	assert.match((await readClaudeQuota(home, async () => ({ ok: false, status: 429 }), now)).error, /HTTP 429/, "stale reading is not reused");
	fs.unlinkSync(path.join(home, ".claude", ".credentials.json"));
	assert.ok((await readClaudeQuota(home)).error);
});

test("newest supported T3 cache includes tail rows, creation tokens and deduplicates messages", (t) => {
	const home = tempHome(t);
	const now = Date.now();
	const dir = path.join(home, ".t3", "userdata");
	const row = [now - 1, 0, 0, 2, 100, 10, 5, 0, "same-message", null, 0];
	writeJson(path.join(dir, "usage-scan-cache-v5.json"), { models: ["claude-sonnet-5-5"], files: { old: { p: "claude", r: [row, row] } } });
	writeJson(path.join(dir, "usage-scan-cache-v9.json"), { models: ["claude-sonnet-5-5"], files: { a: { p: "claude", r: [row], t: [[now, 0, 0, 1, 20, 0, 3, 0, "tail", null, 0]] }, b: { p: "claude", r: [row] } } });
	const usage = scanUsageTelemetry(home, now);
	assert.equal(usage.byProvider.claudeAgent.turns7d, 2);
	assert.equal(usage.byProvider.claudeAgent.inTok7d, 13);
	assert.equal(usage.byProvider.claudeAgent.tokens7d, 141);
});

test("Codex telemetry retains the short window alongside the weekly window", (t) => {
	const home = tempHome(t);
	const now = Date.now();
	const dir = path.join(home, ".codex", "sessions");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "test.jsonl"), JSON.stringify({ timestamp: new Date(now).toISOString(), payload: { rate_limits: { primary: { used_percent: 100, window_minutes: 300, resets_at: now / 1000 + 300 }, secondary: { used_percent: 8, window_minutes: 10080, resets_at: now / 1000 + 86400 } } } }));
	const limit = findLatestCodexRateLimits(home, [], now);
	assert.equal(limit.usedPercent, 8);
	assert.equal(limit.windows.length, 2);
	assert.equal(resolveModels(config, undefined, null, { usage: { liveRateLimits: { codex: limit } } }).quotaStatus.codex.blocked, true);
});

test("Codex rejection expires with its own window rather than the weekly reset", (t) => {
	const home = tempHome(t);
	const now = Date.now();
	const dir = path.join(home, ".codex", "sessions");
	fs.mkdirSync(dir, { recursive: true });
	const event = { timestamp: new Date(now - 1000).toISOString(), payload: { rate_limits: {
		rate_limit_reached_type: "primary",
		primary: { used_percent: 100, window_minutes: 300, resets_at: now / 1000 - 1 },
		secondary: { used_percent: 23, window_minutes: 10080, resets_at: now / 1000 + 86400 },
	} } };
	const file = path.join(dir, "test.jsonl");
	fs.writeFileSync(file, JSON.stringify(event));
	let limit = findLatestCodexRateLimits(home, [], now);
	assert.equal(limit.rateLimitResetsAtSec, event.payload.rate_limits.primary.resets_at);
	assert.equal(resolveModels(config, undefined, null, { usage: { liveRateLimits: { codex: limit } } }).quotaStatus.codex.blocked, false);
	const creditLimit = { ...limit, usedPercent: 97, hasCredits: true, creditsBalance: 10 };
	const creditResult = resolveModels(config, undefined, null, { usage: { liveRateLimits: { codex: creditLimit } } });
	assert.equal(creditResult.quotaStatus.codex.hasCreditHeadroom, true);
	assert.equal(creditResult.quotaStatus.codex.throttled, false);
	event.payload.rate_limits.primary.resets_at = now / 1000 + 60;
	fs.writeFileSync(file, JSON.stringify(event));
	limit = findLatestCodexRateLimits(home, [], now);
	assert.equal(resolveModels(config, undefined, null, { usage: { liveRateLimits: { codex: limit } } }).quotaStatus.codex.blocked, true);
});

test("CLI plan overrides control Claude quota acquisition before routing", (t) => {
	const home = tempHome(t);
	const now = Date.now();
	writeJson(path.join(home, ".config", "task-router", "user.json"), { plans: { claude: 0 } });
	writeJson(path.join(home, ".claude", ".credentials.json"), { claudeAiOauth: { accessToken: "fixture-token", expiresAt: now + 60_000 } });
	const mock = path.join(home, "mock-fetch.mjs");
	fs.writeFileSync(mock, `globalThis.fetch = async () => ({ok:true,json:async()=>(${JSON.stringify({ five_hour: { utilization: 100, resets_at: new Date(now + 3600_000).toISOString() }, seven_day: { utilization: 23, resets_at: new Date(now + 86400_000).toISOString() } })})});`);
	const result = JSON.parse(execFileSync(process.execPath, ["--import", mock, new URL("../scripts/resolve-models.mjs", import.meta.url).pathname, "--plan", "claude=100", "--json"], { env: { ...process.env, HOME: home }, encoding: "utf8" }));
	assert.equal(result.plans.claudeAgent, 100);
	assert.equal(result.quotaStatus.claudeAgent.percentUsed, 23);
	assert.equal(result.quotaStatus.claudeAgent.blocked, true);
	assert.ok(result.models.every((m) => m.providerInstanceId !== "claudeAgent"));
});

test("OpenCode calendar-month spending isolates Cloudflare and flags missing costs", (t) => {
	const home = tempHome(t);
	const now = Date.UTC(2026, 9, 23);
	const db = path.join(home, ".local", "share", "opencode", "opencode.db");
	fs.mkdirSync(path.dirname(db), { recursive: true });
	const messages = [
		{ role: "assistant", providerID: "cloudflare-workers-ai", modelID: "@cf/zai-org/glm-5.3", time: { created: now - 1 }, cost: 3 },
		{ role: "assistant", providerID: "google", modelID: "gemini-4-argon", time: { created: now - 1 }, cost: 50 },
		{ role: "assistant", providerID: "cloudflare-workers-ai", modelID: "@cf/zai-org/glm-5.3", time: { created: Date.UTC(2026, 8, 30) }, cost: 20 },
	];
	const insert = (message) => `INSERT INTO message VALUES ('${JSON.stringify(message).replaceAll("'", "''")}');`;
	execFileSync("sqlite3", [db, `CREATE TABLE message (data TEXT); ${messages.map(insert).join(" ")}`]);
	let usage = scanUsageTelemetry(home, now);
	assert.equal(usage.apiSpending.cloudflare.spentUsd, 3);
	assert.equal(usage.apiSpending.cloudflare.complete, true);
	assert.equal(usage.apiSpending.anthropic.spentUsd, 0);
	execFileSync("sqlite3", [db, insert({ ...messages[0], cost: undefined })]);
	usage = scanUsageTelemetry(home, now);
	assert.equal(usage.apiSpending.cloudflare.complete, false);
	assert.equal(usage.apiSpending.cloudflare.spentUsd, 3);
	assert.match(formatUsageReport({ usage }, resolveModels(config)), /unknown\/incomplete/);
});

test("plan overrides preserve explicit caps, while a CLI cap can replace them", () => {
	const cfg = { ...config, budget: { ...config.budget, weeklyLimitUsdEquivalent: { codex: 10 } } };
	const runtime = { usage: { byProvider: { codex: { usd7d: 20, tokens7d: 100 } } } };
	const result = resolveModels(cfg, undefined, null, runtime, { plans: { openai: 100 } });
	assert.equal(result.plans.codex, 100);
	assert.equal(result.quotaStatus.codex.weeklyLimit, 10);
	assert.equal(result.quotaStatus.codex.blocked, true);
	const replaced = resolveModels(cfg, undefined, null, runtime, { plans: { openai: 100 }, weeklyLimits: { codex: 30 } });
	assert.equal(replaced.quotaStatus.codex.weeklyLimit, 30);
	assert.equal(replaced.quotaStatus.codex.blocked, false);
	const alias = resolveModels({ ...cfg, budget: { ...cfg.budget, weeklyLimitUsdEquivalent: { openai: 10 } } }, undefined, null, runtime, { plans: { openai: 100 } });
	assert.equal(alias.quotaStatus.codex.weeklyLimit, 10);
	assert.equal(alias.quotaStatus.codex.blocked, true);
	const aliasOverride = resolveModels(cfg, undefined, null, runtime, { weeklyLimits: { openai: 30 } });
	assert.equal(aliasOverride.quotaStatus.codex.weeklyLimit, 30);
	assert.equal(aliasOverride.quotaStatus.codex.blocked, false);
});

test("invalid CLI caps and plans fail instead of silently removing a restriction", () => {
	const script = new URL("../scripts/resolve-models.mjs", import.meta.url).pathname;
	const defaults = new URL("../model.json", import.meta.url).pathname;
	for (const args of [
		["--weekly-limit", "codex=garbage"], ["--weekly-limit", "codex=garbageM"],
		["--weekly-limit", "codex=-1"], ["--weekly-limit", "codex=Infinity"],
		["--weekly-limit", "codex=1G"], ["--weekly-limit", "codex=10,"],
		["--weekly-limit", "unknown=10"], ["--weekly-limit"],
		["--plan", "openai=garbage"], ["--plan", "openai=10M"], ["--plan"],
	]) {
		assert.throws(() => execFileSync(process.execPath, [script, "--config", defaults, "--static", "--json", ...args], { stdio: "pipe" }), (error) => error.status !== 0 && /requires|Invalid|unknown provider|monthly USD/.test(error.stderr.toString()), args.join(" "));
	}
	for (const limit of ["garbage", "garbageM", -1, Infinity, null]) {
		assert.throws(() => resolveModels({ ...config, budget: { ...config.budget, weeklyLimitUsdEquivalent: { codex: limit } } }), /Invalid weekly limit/);
	}
	assert.throws(() => resolveModels({ ...config, budget: { ...config.budget, weeklyLimitUsdEquivalent: { typo: 10 } } }), /Invalid weekly limit provider/);
	for (const caps of [10, false, [], null, "codex=10"]) {
		assert.throws(() => resolveModels({ ...config, budget: { ...config.budget, weeklyLimitUsdEquivalent: caps } }), /Weekly limits must be an object/);
		assert.throws(() => resolveModels(config, undefined, null, null, { weeklyLimits: caps }), /Weekly limits must be an object/);
	}
	const valid = JSON.parse(execFileSync(process.execPath, [script, "--config", defaults, "--static", "--json", "--weekly-limit", "codex=1.5M,claude=$12.50"], { encoding: "utf8" }));
	assert.equal(valid.quotaStatus.codex.weeklyLimit, "1.5M");
	assert.equal(valid.quotaStatus.claudeAgent.weeklyLimit, 12.5);
});

test("undated or invalid Cloudflare records make monthly spending incomplete", (t) => {
	const home = tempHome(t);
	const now = Date.now();
	const db = path.join(home, ".local", "share", "opencode", "opencode.db");
	fs.mkdirSync(path.dirname(db), { recursive: true });
	execFileSync("sqlite3", [db, "CREATE TABLE message (data TEXT);"]);
	for (const created of [undefined, null, "bad", 0, -1, now + 60_000]) {
		const message = { role: "assistant", providerID: "cloudflare-workers-ai", modelID: "@cf/zai-org/glm-5.3", time: { created }, cost: 50 };
		execFileSync("sqlite3", [db, `DELETE FROM message; INSERT INTO message VALUES ('${JSON.stringify(message)}');`]);
		const usage = scanUsageTelemetry(home, now);
		assert.equal(usage.apiSpending.cloudflare.complete, false, String(created));
		const result = resolveModels({ ...config, apiBudgets: { cloudflare: { monthlyUsd: 30 } } }, undefined, null, { usage });
		assert.equal(result.apiBudgetStatus.cloudflare.blocked, true);
		assert.equal(result.apiBudgetStatus.cloudflare.spentUsd, null);
	}
});

test("large OpenCode histories return complete per-model spending without buffer overflow", (t) => {
	const home = tempHome(t);
	const now = Date.now();
	const db = path.join(home, ".local", "share", "opencode", "opencode.db");
	fs.mkdirSync(path.dirname(db), { recursive: true });
	execFileSync("sqlite3", [db, `CREATE TABLE message (data TEXT);
		WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<15000)
		INSERT INTO message SELECT json_object('role','assistant','providerID','cloudflare-workers-ai',
		'modelID','@cf/deepseek-ai/deepseek-v4-flash-0731','time',json_object('created',${now - 1}),
		'tokens',json_object('input',10000,'output',1000,'cache',json_object('read',50000)),'cost',0.001) FROM n;`]);
	const usage = scanUsageTelemetry(home, now);
	assert.deepEqual(usage.warnings, []);
	assert.equal(usage.apiSpending.cloudflare.complete, true);
	assert.ok(Math.abs(usage.apiSpending.cloudflare.spentUsd - 15) < 1e-6);
	assert.equal(usage.byProvider.opencode.turns7d, 15000);
	assert.equal(usage.byProvider.opencode.tokens7d, 15000 * 61000);
	const result = resolveModels({ ...config, apiBudgets: { cloudflare: { monthlyUsd: 30 } } }, undefined, null, { usage });
	assert.equal(result.apiBudgetStatus.cloudflare.blocked, false);
});

test("Cloudflare charges survive missing model metadata", (t) => {
	const home = tempHome(t);
	const now = Date.now();
	const db = path.join(home, ".local", "share", "opencode", "opencode.db");
	fs.mkdirSync(path.dirname(db), { recursive: true });
	execFileSync("sqlite3", [db, "CREATE TABLE message (data TEXT);"]);
	for (const modelID of [undefined, null, "", "   "]) {
		const message = { role: "assistant", providerID: "cloudflare-workers-ai", modelID, time: { created: now - 1 }, cost: 50 };
		execFileSync("sqlite3", [db, `DELETE FROM message; INSERT INTO message VALUES ('${JSON.stringify(message)}');`]);
		const usage = scanUsageTelemetry(home, now);
		assert.equal(usage.apiSpending.cloudflare.spentUsd, 50);
		assert.equal(usage.apiSpending.cloudflare.complete, true);
		assert.equal(resolveModels({ ...config, apiBudgets: { cloudflare: { monthlyUsd: 30 } } }, undefined, null, { usage }).apiBudgetStatus.cloudflare.blocked, true);
	}
	for (const providerID of [undefined, null, "", "   ", "\t", "\n", false, 30, {}, []]) {
		const message = { role: "assistant", providerID, time: { created: now - 1 }, cost: 50 };
		execFileSync("sqlite3", [db, `DELETE FROM message; INSERT INTO message VALUES ('${JSON.stringify(message)}');`]);
		const usage = scanUsageTelemetry(home, now);
		assert.equal(usage.apiSpending.cloudflare.complete, false, JSON.stringify(providerID));
		assert.equal(resolveModels({ ...config, apiBudgets: { cloudflare: { monthlyUsd: 30 } } }, undefined, null, { usage }).apiBudgetStatus.cloudflare.blocked, true);
	}
});

test("malformed API budget maps cannot silently remove spending restrictions", () => {
	for (const apiBudgets of [null, 30, false, [], { cloudlfare: { monthlyUsd: 30 } },
		{ cloudflare: null }, { cloudflare: [] }, { cloudflare: 30 }, { cloudflare: {} },
		{ cloudflare: { monthlyUSD: 30 } }, { cloudflare: { monthlyUsd: "30" } },
		{ cloudflare: { monthlyUsd: NaN } }, { cloudflare: { monthlyUsd: Infinity } }]) {
		assert.throws(() => resolveModels({ ...config, apiBudgets }), /apiBudgets/);
	}
	assert.deepEqual(resolveModels(config).apiBudgetStatus, {});
	assert.deepEqual(resolveModels({ ...config, apiBudgets: {} }).apiBudgetStatus, {});
});

test("live T3 catalog replaces stale cached IDs and keeps advertised reasoning and harness limits", async (t) => {
	const { catalogFromCapabilities } = await import("../scripts/resolve-models.mjs");
	const id = "cloudflare-workers-ai/@cf/deepseek-ai/deepseek-v4.1-flash-1017";
	const capabilities = { providers: [
		{ providerInstanceId: "opencode", canRunChildTask: true, models: [{ id, options: [{ id: "variant", values: ["none", "low", "high", "max"] }] }] },
		{ providerInstanceId: "codex", canRunChildTask: false, models: [{ id: "gpt-6.1-sol" }] },
	] };
	const catalog = catalogFromCapabilities(capabilities);
	assert.equal(catalog.length, 1);
	for (const options of [undefined, [], [{ id: "reasoningEffort", values: [] }], [{ id: "reasoningEffort", values: [true] }]]) {
		assert.throws(() => catalogFromCapabilities({ providers: [{ providerInstanceId: "codex", canRunChildTask: true, models: [{ id: "gpt-6.1-sol", options }] }] }), /Catalog mismatch/);
	}
	const result = resolveModels(config, catalog);
	assert.deepEqual(result.models.map((m) => m.id), [id]);
	assert.equal(result.recommended.fastRecon.options.variant, "high");
	assert.deepEqual(resolveModels(config, catalog, ["codex"]).models, []);
	assert.throws(() => catalogFromCapabilities({}), /Catalog/);
	assert.throws(() => catalogFromCapabilities({ providers: [{}] }), /catalog provider/);
	assert.throws(() => catalogFromCapabilities({ providers: [{ ...capabilities.providers[0], models: [{ id: null }] }] }), /model ID/);
	const home = tempHome(t);
	const file = path.join(home, "catalog.json");
	writeJson(file, capabilities);
	const script = new URL("../scripts/resolve-models.mjs", import.meta.url).pathname;
	const defaults = new URL("../model.json", import.meta.url).pathname;
	const resolved = JSON.parse(execFileSync(process.execPath, [script, "--static", "--config", defaults, "--catalog", file, "--json"], { encoding: "utf8" }));
	assert.deepEqual(resolved.models.map((m) => m.id), [id]);
	assert.throws(() => execFileSync(process.execPath, [script, "--catalog"], { stdio: "pipe" }), /Command failed/);
});

test("weekly dollar caps block incomplete costs but preserve known zero and token caps", (t) => {
	const home = tempHome(t);
	const now = Date.now();
	const db = path.join(home, ".local", "share", "opencode", "opencode.db");
	fs.mkdirSync(path.dirname(db), { recursive: true });
	execFileSync("sqlite3", [db, "CREATE TABLE message (data TEXT);"]);
	const cfg = { ...config, budget: { ...config.budget, weeklyLimitUsdEquivalent: { opencode: 10 } } };
	const resolve = (usage, options) => resolveModels(cfg, undefined, ["opencode"], { usage }, options);
	assert.equal(resolve(null).quotaStatus.opencode.blocked, true);
	const empty = scanUsageTelemetry(home, now);
	assert.equal(resolve(empty).quotaStatus.opencode.blocked, false);
	const message = { role: "assistant", providerID: "cloudflare-workers-ai", modelID: "@cf/zai-org/glm-5.3", time: { created: now - 1 }, tokens: { input: 10, output: 0, cache: { read: 0 } } };
	execFileSync("sqlite3", [db, `INSERT INTO message VALUES ('${JSON.stringify(message)}');`]);
	let usage = scanUsageTelemetry(home, now);
	let result = resolve(usage);
	assert.equal(usage.byProvider.opencode.unknownCost7d, 1);
	assert.equal(result.quotaStatus.opencode.blocked, true);
	assert.equal(result.quotaStatus.opencode.spent7dUsd, null);
	assert.equal(result.quotaStatus.opencode.percentUsed, null);
	assert.deepEqual(result.models, []);
	assert.match(formatUsageReport({ usage }, result), /spending unknown\/incomplete/);
	assert.equal(resolve(usage, { weeklyLimits: { opencode: "1M" } }).quotaStatus.opencode.blocked, false);
	for (const cost of [0, 3, 10]) {
		execFileSync("sqlite3", [db, `UPDATE message SET data=json_set(data, '$.cost', ${cost});`]);
		usage = scanUsageTelemetry(home, now);
		result = resolve(usage);
		assert.equal(result.quotaStatus.opencode.spent7dUsd, cost);
		assert.equal(result.quotaStatus.opencode.blocked, cost >= 10);
	}
});

test("standalone discovery falls back for missing or invalid Codex caches but respects an empty valid cache", async (t) => {
	const { discoverRuntimeState } = await import("../scripts/resolve-models.mjs");
	const home = tempHome(t);
	const cache = path.join(home, ".codex", "models_cache.json");
	const resolve = () => {
		const runtime = discoverRuntimeState(home);
		return resolveModels(config, runtime.catalog, ["codex"], runtime);
	};
	assert.equal(resolve().recommended.coordinator.id, "gpt-6.1-sol");
	writeJson(cache, {});
	assert.equal(resolve().recommended.crossFamilyReviewer.id, "gpt-6-astra");
	fs.writeFileSync(cache, "{broken");
	assert.ok(resolve().models.length > 0);
	for (const model of [{}, { slug: "" }, { slug: "  " }, { slug: 30 }, null]) {
		writeJson(cache, { models: [{ slug: "cache-partial-model" }, model] });
		const result = resolve();
		assert.equal(result.recommended.coordinator.id, "gpt-6.1-sol");
		assert.ok(!result.models.some((m) => m.id === "cache-partial-model"));
	}
	writeJson(cache, { models: [] });
	assert.deepEqual(resolve().models, []);
	writeJson(cache, { models: [{ slug: "gpt-6-luna", visibility: "list", supported_reasoning_levels: [{ effort: "low" }] }] });
	assert.deepEqual(resolve().models.map((m) => m.id), ["gpt-6-luna"]);
	writeJson(path.join(home, ".t3", "userdata", "settings.json"), { providerInstances: { codex: { enabled: false } } });
	fs.unlinkSync(cache);
	assert.deepEqual(resolve().models, []);
});

test("unknown provider attribution only blocks months its charge could affect", (t) => {
	const home = tempHome(t);
	const now = Date.UTC(2026, 9, 23);
	const db = path.join(home, ".local", "share", "opencode", "opencode.db");
	fs.mkdirSync(path.dirname(db), { recursive: true });
	execFileSync("sqlite3", [db, "CREATE TABLE message (data TEXT);"]);
	for (const [created, cost, blocked] of [[Date.UTC(2026, 8, 15), 50, false], [Date.UTC(2026, 9, 1), 50, true], [now - 1, 0, false], [undefined, 50, true], [now - 1, undefined, true]]) {
		const message = { role: "assistant", modelID: "unknown-provider-model", cost, time: { created } };
		execFileSync("sqlite3", [db, `DELETE FROM message; INSERT INTO message VALUES ('${JSON.stringify(message)}');`]);
		const usage = scanUsageTelemetry(home, now);
		assert.equal(resolveModels({ ...config, apiBudgets: { cloudflare: { monthlyUsd: 30 } } }, undefined, null, { usage }).apiBudgetStatus.cloudflare.blocked, blocked, JSON.stringify(message));
	}
});

test("live dispatch validates speed options for every recommended role", async () => {
	const { catalogFromCapabilities } = await import("../scripts/resolve-models.mjs");
	for (const [providerInstanceId, id, effortId, speedId, standard, fast] of [
		["codex", "gpt-6.1-sol", "reasoningEffort", "serviceTier", "default", "priority"],
		["claudeAgent", "claude-opus-5-5", "effort", "fastMode", false, true],
	]) {
		const options = [{ id: effortId, values: ["low", "medium", "high"] }, { id: speedId, values: [standard] }];
		const resolve = (speed) => resolveModels({ ...config, speed }, catalogFromCapabilities({ providers: [{ providerInstanceId, canRunChildTask: true, models: [{ id, options }] }] }));
		let result = resolve("standard");
		assert.ok(Object.values(result.recommended).filter(Boolean).every((m) => m.options[speedId] === standard));
		assert.throws(() => resolve("fast"), /Catalog mismatch/);
		options[1].values.push(fast);
		result = resolve("fast");
		assert.ok(Object.values(result.recommended).filter(Boolean).every((m) => m.options[speedId] === fast));
		options.pop();
		assert.throws(() => resolve("standard"), /Catalog mismatch/);
	}
});

test("semantic Codex rejection labels follow window duration regardless of position", (t) => {
	const home = tempHome(t);
	const now = Date.now();
	const file = path.join(home, ".codex", "sessions", "swapped.jsonl");
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const weekly = { used_percent: 100, window_minutes: 10080, resets_at: now / 1000 + 86400 };
	const short = { used_percent: 10, window_minutes: 300, resets_at: now / 1000 - 1 };
	const read = (type, primary, secondary) => {
		fs.writeFileSync(file, JSON.stringify({ timestamp: new Date(now - 1000).toISOString(), payload: { rate_limits: {
			rate_limit_reached_type: type, primary, secondary, credits: { has_credits: true, balance: 10 },
		} } }));
		return findLatestCodexRateLimits(home, [], now);
	};
	for (const type of ["weekly", "seven_day", "7d"]) {
		for (const [primary, secondary] of [[weekly, short], [short, weekly]]) {
			const limit = read(type, primary, secondary);
			assert.equal(limit.rateLimitResetsAtSec, weekly.resets_at);
			const result = resolveModels(config, undefined, ["codex"], { usage: { liveRateLimits: { codex: limit } } });
			assert.equal(result.quotaStatus.codex.hasCreditHeadroom, false);
			assert.equal(result.quotaStatus.codex.blocked, true);
			assert.deepEqual(result.models, []);
		}
	}
	for (const type of ["five_hour", "5h", "short"]) {
		const limit = read(type, weekly, short);
		assert.equal(limit.rateLimitResetsAtSec, short.resets_at);
		const result = resolveModels(config, undefined, ["codex"], { usage: { liveRateLimits: { codex: limit } } });
		assert.equal(result.quotaStatus.codex.hasCreditHeadroom, true);
		assert.equal(result.quotaStatus.codex.blocked, false);
		const currentShort = read(type, { ...weekly, used_percent: 10 }, { ...short, used_percent: 100, resets_at: now / 1000 + 60 });
		assert.equal(resolveModels(config, undefined, ["codex"], { usage: { liveRateLimits: { codex: currentShort } } }).quotaStatus.codex.blocked, true);
	}
	assert.equal(read("primary", weekly, short).rateLimitResetsAtSec, weekly.resets_at);
	assert.equal(read("secondary", weekly, short).rateLimitResetsAtSec, short.resets_at);
	const unknown = read("weekly", short, null);
	assert.equal(unknown.rateLimitResetsAtSec, null);
	assert.equal(resolveModels(config, undefined, ["codex"], { usage: { liveRateLimits: { codex: unknown } } }).quotaStatus.codex.blocked, true);
});

test("custom token caps require measured totals and preserve known zero", () => {
	for (const tokens7d of [undefined, null, NaN, Infinity, -1, "0"]) {
		const runtime = { usage: { byProvider: { codex: { tokens7d } } } };
		const result = resolveModels(config, undefined, ["codex"], runtime, { weeklyLimits: { codex: "1M" } });
		assert.equal(result.quotaStatus.codex.tokensIncomplete, true);
		assert.equal(result.quotaStatus.codex.tokens7dM, null);
		assert.equal(result.quotaStatus.codex.percentUsed, null);
		assert.deepEqual(result.models, []);
		assert.match(formatUsageReport(runtime, result), /token usage unknown\/incomplete/);
	}
	assert.deepEqual(resolveModels(config, undefined, ["codex"], null, { weeklyLimits: { codex: "1M" } }).models, []);
	for (const tokens7d of [0, 999999, 1000000]) {
		const result = resolveModels(config, undefined, ["codex"], { usage: { byProvider: { codex: { tokens7d } } } }, { weeklyLimits: { codex: "1M" } });
		assert.equal(result.quotaStatus.codex.tokensIncomplete, false);
		assert.equal(result.quotaStatus.codex.blocked, tokens7d >= 1000000);
	}
});

test("raw OpenCode validation keeps cost and token completeness independent", (t) => {
	const home = tempHome(t);
	const now = Date.now();
	const db = path.join(home, ".local", "share", "opencode", "opencode.db");
	fs.mkdirSync(path.dirname(db), { recursive: true });
	execFileSync("sqlite3", [db, "CREATE TABLE message (data TEXT);"]);
	const base = { role: "assistant", providerID: "cloudflare-workers-ai", modelID: "@cf/zai-org/glm-5.3", time: { created: now - 1 }, cost: 0, tokens: { input: 0, output: 0, cache: { read: 0 } } };
	const scan = (messages) => {
		execFileSync("sqlite3", [db, `DELETE FROM message; ${messages.map((message) => `INSERT INTO message VALUES ('${JSON.stringify(message)}');`).join(" ")}`]);
		return scanUsageTelemetry(home, now);
	};
	const resolve = (usage, limit, monthly = false) => resolveModels({ ...config, ...(monthly ? { apiBudgets: { cloudflare: { monthlyUsd: 30 } } } : {}) }, undefined, ["opencode"], { usage }, { weeklyLimits: { opencode: limit } });
	for (const cost of [undefined, null, false, true, "0", "bad", -1, {}, []]) {
		const usage = scan([{ ...base, cost }]);
		assert.equal(usage.byProvider.opencode.unknownCost7d, 1, JSON.stringify(cost));
		assert.equal(usage.byProvider.opencode.unknownTokens7d, 0);
		assert.equal(usage.apiSpending.cloudflare.complete, false);
		assert.deepEqual(resolve(usage, 10).models, []);
		const tokenResult = resolve(usage, "1M");
		assert.ok(tokenResult.models.length > 0);
		assert.equal(tokenResult.quotaStatus.opencode.spendingIncomplete, true);
		assert.equal(tokenResult.quotaStatus.opencode.spent7dUsd, null);
		for (const report of [formatMarkdown(tokenResult), formatUsageReport({ usage }, tokenResult)]) {
			assert.match(report, /0M tok \/ 1M \(spending unknown\/incomplete eq\)/);
			assert.ok(!report.includes("($0 eq)"));
		}
		assert.deepEqual(resolve(usage, "1M", true).models, []);
	}
	for (const counter of [undefined, null, false, true, "0", "bad", -1, {}, []]) {
		for (const field of ["input", "output", "cacheRead"]) {
			const tokens = { ...base.tokens, cache: { read: 0 } };
			if (field === "cacheRead") tokens.cache.read = counter;
			else tokens[field] = counter;
			const usage = scan([{ ...base, tokens }]);
			assert.equal(usage.byProvider.opencode.unknownTokens7d, 1, `${field}:${JSON.stringify(counter)}`);
			assert.equal(usage.byProvider.opencode.unknownCost7d, 0);
			assert.equal(usage.apiSpending.cloudflare.complete, true);
			assert.deepEqual(resolve(usage, "1M", true).models, []);
			const dollarResult = resolve(usage, 10, true);
			assert.ok(dollarResult.models.length > 0);
			assert.equal(dollarResult.quotaStatus.opencode.tokensIncomplete, true);
			assert.equal(dollarResult.quotaStatus.opencode.tokens7dM, null);
			for (const report of [formatMarkdown(dollarResult), formatUsageReport({ usage }, dollarResult)]) {
				assert.match(report, /\$0 \/ \$10 custom eq cap \(token usage unknown\/incomplete\)/);
				assert.ok(!report.includes("(0M tok)"));
			}
			assert.match(formatUsageReport({ usage }, resolve(usage, 10)), /token usage incomplete/);
		}
	}
	let usage = scan([{ ...base, tokens: undefined }]);
	assert.deepEqual(resolve(usage, "1M").models, []);
	usage = scan([base]);
	assert.equal(usage.byProvider.opencode.tokens7d, 0);
	assert.ok(resolve(usage, "1M", true).models.length > 0);
	usage = scan([{ ...base, cost: 1e308 }, { ...base, cost: 1e308 }]);
	assert.notEqual(usage.apiSpending.cloudflare?.complete, true);
	assert.deepEqual(resolve(usage, 10, true).models, []);
	usage = scan([{ ...base, tokens: { input: 1e308, output: 1e308, cache: { read: 0 } } }]);
	assert.ok(usage.byProvider.opencode?.unknownTokens7d || usage.warnings.length);
	assert.deepEqual(resolve(usage, "1M").models, []);
});

test("raw usage completeness follows periods and survives mixed-model aggregation", (t) => {
	const home = tempHome(t);
	const now = Date.UTC(2026, 9, 23);
	const db = path.join(home, ".local", "share", "opencode", "opencode.db");
	fs.mkdirSync(path.dirname(db), { recursive: true });
	execFileSync("sqlite3", [db, "CREATE TABLE message (data TEXT);"]);
	const valid = { role: "assistant", providerID: "cloudflare-workers-ai", modelID: "@cf/zai-org/glm-5.3", time: { created: now - 1 }, cost: 3, tokens: { input: 5, output: 5, cache: { read: 0 } } };
	for (const [created, weeklyUnknown, monthUnknown] of [[now - 2, true, true], [now - 8 * 86400000, false, true], [Date.UTC(2026, 8, 1), false, false], [undefined, true, true], [true, true, true]]) {
		const invalid = { ...valid, modelID: "@cf/zai-org/glm-5.3-flash", cost: false, tokens: undefined, time: { created } };
		execFileSync("sqlite3", [db, `DELETE FROM message; INSERT INTO message VALUES ('${JSON.stringify(valid)}'), ('${JSON.stringify(invalid)}');`]);
		const usage = scanUsageTelemetry(home, now);
		assert.equal(usage.byProvider.opencode.unknownTokens7d, Number(weeklyUnknown));
		assert.equal(usage.byProvider.opencode.unknownCost7d, Number(weeklyUnknown));
		assert.equal(usage.apiSpending.cloudflare.complete, !monthUnknown);
		assert.equal(usage.apiSpending.cloudflare.spentUsd, 3);
		for (const limit of [10, "1M"]) {
			const result = resolveModels(config, undefined, ["opencode"], { usage }, { weeklyLimits: { opencode: limit } });
			assert.equal(result.quotaStatus.opencode.blocked, weeklyUnknown);
		}
	}
});

test("T3 malformed records retain later usage and block caps on partial totals", (t) => {
	const home = tempHome(t);
	const now = Date.now();
	const cache = path.join(home, ".t3", "userdata", "usage-scan-cache-v9.json");
	const row = (id, input = 1, ts = now - 1) => [ts, 0, 0, input, 0, 0, 0, 0, id];
	const scan = (files) => {
		writeJson(cache, { models: ["gpt-6.1-sol"], files });
		return scanUsageTelemetry(home, now);
	};
	for (const bad of [null, {}, [], row("bad", "0"), row("bad", false), row("bad", -1), row("bad", null), row("bad", 1, true), row("bad", 1, now + 1), [now - 1, 99, 0, 0, 0, 0, 0]]) {
		const usage = scan({ session: { p: "codex", r: [row("first"), bad], t: [row("large", 5e6)] } });
		assert.equal(usage.byProvider.codex.turns7d, 2);
		assert.equal(usage.byProvider.codex.usd7d, 10.000002);
		assert.equal(usage.byProvider.codex.unknownCost7d, 1);
		assert.equal(usage.byProvider.codex.unknownTokens7d, 1);
		assert.match(usage.warnings.join(" "), /T3 usage incomplete/);
		for (const cap of [20, "10M"]) {
			const result = resolveModels(config, undefined, ["codex"], { usage }, { weeklyLimits: { codex: cap } });
			assert.deepEqual(result.models, []);
			for (const report of [formatMarkdown(result), formatUsageReport({ usage }, result)]) assert.match(report, /unknown\/incomplete/);
			const report = formatUsageReport({ usage }, result);
			assert.match(report, /Current 7d Codex API-equivalent cost:\*\* \*\*unknown\/incomplete/);
			assert.match(report, /Astra token volume used Sol instead:\*\* \*\*unavailable \(usage incomplete\)/);
		}
	}
	const usage = scan({ old: { p: "codex", r: [row("old-bad", -1, now - 8 * 86400000)] }, current: { p: "codex", r: [row("valid")] } });
	assert.equal(usage.byProvider.codex.unknownCost, 1);
	assert.ok(!usage.byProvider.codex.unknownCost7d);
	assert.ok(resolveModels(config, undefined, ["codex"], { usage }, { weeklyLimits: { codex: 20 } }).models.length > 0);
});

test("T3 damaged containers and newer cache failures cannot hide partial usage", (t) => {
	const home = tempHome(t);
	const now = Date.now();
	const dir = path.join(home, ".t3", "userdata");
	const cache = path.join(dir, "usage-scan-cache-v9.json");
	const row = [now - 1, 0, 0, 1, 0, 0, 0, 0, "good"];
	for (const badEntry of [null, { p: false }, { p: "unknown", r: [null] }, { p: "codxe", r: [row] }, { p: "__proto__" }, { p: "codex", r: {} }, { p: "codex", t: "bad" }]) {
		writeJson(cache, { models: ["gpt-6.1-sol"], files: { bad: badEntry, good: { p: "codex", r: [row] } } });
		const usage = scanUsageTelemetry(home, now);
		assert.equal(usage.byProvider.codex.turns7d, 1);
		assert.equal(usage.byProvider.codex.unknownCost7d, 1);
		assert.ok(usage.warnings.length);
		assert.deepEqual(resolveModels(config, undefined, ["codex"], { usage }, { weeklyLimits: { codex: "1M" } }).models, []);
	}
	writeJson(path.join(dir, "usage-scan-cache-v5.json"), { models: ["gpt-6.1-sol"], files: { good: { p: "codex", r: [row] } } });
	for (const content of ["{broken", "null", JSON.stringify({ models: [], files: [] })]) {
		fs.writeFileSync(cache, content);
		const usage = scanUsageTelemetry(home, now);
		assert.equal(usage.byProvider.codex.turns7d, 1);
		assert.equal(usage.byProvider.codex.unknownCost7d, 1);
		assert.deepEqual(resolveModels(config, undefined, ["codex"], { usage }, { weeklyLimits: { codex: 20 } }).models, []);
	}
});

test("T3 malformed dedupe keys cannot collide or abort later records", (t) => {
	const home = tempHome(t);
	const now = Date.now();
	const cache = path.join(home, ".t3", "userdata", "usage-scan-cache-v9.json");
	const row = (key, input) => [now - 1, 0, 0, input, 0, 0, 0, 0, key];
	for (const key of [{}, { toString: null }, [], false, "", "   "]) {
		writeJson(cache, { models: ["gpt-6.1-sol"], files: { session: { p: "codex", r: [row("first", 1), row(key, 5e6), row("large", 5e6)] } } });
		const usage = scanUsageTelemetry(home, now);
		assert.equal(usage.byProvider.codex.turns7d, 2);
		assert.equal(usage.byProvider.codex.usd7d, 10.000002);
		assert.equal(usage.byProvider.codex.unknownCost7d, 1);
		assert.deepEqual(resolveModels(config, undefined, ["codex"], { usage }, { weeklyLimits: { codex: 20 } }).models, []);
	}
	writeJson(cache, { models: ["gpt-6.1-sol"], files: { session: { p: "codex", r: [row(1, 1), row("1", 2), row(1, 1), row(null, 0)] } } });
	const usage = scanUsageTelemetry(home, now);
	assert.equal(usage.byProvider.codex.turns7d, 3);
	assert.equal(usage.byProvider.codex.tokens7d, 3);
	assert.deepEqual(usage.warnings, []);
});

test("T3 provider-only incompleteness suppresses pricing scenarios without poisoning known old dates", (t) => {
	const home = tempHome(t);
	const now = Date.now();
	const cache = path.join(home, ".t3", "userdata", "usage-scan-cache-v9.json");
	const row = (ts) => [ts, 0, 0, 1e6, 0, 0, 0, 0, "good"];
	for (const files of [
		{ bad: { p: "claude", r: [null] }, good: { p: "codex", r: [row(now - 1)] } },
		{ bad: { p: "codex", r: [null] } },
	]) {
		writeJson(cache, { models: ["gpt-6.1-sol"], files });
		const usage = scanUsageTelemetry(home, now);
		const result = resolveModels(config, undefined, null, { usage });
		const report = formatUsageReport({ usage }, result);
		assert.match(report, /Google API token-price scenario: unavailable \(token usage incomplete\)/);
		assert.ok(!/Google API token-price scenario: ~\$/.test(report));
	}
	writeJson(cache, { models: ["gpt-6.1-sol"], files: { old: { p: "unknown", r: [row(now - 8 * 86400000)] }, good: { p: "codex", r: [row(now - 1)] } } });
	const usage = scanUsageTelemetry(home, now);
	assert.ok(usage.byProvider.codex.unknownCost);
	assert.ok(!usage.byProvider.codex.unknownCost7d);
	assert.ok(resolveModels(config, undefined, ["codex"], { usage }, { weeklyLimits: { codex: 5 } }).models.length > 0);
});
