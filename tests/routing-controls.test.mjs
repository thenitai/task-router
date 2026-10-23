import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { readClaudeQuota, readProviderBlocks, recordProviderBlock, clearProviderBlock } from "../scripts/provider-quota.mjs";
import { resolveModels, scanUsageTelemetry, findLatestCodexRateLimits, formatUsageReport } from "../scripts/resolve-models.mjs";

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
	execFileSync("sqlite3", [db, insert({ ...messages[0], cost: undefined })]);
	usage = scanUsageTelemetry(home, now);
	assert.equal(usage.apiSpending.cloudflare.complete, false);
	assert.equal(usage.apiSpending.cloudflare.spentUsd, 3);
	assert.match(formatUsageReport({ usage }, resolveModels(config)), /unknown\/incomplete/);
});
