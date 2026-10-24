#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readClaudeQuota, readProviderBlocks, recordProviderBlock, clearProviderBlock } from "./provider-quota.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, "..");

const PROVIDER_ALIASES = {
	openai: "codex",
	codex: "codex",
	claude: "claudeAgent",
	anthropic: "claudeAgent",
	claudeagent: "claudeAgent",
	opencode: "opencode",
	google: "opencode",
};

export const PLAN_WEEKLY_CAPACITY_USD = {
	codex: { 20: 175, 200: 1750 },
	claudeAgent: { 20: 90, 100: 450, 200: 1500 },
};

export function planToWeeklyLimitUsd(providerInstanceId, monthlyPlanUsd) {
	const num = Number(String(monthlyPlanUsd).replace(/^\$/, ""));
	if (!num || Number.isNaN(num) || num <= 0) return 0;
	const table = PLAN_WEEKLY_CAPACITY_USD[providerInstanceId];
	if (table && table[num]) return table[num];
	return providerInstanceId === "codex" ? Math.round(num * 8.75) : Math.round(num * 4.5);
}

export const CANONICAL_MODELS = [
	{ providerInstanceId: "codex", id: "gpt-6-astra", label: "GPT-6-Astra", family: "openai", billing: "subscription", cost: { input: 10, output: 50, cacheRead: 1 }, tiers: ["frontier"], generation: "current", reasoningOptions: ["low", "medium", "high", "xhigh", "max", "ultra"], notes: "Heavy frontier (10x cache burn vs Sol) — reserve for bounded hard slices/review, avoid as coordinator" },
	{ providerInstanceId: "codex", id: "gpt-6.1-sol", label: "GPT-6.1-Sol", family: "openai", billing: "subscription", cost: { input: 2, output: 10, cacheRead: 0.1 }, tiers: ["workhorse", "long_context"], generation: "current", reasoningOptions: ["low", "medium", "high", "xhigh", "max", "ultra"], notes: "Primary subscription workhorse (500k context, $0.10/M cache read) — ideal Coordinator & Integrator" },
	{ providerInstanceId: "codex", id: "gpt-6-luna", label: "GPT-6-Luna", family: "openai", billing: "subscription", cost: { input: 0.1, output: 0.5, cacheRead: 0.01 }, tiers: ["fast"], generation: "current", reasoningOptions: ["low", "medium", "high", "xhigh", "max"], notes: "Ultra-low quota burn ($0.01/M cache read) — fast recon, search, and doc/config checks" },
	{ providerInstanceId: "codex", id: "gpt-6-sol", label: "GPT-6-Sol", family: "openai", billing: "subscription", cost: { input: 2, output: 10, cacheRead: 0.1 }, tiers: ["workhorse"], generation: "legacy", reasoningOptions: ["low", "medium", "high", "xhigh", "max", "ultra"], notes: "Superseded by gpt-6.1-sol" },
	{ providerInstanceId: "codex", id: "gpt-5.6-sol", label: "GPT-5.6-Sol", family: "openai", billing: "subscription", cost: { input: 2, output: 10, cacheRead: 0.1 }, tiers: ["workhorse"], generation: "legacy", reasoningOptions: ["low", "medium", "high", "xhigh", "max", "ultra"], notes: "Legacy 5.6 generation" },
	{ providerInstanceId: "codex", id: "gpt-5.6-terra", label: "GPT-5.6-Terra", family: "openai", billing: "subscription", cost: { input: 2, output: 10, cacheRead: 0.1 }, tiers: ["workhorse"], generation: "legacy", reasoningOptions: ["low", "medium", "high", "xhigh", "max", "ultra"], notes: "Legacy 5.6 generation" },
	{ providerInstanceId: "codex", id: "gpt-5.6-luna", label: "GPT-5.6-Luna", family: "openai", billing: "subscription", cost: { input: 0.1, output: 0.5, cacheRead: 0.01 }, tiers: ["fast"], generation: "legacy", reasoningOptions: ["low", "medium", "high", "xhigh", "max"], notes: "Legacy 5.6 generation" },
	{ providerInstanceId: "claudeAgent", id: "claude-opus-5-5", label: "Claude Opus 5.5", family: "anthropic", billing: "subscription", cost: { input: 4, output: 20, cacheRead: 0.2 }, tiers: ["frontier", "long_context"], generation: "current", reasoningOptions: ["low", "medium", "high", "xhigh", "max", "ultracode", "ultrathink"], notes: "Subscription frontier (2.5x cheaper than Astra) — ideal cross-family reviewer & complex refactors" },
	{ providerInstanceId: "claudeAgent", id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", family: "anthropic", billing: "subscription", cost: { input: 2, output: 10, cacheRead: 0.1 }, tiers: ["workhorse"], generation: "current", reasoningOptions: ["low", "medium", "high", "xhigh", "max", "ultrathink"], notes: "Subscription workhorse — ideal Coordinator, UI/Pug/SPA implementation, and browser testing" },
	{ providerInstanceId: "claudeAgent", id: "claude-haiku-5-5", label: "Claude Haiku 5.5", family: "anthropic", billing: "subscription", cost: { input: 0.1, output: 0.5, cacheRead: 0.01 }, tiers: ["fast"], generation: "current", reasoningOptions: ["low", "medium", "high", "xhigh", "max", "ultrathink"], notes: "Ultra-low quota burn — fast read-only exploration and narrow checks" },
	{ providerInstanceId: "claudeAgent", id: "claude-fable-5-1", label: "Claude Fable 5.1", family: "anthropic", billing: "subscription", cost: { input: 2, output: 10, cacheRead: 0.1 }, tiers: ["workhorse"], generation: "current", reasoningOptions: ["low", "medium", "high", "xhigh", "max", "ultracode", "ultrathink"], notes: "Specialized creative/writing model" },
	{ providerInstanceId: "claudeAgent", id: "claude-opus-5", label: "Claude Opus 5", family: "anthropic", billing: "subscription", cost: { input: 4, output: 20, cacheRead: 0.2 }, tiers: ["frontier"], generation: "legacy", reasoningOptions: ["low", "medium", "high", "xhigh", "max"], notes: "Superseded by claude-opus-5-5" },
	{ providerInstanceId: "claudeAgent", id: "claude-opus-4-8", label: "Claude Opus 4.8", family: "anthropic", billing: "subscription", cost: { input: 4, output: 20, cacheRead: 0.2 }, tiers: ["frontier"], generation: "legacy", reasoningOptions: ["low", "medium", "high", "xhigh", "max"], notes: "Superseded by claude-opus-5-5" },
	{ providerInstanceId: "opencode", id: "google/gemini-4-argon", label: "Gemini 4 Argon", family: "google", billing: "api", cost: { input: 2, output: 10, cacheRead: 0.1 }, tiers: ["frontier", "workhorse", "long_context"], generation: "current", reasoningOptions: ["low", "medium", "high"], notes: "Broad multi-file synthesis, long-context recon, and cross-family review" },
	{ providerInstanceId: "opencode", id: "opencode/gemini-3.8-flash", label: "Gemini 3.8 Flash", family: "google", billing: "api", cost: { input: 1.5, output: 7.5, cacheRead: 0.15 }, tiers: ["fast"], generation: "current", reasoningOptions: ["low", "medium", "high"], notes: "Fast search, doc checks, and lightweight tasks" },
	{ providerInstanceId: "opencode", id: "cloudflare-workers-ai/@cf/zai-org/glm-5.3", label: "GLM 5.3", family: "zai", billing: "api", cost: { input: 1.4, output: 4.4, cacheRead: 0.26 }, tiers: ["workhorse"], generation: "current", reasoningOptions: ["low", "high", "max"], notes: "Low-cost open-weight coding workhorse (1M context) — offloads subscription quota" },
	{ providerInstanceId: "opencode", id: "cloudflare-workers-ai/@cf/zai-org/glm-5.3-flash", label: "GLM 5.3 Flash", family: "zai", billing: "api", cost: { input: 0.15, output: 0.5, cacheRead: 0.03 }, tiers: ["fast"], generation: "current", reasoningOptions: ["low", "high", "max"], notes: "Ultra-cheap ($0.15/$0.50) open-weight recon and boilerplate" },
	{ providerInstanceId: "opencode", id: "opencode/kimi-k3", label: "Kimi K3", family: "moonshot", billing: "api", cost: { input: 1.5, output: 6, cacheRead: 0.15 }, tiers: ["long_context", "workhorse"], generation: "current", reasoningOptions: ["low", "high", "max"], notes: "Deep long-context codebase and log analysis" },
	{ providerInstanceId: "opencode", id: "cloudflare-workers-ai/@cf/deepseek-ai/deepseek-v4-pro-0813", label: "DeepSeek V4 Pro", family: "deepseek", billing: "api", cost: { input: 1.32, output: 3.96, cacheRead: 0.044 }, tiers: ["workhorse"], generation: "current", reasoningOptions: ["low", "high", "max"], notes: "Low-cost ($1.32/$3.96, $0.044 cache) backend/algorithmic workhorse — offloads subscription quota" },
	{ providerInstanceId: "opencode", id: "cloudflare-workers-ai/@cf/deepseek-ai/deepseek-v4-flash-0731", label: "DeepSeek V4 Flash", family: "deepseek", billing: "api", cost: { input: 0.44, output: 1.32, cacheRead: 0.014 }, tiers: ["fast"], generation: "current", reasoningOptions: ["low", "high", "max"], notes: "Cheap ($0.44/$1.32) algorithmic checks, unit tests, and mechanical edits" },
];

export function normalizeProvider(raw) {
	const key = String(raw || "").trim().toLowerCase();
	return PROVIDER_ALIASES[key] || raw;
}

export function globToRegExp(pattern) {
	const escaped = String(pattern).trim().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`, "i");
}

export function canonicalBaseKey(modelId) {
	const lower = String(modelId).toLowerCase();
	const leaf = lower.includes("/") ? lower.split("/").pop() : lower;
	return leaf.replace(/-free$/, "").replace(/-(0731|0813)$/, "").replace(/deepseek-v4\.1-flash/, "deepseek-v4-flash").replace(/\./g, "-");
}

export function matchesPattern(modelId, pattern) {
	const cleanPattern = String(pattern).trim().toLowerCase();
	const fullId = String(modelId).toLowerCase();
	const shortId = fullId.includes("/") ? fullId.split("/").pop() : fullId;
	const baseKey = canonicalBaseKey(modelId);
	const normalizedPat = cleanPattern.replace(/\./g, "-");
	if (cleanPattern === "all" || cleanPattern === "*") return true;
	if (cleanPattern.includes("*")) {
		const regex = globToRegExp(cleanPattern);
		const normRegex = globToRegExp(normalizedPat);
		return regex.test(fullId) || regex.test(shortId) || normRegex.test(baseKey);
	}
	return fullId === cleanPattern || shortId === cleanPattern || baseKey === normalizedPat || fullId.includes(cleanPattern) || shortId.includes(cleanPattern) || baseKey.includes(normalizedPat);
}

export function parseSelectRules(selectArray = []) {
	const rulesByProvider = new Map();
	for (const entry of selectArray) {
		const raw = String(entry || "").trim();
		if (!raw || !raw.includes(":")) continue;
		const colonIdx = raw.indexOf(":");
		const provider = normalizeProvider(raw.slice(0, colonIdx));
		const rhs = raw.slice(colonIdx + 1).trim();
		const tokens = rhs.split(",").map((t) => t.trim()).filter(Boolean);
		if (!rulesByProvider.has(provider)) rulesByProvider.set(provider, { includeAll: false, includes: [], excludes: [] });
		const bucket = rulesByProvider.get(provider);
		for (const token of tokens) {
			if (token.startsWith("!")) {
				bucket.excludes.push(token.slice(1).trim());
			} else if (token.toLowerCase() === "all" || token === "*") {
				bucket.includeAll = true;
			} else {
				bucket.includes.push(token);
			}
		}
	}
	return rulesByProvider;
}

export function effectiveCostScore(model) {
	const c = model.cost || { input: 2, output: 10, cacheRead: 0.1 };
	return (c.input || 0) * 1 + (c.output || 0) * 0.25 + (c.cacheRead || 0) * 15;
}

export function gatewayPriority(modelId, providerInstanceId, runtimeState = {}) {
	if (providerInstanceId === "codex" || providerInstanceId === "claudeAgent") return 1;
	const favSet = runtimeState.favorites || new Set();
	if (favSet.has(`${providerInstanceId}:${modelId}`) || favSet.has(modelId)) return 2;
	const orderIdx = runtimeState.modelOrder?.get(modelId);
	if (typeof orderIdx === "number") return 3 + Math.min(orderIdx, 50) / 100;
	const lower = String(modelId).toLowerCase();
	if (lower.endsWith("-free")) return 9;
	if (lower.startsWith("cloudflare-workers-ai/")) return 4;
	if (lower.startsWith("google/") || lower.startsWith("anthropic/") || lower.startsWith("openai/")) return 5;
	if (lower.startsWith("cloudflare-ai-gateway/")) return 6;
	if (lower.startsWith("opencode/")) return 7;
	if (lower.startsWith("github-copilot/")) return 8;
	return 7;
}

export function classifyModel(model) {
	const known = CANONICAL_MODELS.find((c) => canonicalBaseKey(c.id) === canonicalBaseKey(model.id));
	const billing = model.billing || (model.providerInstanceId === "codex" || model.providerInstanceId === "claudeAgent" ? "subscription" : "api");
	if (known) {
		return {
			...known,
			providerInstanceId: model.providerInstanceId || known.providerInstanceId,
			id: model.id,
			label: model.label || known.label,
			billing,
			cost: model.cost || known.cost,
			reasoningOptions: model.reasoningOptions?.length ? model.reasoningOptions : known.reasoningOptions,
			...(model.liveOptions && { liveOptions: model.liveOptions }),
		};
	}
	const lower = String(model.id).toLowerCase();
	const family = lower.includes("gpt") ? "openai" : lower.includes("claude") ? "anthropic" : lower.includes("gemini") || lower.includes("gemma") ? "google" : lower.includes("glm") ? "zai" : lower.includes("kimi") ? "moonshot" : lower.includes("deepseek") ? "deepseek" : "other";
	const isLegacy = /gpt-5\.|gpt-6-sol$|claude-opus-4|claude-opus-5$|claude-sonnet-4|claude-sonnet-5$|claude-haiku-4|glm-4|glm-5\.2|glm-5\.1|glm-5$|kimi-k2|deepseek-r1|deepseek-v3|gemini-2\.|gemini-3\.[01567]/.test(lower);
	const tiers = lower.includes("astra") || lower.includes("opus") ? ["frontier"] : lower.includes("flash") || lower.includes("haiku") || lower.includes("luna") || lower.includes("mini") || lower.includes("nano") || lower.includes("lite") ? ["fast"] : lower.includes("kimi") ? ["long_context", "workhorse"] : ["workhorse"];
	return {
		providerInstanceId: model.providerInstanceId,
		id: model.id,
		label: model.label || model.id,
		family,
		billing,
		cost: model.cost || { input: 2, output: 10, cacheRead: 0.1 },
		tiers,
		generation: isLegacy ? "legacy" : "current",
		reasoningOptions: model.reasoningOptions || ["low", "medium", "high"],
		...(model.liveOptions && { liveOptions: model.liveOptions }),
		notes: "",
	};
}

export function pickReasoning(desired, options = []) {
	if (!options || options.length === 0) return desired || "medium";
	if (options.includes(desired)) return desired;
	const fallbackOrder = desired === "high" ? ["high", "xhigh", "max", "medium", "low"] : desired === "medium" ? ["medium", "high", "low"] : ["low", "medium", "high"];
	for (const candidate of fallbackOrder) {
		if (options.includes(candidate)) return candidate;
	}
	return options[0];
}

export function findLatestCodexRateLimits(homeDir = os.homedir(), fallbackFiles = [], nowMs = Date.now()) {
	const walkJsonl = (dir, out = []) => {
		if (!fs.existsSync(dir)) return out;
		try {
			for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
				const p = path.join(dir, ent.name);
				if (ent.isDirectory()) walkJsonl(p, out);
				else if (ent.name.endsWith(".jsonl")) out.push(p);
			}
		} catch {}
		return out;
	};

	const candidates = new Set([
		...walkJsonl(path.join(homeDir, ".codex", "sessions")),
		...walkJsonl(path.join(homeDir, ".codex", "archived_sessions")),
		...fallbackFiles.filter((f) => fs.existsSync(f)),
	]);
	if (candidates.size === 0) return null;

	let best = null;
	for (const filePath of candidates) {
		try {
			for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
				if (!line.includes('"rate_limits"')) continue;
				try {
					const parsed = JSON.parse(line);
					const rl = parsed?.payload?.rate_limits;
					if (!rl) continue;
					// Model-specific limits must not replace the account-wide Codex quota.
					if (rl.limit_id && rl.limit_id !== "codex") continue;
					const eventTsMs = Date.parse(parsed.timestamp);
					if (!Number.isFinite(eventTsMs) || eventTsMs > nowMs) continue;
					if (best && eventTsMs <= best.eventTsMs) continue;
					const window = [rl.primary, rl.secondary].find((w) => w?.window_minutes === 10080);
					const windows = [rl.primary, rl.secondary].flatMap((w) => Number.isFinite(w?.used_percent) && w.used_percent >= 0 && w.used_percent <= 100
						&& Number.isFinite(w?.window_minutes) && w.window_minutes > 0 && w?.resets_at * 1000 > nowMs
						? [{ usedPercent: w.used_percent, windowMinutes: w.window_minutes, resetsAtSec: w.resets_at }] : []);
					const resetsAtSec = window?.resets_at;
					const valid = Number.isFinite(window?.used_percent) && window.used_percent >= 0 && window.used_percent <= 100
						&& Number.isFinite(resetsAtSec) && resetsAtSec * 1000 > nowMs;
					const balance = rl.credits?.balance;
					const rawBalance = typeof balance === "number" || (typeof balance === "string" && balance.trim()) ? Number(balance) : NaN;
					const rejectionType = String(rl.rate_limit_reached_type || "").toLowerCase();
					const rejectedWindows = /primary/.test(rejectionType) ? [rl.primary]
						: /secondary/.test(rejectionType) ? [rl.secondary]
						: /five|5h|short/.test(rejectionType) ? [rl.primary, rl.secondary].filter((w) => w?.window_minutes === 300)
						: /seven|7d|week/.test(rejectionType) ? [rl.primary, rl.secondary].filter((w) => w?.window_minutes === 10080)
						: [rl.primary, rl.secondary].filter((w) => w?.used_percent >= 100);
					const rejectionResets = rl.spend_control_reached ? [] : rejectedWindows.map((w) => w?.resets_at).filter(Number.isFinite);
					best = {
						planType: rl.plan_type || null,
						windows,
						usedPercent: valid ? window.used_percent : null,
						windowMinutes: window?.window_minutes ?? null,
						resetsAtSec: Number.isFinite(resetsAtSec) ? resetsAtSec : null,
						windowStartMs: valid ? (resetsAtSec - window.window_minutes * 60) * 1000 : null,
						hasCredits: rl.credits?.has_credits === true,
						creditsBalance: Number.isFinite(rawBalance) && rawBalance >= 0 ? rawBalance : null,
						rateLimitReached: Boolean(rl.rate_limit_reached_type || rl.spend_control_reached),
						rateLimitResetsAtSec: rejectionResets.length ? Math.max(...rejectionResets) : null,
						eventTsMs,
						sourceFile: filePath,
					};
				} catch {}
			}
		} catch {}
	}
	return best;
}

export function scanUsageTelemetry(homeDir = os.homedir(), nowMs = Date.now()) {
	const usageDir = path.join(homeDir, ".t3", "userdata");
	const usagePaths = [9, 8, 7, 6, 5].map((version) => path.join(usageDir, `usage-scan-cache-v${version}.json`));
	const sevenDaysAgo = nowMs - 7 * 86400 * 1000;
	const thirtyDaysAgo = nowMs - 30 * 86400 * 1000;
	const byProvider = {};
	const byModel = {};
	const liveRateLimits = {};
	const existingCodexFiles = [];
	const apiSpending = {};
	const warnings = [];
	const monthStartMs = Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), 1);

	const cacheProblems = new Map();
	let invalidCacheRecords = 0;
	const noteCacheProblem = (prov = null, ts = null) => {
		invalidCacheRecords++;
		for (const provider of prov ? [prov] : ["codex", "claudeAgent", "opencode"]) {
			cacheProblems.set(provider, cacheProblems.get(provider) || ts === null || ts >= sevenDaysAgo);
		}
	};
	let cachedUsage = null;
	for (const usagePath of usagePaths) {
		if (!fs.existsSync(usagePath)) continue;
		try {
			cachedUsage = JSON.parse(fs.readFileSync(usagePath, "utf8"));
			if (!cachedUsage || !cachedUsage.files || typeof cachedUsage.files !== "object" || Array.isArray(cachedUsage.files) || !Array.isArray(cachedUsage.models)) throw new Error("Invalid usage cache");
			for (const [filePath, fileEntry] of Object.entries(cachedUsage.files || {})) {
				if (fileEntry?.p === "codex" && fs.existsSync(filePath)) existingCodexFiles.push(filePath);
			}
			break;
		} catch {
			cachedUsage = null;
			noteCacheProblem();
			warnings.push(`Cannot read usage cache ${usagePath}`);
		}
	}
	const codexLive = findLatestCodexRateLimits(homeDir, existingCodexFiles, nowMs);
	if (codexLive) liveRateLimits.codex = codexLive;
	if (cachedUsage) {
		const data = cachedUsage;
		const codexWindowStartMs = codexLive?.windowStartMs ? Math.max(sevenDaysAgo, codexLive.windowStartMs) : sevenDaysAgo;
		const seen = new Set();

		for (const [, fileEntry] of Object.entries(data.files || {})) {
			if (!fileEntry || typeof fileEntry !== "object" || Array.isArray(fileEntry)) { noteCacheProblem(); continue; }
			const normalized = typeof fileEntry.p === "string" ? normalizeProvider(fileEntry.p) : null;
			const prov = ["codex", "claudeAgent", "opencode"].includes(normalized) ? normalized : null;
			const rows = [];
			for (const field of ["r", "t"]) {
				if (fileEntry[field] === undefined) continue;
				if (Array.isArray(fileEntry[field])) {
					for (const row of fileEntry[field]) rows.push(row);
				}
				else noteCacheProblem(prov);
			}

			if (!prov && rows.length === 0) noteCacheProblem();
			for (const row of rows) {
				const ts = Number.isFinite(row?.[0]) && row[0] > 0 && row[0] <= nowMs ? row[0] : null;
				if (!Array.isArray(row) || row.length < 7 || ts === null
					|| !Number.isInteger(row[1]) || row[1] < 0 || typeof data.models[row[1]] !== "string" || !data.models[row[1]].trim()
					|| ![3, 4, 5, 6].every((index) => Number.isFinite(row[index]) && row[index] >= 0)
					|| (row[8] != null && !(typeof row[8] === "string" && row[8].trim()) && !(typeof row[8] === "number" && Number.isFinite(row[8])))) {
					noteCacheProblem(prov, ts);
					continue;
				}
				if (!prov) { noteCacheProblem(null, ts); continue; }
				const [, mIdx, , uncached, cacheRead, cacheCreation, outTok] = row;
				const key = row[8] == null ? null : `${prov}:${JSON.stringify(row[8])}`;
				if (key !== null && seen.has(key)) continue;
				const inTok = uncached + cacheCreation;
				const modelSlug = data.models?.[mIdx] || "unknown";
				const known = CANONICAL_MODELS.find((c) => canonicalBaseKey(c.id) === canonicalBaseKey(modelSlug));
				const rates = known?.cost || { input: 2, output: 10, cacheRead: 0.1 };
				const turnCostUsd = (inTok / 1e6) * (rates.input || 0) + (cacheRead / 1e6) * (rates.cacheRead || 0) + (outTok / 1e6) * (rates.output || 0);
				const totalTokens = inTok + cacheRead + outTok;
				if (!Number.isFinite(totalTokens) || !Number.isFinite(turnCostUsd)) {
					noteCacheProblem(prov, ts);
					continue;
				}
				if (key !== null) seen.add(key);

				if (!byProvider[prov]) byProvider[prov] = { usd7d: 0, usdWindow: 0, usd30d: 0, usdTotal: 0, tokens7d: 0, tokensWindow: 0, tokens30d: 0, tokensTotal: 0, inTok7d: 0, cacheRead7d: 0, outTok7d: 0, turns7d: 0, turns30d: 0, turnsTotal: 0 };
				byProvider[prov].usdTotal += turnCostUsd;
				byProvider[prov].tokensTotal += totalTokens;
				byProvider[prov].turnsTotal += 1;
				if (ts >= thirtyDaysAgo) {
					byProvider[prov].usd30d += turnCostUsd;
					byProvider[prov].tokens30d += totalTokens;
					byProvider[prov].turns30d += 1;
				}
				if (ts >= sevenDaysAgo) {
					byProvider[prov].usd7d += turnCostUsd;
					byProvider[prov].tokens7d += totalTokens;
					byProvider[prov].inTok7d += inTok || 0;
					byProvider[prov].cacheRead7d += cacheRead || 0;
					byProvider[prov].outTok7d += outTok || 0;
					byProvider[prov].turns7d += 1;
				}
				const windowCutoff = prov === "codex" ? codexWindowStartMs : sevenDaysAgo;
				if (ts >= windowCutoff) {
					byProvider[prov].usdWindow += turnCostUsd;
					byProvider[prov].tokensWindow += totalTokens;
				}

				const mKey = `${prov}:${modelSlug}`;
				if (!byModel[mKey]) byModel[mKey] = { provider: prov, model: modelSlug, billing: "subscription", usd7d: 0, usd30d: 0, usdTotal: 0, tokens7d: 0, tokensTotal: 0, inTok7d: 0, cacheRead7d: 0, outTok7d: 0, turns7d: 0, turnsTotal: 0 };
				byModel[mKey].usdTotal += turnCostUsd;
				byModel[mKey].tokensTotal += totalTokens;
				byModel[mKey].turnsTotal += 1;
				if (ts >= thirtyDaysAgo) byModel[mKey].usd30d += turnCostUsd;
				if (ts >= sevenDaysAgo) {
					byModel[mKey].usd7d += turnCostUsd;
					byModel[mKey].tokens7d += totalTokens;
					byModel[mKey].inTok7d += inTok || 0;
					byModel[mKey].cacheRead7d += cacheRead || 0;
					byModel[mKey].outTok7d += outTok || 0;
					byModel[mKey].turns7d += 1;
				}
			}
		}
	}

	if (invalidCacheRecords) {
		warnings.push(`T3 usage incomplete: ${invalidCacheRecords} invalid cache records or containers`);
		for (const [provider, weeklyUnknown] of cacheProblems) {
			byProvider[provider] ??= {};
			for (const stats of [byProvider[provider], ...Object.values(byModel).filter((model) => model.provider === provider)]) {
				stats.unknownCost = stats.unknownTokens = 1;
				if (weeklyUnknown) stats.unknownCost7d = stats.unknownTokens7d = 1;
			}
		}
	}

	const ocDbPath = path.join(homeDir, ".local", "share", "opencode", "opencode.db");
	if (fs.existsSync(ocDbPath)) {
		try {
			const numericField = (field) => `COALESCE(json_type(data, '$.${field}') IN ('integer', 'real') AND json_extract(data, '$.${field}') >= 0 AND json_extract(data, '$.${field}') <= ${Number.MAX_VALUE}, 0)`;
			const periods = [["Total", "1"], ["30d", `ts >= ${thirtyDaysAgo}`], ["7d", `ts >= ${sevenDaysAgo}`]];
			const sums = periods.flatMap(([suffix, condition]) => [
				`SUM(CASE WHEN ${condition} AND known_cost THEN cost ELSE 0 END) AS usd${suffix}`,
				`SUM(CASE WHEN ${condition} AND known_tokens THEN input + cache_read + output ELSE 0 END) AS tokens${suffix}`,
				`SUM(CASE WHEN ${condition} THEN 1 ELSE 0 END) AS turns${suffix}`,
			]);
			const sql = `WITH raw AS (
				SELECT CASE WHEN json_type(data, '$.providerID') = 'text'
					AND TRIM(json_extract(data, '$.providerID')) != ''
					AND TRIM(json_extract(data, '$.providerID')) NOT GLOB '*[^a-zA-Z0-9_-]*'
					THEN TRIM(json_extract(data, '$.providerID')) ELSE 'unknown' END || '/' ||
				COALESCE(NULLIF(TRIM(json_extract(data, '$.modelID')), ''), 'unknown') AS model,
				json_extract(data, '$.time.created') AS created, json_extract(data, '$.cost') AS cost,
				COALESCE(json_extract(data, '$.tokens.input'), 0) AS input,
				COALESCE(json_extract(data, '$.tokens.cache.read'), 0) AS cache_read,
				COALESCE(json_extract(data, '$.tokens.output'), 0) AS output,
				${numericField('cost')} AS known_cost, ${numericField('time.created')} AS known_created,
				${['tokens.input', 'tokens.cache.read', 'tokens.output'].map(numericField).join(' AND ')} AS known_tokens
				FROM message WHERE json_extract(data, '$.role') = 'assistant'
			), usage AS (
				SELECT *, CASE WHEN known_created AND created > 0 AND created <= ${nowMs} THEN created END AS ts FROM raw
			)
			SELECT model, ${sums.join(", ")},
				SUM(CASE WHEN ts >= ${sevenDaysAgo} AND known_tokens THEN input ELSE 0 END) AS inTok7d,
				SUM(CASE WHEN ts >= ${sevenDaysAgo} AND known_tokens THEN cache_read ELSE 0 END) AS cacheRead7d,
				SUM(CASE WHEN ts >= ${sevenDaysAgo} AND known_tokens THEN output ELSE 0 END) AS outTok7d,
				MAX(NOT known_tokens) AS unknownTokens,
				MAX(ts IS NULL OR (ts >= ${sevenDaysAgo} AND NOT known_tokens)) AS unknownTokens7d,
				MAX(NOT known_cost) AS unknownCost,
				MAX(ts IS NULL OR (ts >= ${sevenDaysAgo} AND NOT known_cost)) AS unknownCost7d,
				SUM(CASE WHEN ts >= ${monthStartMs} AND known_cost THEN cost ELSE 0 END) AS monthUsd,
				MAX(ts IS NULL OR (ts >= ${monthStartMs} AND NOT known_cost)) AS monthIncomplete
			FROM usage WHERE model IS NOT NULL GROUP BY model;`;
			// Return one row per model, so message history cannot overflow the child-process buffer.
			const rawRows = execFileSync("sqlite3", ["-readonly", "-json", ocDbPath, sql], { encoding: "utf8", timeout: 3000 }).trim();
			const rows = rawRows ? JSON.parse(rawRows) : [];
			byProvider.opencode ??= { usd7d: 0, tokens7d: 0, unknownCost7d: 0, unknownTokens7d: 0 };
			apiSpending.cloudflare = { monthStart: new Date(monthStartMs).toISOString(), spentUsd: 0, complete: true, sourceFile: ocDbPath };
			for (const { model, monthUsd, monthIncomplete, ...totals } of rows) {
				for (const [unit, flag] of [["usd", "unknownCost"], ["tokens", "unknownTokens"]]) {
					if (!Number.isFinite(totals[`${unit}Total`])) totals[flag] = 1;
					if (!Number.isFinite(totals[`${unit}7d`])) totals[`${flag}7d`] = 1;
				}
				const prov = "opencode";
				byModel[`${prov}:${model}`] = { provider: prov, model, billing: "api", ...totals };
				byProvider[prov] ??= {};
				for (const [key, value] of Object.entries(totals)) {
					if (key.startsWith("unknown")) {
						byProvider[prov][key] = Math.max(byProvider[prov][key] || 0, value);
						continue;
					}
					byProvider[prov][key] = (byProvider[prov][key] || 0) + value;
				}
				if (model.startsWith("unknown/") && (monthIncomplete || !Number.isFinite(monthUsd) || monthUsd > 0)) apiSpending.cloudflare.complete = false;
				if (model.startsWith("cloudflare-workers-ai/")) {
					if (Number.isFinite(monthUsd)) apiSpending.cloudflare.spentUsd += monthUsd;
					if (monthIncomplete || !Number.isFinite(monthUsd) || !Number.isFinite(apiSpending.cloudflare.spentUsd)) apiSpending.cloudflare.complete = false;
				}
			}
		} catch { warnings.push("OpenCode spending unavailable: cannot read local database"); }
	}

	return Object.keys(byProvider).length > 0 || Object.keys(liveRateLimits).length > 0 || Object.keys(apiSpending).length > 0 || warnings.length
		? { byProvider, byModel, liveRateLimits, apiSpending, warnings } : null;
}

export function discoverRuntimeState(homeDir = os.homedir()) {
	const disabledProviders = new Set();
	const hiddenModelsByProvider = new Map();
	const favorites = new Set();
	const modelOrder = new Map();
	const connectedOpencodeSubproviders = new Set();

	const t3SettingsPath = path.join(homeDir, ".t3", "userdata", "settings.json");
	if (fs.existsSync(t3SettingsPath)) {
		try {
			const t3 = JSON.parse(fs.readFileSync(t3SettingsPath, "utf8"));
			for (const [instanceId, cfg] of Object.entries(t3.providerInstances || {})) {
				if (cfg && cfg.enabled === false) disabledProviders.add(instanceId);
			}
			for (const [provId, prefs] of Object.entries(t3.providerModelPreferences || {})) {
				if (Array.isArray(prefs?.hiddenModels)) hiddenModelsByProvider.set(provId, new Set(prefs.hiddenModels));
				if (Array.isArray(prefs?.modelOrder)) {
					prefs.modelOrder.forEach((mId, idx) => {
						if (!modelOrder.has(mId)) modelOrder.set(mId, idx);
					});
				}
			}
			for (const fav of t3.favorites || []) {
				if (fav?.provider && fav?.model) {
					favorites.add(`${fav.provider}:${fav.model}`);
					favorites.add(fav.model);
				}
			}
		} catch {}
	}

	const ocAuthPath = path.join(homeDir, ".local", "share", "opencode", "auth.json");
	if (fs.existsSync(ocAuthPath)) {
		try {
			const auth = JSON.parse(fs.readFileSync(ocAuthPath, "utf8"));
			for (const key of Object.keys(auth || {})) connectedOpencodeSubproviders.add(key);
		} catch {}
	}

	const catalog = [];
	let codexCacheRead = false;
	const codexCachePath = path.join(homeDir, ".codex", "models_cache.json");
	if (fs.existsSync(codexCachePath)) {
		try {
			const codexCache = JSON.parse(fs.readFileSync(codexCachePath, "utf8"));
			if (!Array.isArray(codexCache.models)) throw new Error("Invalid Codex model cache");
			const cachedModels = [];
			for (const m of codexCache.models) {
				if (typeof m?.slug !== "string" || !m.slug.trim()) throw new Error("Invalid Codex model ID");
				if (m.visibility && m.visibility !== "list") continue;
				const reasoningOptions = (m.supported_reasoning_levels || []).map((r) => r.effort).filter(Boolean);
				cachedModels.push({ providerInstanceId: "codex", id: m.slug, label: m.display_name || m.slug, billing: "subscription", reasoningOptions });
			}
			catalog.push(...cachedModels);
			codexCacheRead = true;
		} catch {}
	}
	if (!codexCacheRead) {
		catalog.push(...CANONICAL_MODELS.filter((m) => m.providerInstanceId === "codex"));
	}

	for (const cModel of CANONICAL_MODELS.filter((m) => m.providerInstanceId === "claudeAgent")) {
		catalog.push(cModel);
	}

	const ocModelsPath = path.join(homeDir, ".cache", "opencode", "models.json");
	if (fs.existsSync(ocModelsPath)) {
		try {
			const ocData = JSON.parse(fs.readFileSync(ocModelsPath, "utf8"));
			for (const [subProvider, subData] of Object.entries(ocData || {})) {
				if (connectedOpencodeSubproviders.size > 0 && !connectedOpencodeSubproviders.has(subProvider)) continue;
				for (const [modelKey, modelInfo] of Object.entries(subData?.models || {})) {
					const fullId = `${subProvider}/${modelKey}`;
					const effortValues = modelInfo?.reasoning_options?.find((r) => r.type === "effort")?.values || Object.keys(modelInfo?.variants || {});
					const rawCost = modelInfo?.cost;
					const cost = rawCost ? { input: rawCost.input ?? 2, output: rawCost.output ?? 10, cacheRead: rawCost.cache_read ?? 0.1 } : undefined;
					catalog.push({
						providerInstanceId: "opencode",
						id: fullId,
						label: modelInfo?.name || fullId,
						billing: "api",
						cost,
						reasoningOptions: effortValues.length > 0 ? effortValues : [],
					});
				}
			}
		} catch {}
	}

	const usage = scanUsageTelemetry(homeDir);

	return {
		disabledProviders,
		providerBlocks: readProviderBlocks(homeDir),
		hiddenModelsByProvider,
		favorites,
		modelOrder,
		connectedOpencodeSubproviders,
		usage,
		catalog,
	};
}

export function catalogFromCapabilities(capabilities) {
	if (!Array.isArray(capabilities?.providers)) throw new Error("Catalog must contain the providers array from orchestrator_capabilities");
	return capabilities.providers.flatMap((provider) => {
		if (typeof provider.providerInstanceId !== "string" || !Array.isArray(provider.models)) throw new Error("Invalid catalog provider");
		if (provider.canRunChildTask !== true) return [];
		return provider.models.map((model) => {
			if (typeof model.id !== "string" || !model.id.trim()) throw new Error("Invalid catalog model ID");
			const optionId = provider.providerInstanceId === "codex" ? "reasoningEffort" : provider.providerInstanceId === "claudeAgent" ? "effort" : "variant";
			const reasoningOptions = model.options?.find((option) => option.id === optionId)?.values;
			if (["codex", "claudeAgent", "opencode"].includes(provider.providerInstanceId)
				&& (!Array.isArray(reasoningOptions) || reasoningOptions.length === 0 || reasoningOptions.some((value) => typeof value !== "string" || !value.trim()))) {
				throw new Error(`Catalog mismatch: ${provider.providerInstanceId}:${model.id} must advertise ${optionId} values`);
			}
			return { ...model, providerInstanceId: provider.providerInstanceId, reasoningOptions: reasoningOptions || [], liveOptions: model.options };
		});
	});
}

export function normalizePlans(rawPlans = {}) {
	const out = {};
	for (const [k, v] of Object.entries(rawPlans || {})) {
		const prov = normalizeProvider(k);
		const num = Number(String(v).replace(/^\$/, ""));
		if (Number.isFinite(num) && num >= 0) out[prov] = num;
	}
	return out;
}

function dispatchOptions(model, reasoning, speed) {
	const options = model.providerInstanceId === "codex" ? { reasoningEffort: reasoning, serviceTier: speed === "fast" ? "priority" : "default" }
		: model.providerInstanceId === "claudeAgent" ? { effort: reasoning, ...(model.id.includes("opus") ? { fastMode: speed === "fast" } : {}) }
		: { variant: reasoning };
	if (model.liveOptions) {
		for (const [id, value] of Object.entries(options)) {
			if (!model.liveOptions.find((option) => option.id === id)?.values?.includes(value)) {
				throw new Error(`Catalog mismatch: ${model.providerInstanceId}:${model.id} does not support ${id}=${value}`);
			}
		}
	}
	return options;
}

function weeklyLimitValue(raw, provider) {
	if (!["codex", "claudeAgent", "opencode"].includes(provider)) throw new Error("Invalid weekly limit provider: use codex, claudeAgent, or opencode");
	if (typeof raw === "number") {
		if (Number.isFinite(raw) && raw >= 0) return raw;
		throw new Error(`Invalid weekly limit for ${provider}: value must be finite and non-negative`);
	}
	const text = typeof raw === "string" ? raw.trim() : "";
	const tokenLimit = /^(?:\d+(?:\.\d*)?|\.\d+)[mk]$/i.test(text);
	if (!tokenLimit && !/^\$?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
		throw new Error(`Invalid weekly limit for ${provider}: use non-negative USD or tokens ending in k/M`);
	}
	const value = tokenLimit ? Number(text.slice(0, -1)) * (text.toLowerCase().endsWith("m") ? 1e6 : 1e3) : Number(text.replace(/^\$/, ""));
	if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid weekly limit for ${provider}: value must be finite and non-negative`);
	return value;
}

function normalizeWeeklyLimits(limits = {}) {
	if (limits === null || typeof limits !== "object" || Array.isArray(limits)) throw new Error("Weekly limits must be an object mapping providers to caps");
	return Object.fromEntries(Object.entries(limits).map(([provider, value]) => {
		const normalized = normalizeProvider(provider);
		weeklyLimitValue(value, normalized);
		return [normalized, value];
	}));
}

export function resolveModels(config, catalogModels = CANONICAL_MODELS, activeHarnesses = null, runtimeState = null, options = {}) {
	const nowMs = Date.now();
	const defaults = { latestGenerationOnly: true, preferDirectProvider: true, crossFamilyReview: true, respectRuntimeSettings: true, ...(config?.defaults || {}) };
	const plans = {
		codex: 20,
		claudeAgent: 20,
		...normalizePlans(config?.plans),
		...normalizePlans(options.plans),
	};

	const derivedWeeklyLimits = {};
	for (const [prov, planUsd] of Object.entries(plans)) {
		derivedWeeklyLimits[prov] = planToWeeklyLimitUsd(prov, planUsd);
	}
	const configLimits = normalizeWeeklyLimits(config?.budget?.weeklyLimitUsdEquivalent);
	const optionLimits = normalizeWeeklyLimits(options.weeklyLimits);

	const budgetCfg = {
		mode: options.budgetMode || config?.budget?.mode || "balanced",
		preferSubscriptionOverApi: true,
		spreadAcrossSubscriptions: true,
		blockApiSubproviders: ["openai", "anthropic"],
		autoThrottle: options.autoThrottle ?? config?.budget?.autoThrottle ?? true,
		autoDowngradeAbovePercent: config?.budget?.autoDowngradeAbovePercent ?? 80,
		...(config?.budget || {}),
		weeklyLimitUsdEquivalent: { ...derivedWeeklyLimits, ...configLimits },
	};
	if (options.budgetMode) budgetCfg.mode = options.budgetMode;
	if (options.autoThrottle !== undefined) budgetCfg.autoThrottle = options.autoThrottle;
	if (options.weeklyLimits) {
		budgetCfg.weeklyLimitUsdEquivalent = { ...budgetCfg.weeklyLimitUsdEquivalent, ...optionLimits };
		budgetCfg.autoThrottle = true;
	}

	const reasoningCfg = { coordinator: "medium", frontier: "high", workhorse: "medium", reviewer: "high", fast: "medium", ...(config?.reasoning || {}) };
	const speed = config?.speed ?? "standard";
	if (!["standard", "fast"].includes(speed)) throw new Error("speed must be standard or fast");
	const rulesByProvider = parseSelectRules(config?.models ?? config?.select ?? []);
	const enriched = catalogModels.map((m) => classifyModel(m));

	const blockedApiSet = new Set((budgetCfg.blockApiSubproviders || []).map((s) => s.toLowerCase()));

	const throttledProviders = new Set();
	const blockedProviders = new Set(Object.entries(runtimeState?.providerBlocks || {}).filter(([, until]) => until === null || Date.parse(until) > nowMs).map(([provider]) => provider));
	const quotaStatus = {};
	const subProviders = Object.keys(budgetCfg.weeklyLimitUsdEquivalent || {});
	const enabledSubProviders = subProviders.filter((p) => plans[p] > 0 && !runtimeState?.disabledProviders?.has(p) && (!activeHarnesses || activeHarnesses.includes(p)));
	for (const [prov, rawLimit] of Object.entries(budgetCfg.weeklyLimitUsdEquivalent || {})) {
		const limitVal = weeklyLimitValue(rawLimit, prov);
		if (plans[prov] === 0 || runtimeState?.disabledProviders?.has(prov)) {
			quotaStatus[prov] = { planMonthlyUsd: plans[prov], status: plans[prov] === 0 ? "no-subscription" : "disabled", percentUsed: null, percentRemaining: null, throttled: false };
			continue;
		}
		const isTokenLimit = typeof rawLimit === "string" && /[mk]$/i.test(rawLimit.trim());
		const liveLimit = runtimeState?.usage?.liveRateLimits?.[prov];
		const customLimit = optionLimits[prov] !== undefined || configLimits[prov] !== undefined;
		const useWindowStats = Boolean(!isTokenLimit && liveLimit?.windowStartMs && runtimeState?.usage?.byProvider?.[prov]?.usdWindow !== undefined && !customLimit);
		const spent7d = useWindowStats ? runtimeState.usage.byProvider[prov].usdWindow : (runtimeState?.usage?.byProvider?.[prov]?.usd7d ?? 0);
		const tokens7d = useWindowStats ? runtimeState.usage.byProvider[prov].tokensWindow : (runtimeState?.usage?.byProvider?.[prov]?.tokens7d ?? 0);
		const currentVal = isTokenLimit ? tokens7d : spent7d;
		const spendingIncomplete = (!Number.isFinite(runtimeState?.usage?.byProvider?.[prov]?.usd7d)
			|| spent7d < 0 || Boolean(runtimeState?.usage?.byProvider?.[prov]?.unknownCost7d));
		const tokensIncomplete = (!Number.isFinite(runtimeState?.usage?.byProvider?.[prov]?.tokens7d) || tokens7d < 0 || Boolean(runtimeState?.usage?.byProvider?.[prov]?.unknownTokens7d));
		const usageIncomplete = isTokenLimit ? tokensIncomplete : spendingIncomplete;
		const estimatedPercentUsed = !usageIncomplete && runtimeState?.usage?.byProvider?.[prov] && limitVal > 0 ? Math.round((currentVal / limitVal) * 100) : null;
		const liveServerReported = !customLimit && Number.isFinite(liveLimit?.usedPercent);
		const pct = liveServerReported ? liveLimit.usedPercent : customLimit ? estimatedPercentUsed : null;

		const creditsBalance = Number.isFinite(liveLimit?.creditsBalance) && liveLimit.creditsBalance >= 0 ? liveLimit.creditsBalance : null;
		const currentCreditReading = liveServerReported && liveLimit.usedPercent >= 0 && liveLimit.usedPercent <= 100
			&& liveLimit.windowMinutes === 10080 && liveLimit.resetsAtSec * 1000 > nowMs
			&& Number.isFinite(liveLimit.eventTsMs) && liveLimit.eventTsMs <= nowMs
			&& liveLimit.eventTsMs >= (liveLimit.resetsAtSec - 10080 * 60) * 1000;
		const windows = (liveLimit?.windows || []).filter((w) => w.resetsAtSec * 1000 > nowMs);
		const reportedBlock = liveLimit?.rateLimitReached && (liveLimit.rateLimitResetsAtSec == null || liveLimit.rateLimitResetsAtSec * 1000 > nowMs);
		const hasCreditHeadroom = Boolean(currentCreditReading && liveLimit.hasCredits === true && creditsBalance > 0 && !reportedBlock && !customLimit && !options.autoThrottle);
		const exhausted = windows.some((w) => w.usedPercent >= 100) || (liveServerReported && liveLimit.usedPercent >= 100);
		const blocked = (customLimit && usageIncomplete) || blockedProviders.has(prov) || Boolean(reportedBlock) || (exhausted && !hasCreditHeadroom) || (customLimit && limitVal >= 0 && currentVal >= limitVal);
		if (blocked) blockedProviders.add(prov);
		const isOnlyActiveSub = enabledSubProviders.length === 1 && enabledSubProviders[0] === prov && !customLimit && !options.autoThrottle && !reportedBlock;
		const overThreshold = pct !== null && pct >= budgetCfg.autoDowngradeAbovePercent;
		const throttled = blocked || Boolean(budgetCfg.autoThrottle && overThreshold && !hasCreditHeadroom && !isOnlyActiveSub);
		if (throttled) throttledProviders.add(prov);
		quotaStatus[prov] = {
			planMonthlyUsd: plans[prov] ?? null,
			status: "active",
			unit: isTokenLimit ? "tokens" : "usd",
			spent7dUsd: spendingIncomplete ? null : Number(spent7d.toFixed(2)),
			spendingIncomplete,
			tokens7dM: tokensIncomplete ? null : Number((tokens7d / 1e6).toFixed(1)),
			tokensIncomplete,
			weeklyLimit: rawLimit,
			percentUsed: pct,
			percentRemaining: pct === null ? null : Math.max(0, 100 - pct),
			estimatedPercentUsed,
			customLimit,
			liveServerReported,
			observedAt: liveLimit?.eventTsMs ? new Date(liveLimit.eventTsMs).toISOString() : null,
			windowMinutes: liveLimit?.windowMinutes ?? null,
			sourceFile: liveLimit?.sourceFile ?? null,
			resetsAt: liveLimit?.resetsAtSec ? new Date(liveLimit.resetsAtSec * 1000).toISOString() : null,
			creditsBalance,
			hasCreditHeadroom,
			overThreshold,
			throttled,
			blocked,
			windows,
			error: liveLimit?.error ?? null,
		};
	}
	const apiBudgetStatus = {};
	if (config?.apiBudgets !== undefined) {
		const budgets = config.apiBudgets;
		if (budgets === null || typeof budgets !== "object" || Array.isArray(budgets)) throw new Error("apiBudgets must be an object mapping providers to budgets");
		if (Object.keys(budgets).some((key) => key !== "cloudflare")) throw new Error("Unknown apiBudgets provider: only cloudflare is supported");
	}
	if (config?.apiBudgets?.cloudflare !== undefined) {
		const budget = config.apiBudgets.cloudflare;
		if (budget === null || typeof budget !== "object" || Array.isArray(budget) || Object.keys(budget).some((key) => key !== "monthlyUsd")) throw new Error("apiBudgets.cloudflare must be an object containing monthlyUsd");
		const monthlyUsd = config.apiBudgets.cloudflare.monthlyUsd;
		if (typeof monthlyUsd !== "number" || !Number.isFinite(monthlyUsd) || monthlyUsd < 0) throw new Error("apiBudgets.cloudflare.monthlyUsd must be a non-negative number");
		const spending = runtimeState?.usage?.apiSpending?.cloudflare;
		const complete = spending?.complete === true && Number.isFinite(spending?.spentUsd) && spending.spentUsd >= 0;
		const blocked = monthlyUsd === 0 || !complete || spending.spentUsd >= monthlyUsd;
		apiBudgetStatus.cloudflare = { monthlyUsd, spentUsd: complete ? spending.spentUsd : null, knownSpendUsd: spending?.spentUsd ?? null, blocked, sourceFile: spending?.sourceFile ?? null,
			reason: monthlyUsd === 0 ? "zero budget" : !complete ? "spending unknown or incomplete" : blocked ? "monthly budget reached" : null };
		if (blocked) blockedProviders.add("cloudflare");
	}

	const filtered = enriched.filter((model) => {
		if (blockedProviders.has(model.providerInstanceId)) return false;
		if (model.providerInstanceId === "opencode" && model.id.startsWith("cloudflare-workers-ai/") && blockedProviders.has("cloudflare")) return false;
		if (model.billing === "subscription" && plans[model.providerInstanceId] === 0) return false;
		if (activeHarnesses && !activeHarnesses.includes(model.providerInstanceId)) return false;
		if (model.providerInstanceId === "opencode" && model.id.includes("/")) {
			const subProv = model.id.split("/")[0].toLowerCase();
			if (blockedApiSet.has(subProv)) return false;
		}
		if (defaults.respectRuntimeSettings && runtimeState) {
			if (runtimeState.disabledProviders?.has(model.providerInstanceId)) return false;
			const hiddenSet = runtimeState.hiddenModelsByProvider?.get(model.providerInstanceId);
			if (hiddenSet?.has(model.id)) return false;
			if (model.providerInstanceId === "opencode" && runtimeState.connectedOpencodeSubproviders?.size > 0 && model.id.includes("/")) {
				const subProvider = model.id.split("/")[0];
				if (!runtimeState.connectedOpencodeSubproviders.has(subProvider)) return false;
			}
		}
		const rules = rulesByProvider.get(model.providerInstanceId);
		if (!rules) return false;
		if (defaults.latestGenerationOnly && model.generation === "legacy") return false;
		const matchedInclude = rules.includeAll || rules.includes.some((pat) => matchesPattern(model.id, pat));
		if (!matchedInclude) return false;
		const matchedExclude = rules.excludes.some((pat) => matchesPattern(model.id, pat));
		return !matchedExclude;
	});

	let deduplicated = filtered;
	if (defaults.preferDirectProvider) {
		const bestByBase = new Map();
		for (const model of filtered) {
			const baseKey = canonicalBaseKey(model.id);
			const existing = bestByBase.get(baseKey);
			if (!existing || gatewayPriority(model.id, model.providerInstanceId, runtimeState || {}) < gatewayPriority(existing.id, existing.providerInstanceId, runtimeState || {})) {
				bestByBase.set(baseKey, model);
			}
		}
		deduplicated = Array.from(bestByBase.values());
	}

	const rankModelForTier = (a, b) => {
		const aThrottled = throttledProviders.has(a.providerInstanceId) ? 1 : 0;
		const bThrottled = throttledProviders.has(b.providerInstanceId) ? 1 : 0;
		if (aThrottled !== bThrottled) return aThrottled - bThrottled;
		if (budgetCfg.mode === "economy") {
			return effectiveCostScore(a) - effectiveCostScore(b);
		}
		if (budgetCfg.preferSubscriptionOverApi && a.billing !== b.billing) {
			return a.billing === "subscription" ? -1 : 1;
		}
		if (budgetCfg.spreadAcrossSubscriptions && a.billing === "subscription" && b.billing === "subscription" && a.providerInstanceId !== b.providerInstanceId
			&& !quotaStatus[a.providerInstanceId]?.hasCreditHeadroom && !quotaStatus[b.providerInstanceId]?.hasCreditHeadroom) {
			const aPct = quotaStatus[a.providerInstanceId]?.percentUsed;
			const bPct = quotaStatus[b.providerInstanceId]?.percentUsed;
			if (Number.isFinite(aPct) && Number.isFinite(bPct) && Math.abs(aPct - bPct) >= 10) return aPct - bPct;
		}
		return effectiveCostScore(a) - effectiveCostScore(b);
	};

	const tiers = { frontier: [], workhorse: [], long_context: [], fast: [] };
	for (const model of deduplicated) {
		for (const tier of model.tiers) {
			if (!tiers[tier]) continue;
			const desiredEffort = budgetCfg.mode === "economy" && tier === "workhorse" ? "low" : tier === "frontier" ? reasoningCfg.frontier : tier === "fast" ? reasoningCfg.fast : tier === "long_context" ? "high" : reasoningCfg.workhorse;
			tiers[tier].push({
				providerInstanceId: model.providerInstanceId,
				id: model.id,
				label: model.label,
				family: model.family,
				billing: model.billing,
				cost: model.cost,
				reasoning: pickReasoning(desiredEffort, model.reasoningOptions),
				options: dispatchOptions(model, pickReasoning(desiredEffort, model.reasoningOptions), speed),
				reasoningOptions: model.reasoningOptions,
				...(model.liveOptions && { liveOptions: model.liveOptions }),
				notes: model.notes,
			});
		}
	}

	for (const tierKey of Object.keys(tiers)) {
		tiers[tierKey].sort(rankModelForTier);
	}

	const coordinatorCandidates = budgetCfg.mode === "performance" ? [...tiers.frontier, ...tiers.workhorse] : [...tiers.workhorse, ...tiers.frontier];
	const coordinatorRaw = coordinatorCandidates[0] || tiers.fast[0] || null;
	const coordinator = coordinatorRaw ? { ...coordinatorRaw, reasoning: pickReasoning(reasoningCfg.coordinator, coordinatorRaw.reasoningOptions || ["medium"]) } : null;
	if (coordinator) coordinator.options = dispatchOptions(coordinator, coordinator.reasoning, speed);

	const primaryImpl = tiers.workhorse[0] || tiers.frontier[0] || tiers.fast[0] || null;
	const secondarySubImpl = tiers.workhorse.find((m) => m.billing === "subscription" && m.providerInstanceId !== primaryImpl?.providerInstanceId) || null;
	const budgetImpl = [...tiers.workhorse].sort((a, b) => effectiveCostScore(a) - effectiveCostScore(b))[0] || tiers.fast[0] || null;
	const reviewerPool = budgetCfg.mode === "economy" ? [...tiers.workhorse, ...tiers.frontier] : [...tiers.frontier, ...tiers.workhorse];
	const crossFamilyReviewer = defaults.crossFamilyReview && primaryImpl ? reviewerPool.find((m) => m.family !== primaryImpl.family) || reviewerPool[0] : reviewerPool[0] || null;
	const reviewer = crossFamilyReviewer ? { ...crossFamilyReviewer, reasoning: pickReasoning(reasoningCfg.reviewer, crossFamilyReviewer.reasoningOptions || ["high"]) } : null;
	if (reviewer) reviewer.options = dispatchOptions(reviewer, reviewer.reasoning, speed);
	const fastRecon = tiers.fast[0] || null;

	return {
		defaults,
		plans,
		budget: budgetCfg,
		quotaStatus,
		apiBudgetStatus,
		blockedProviders: Array.from(blockedProviders),
		warnings: runtimeState?.usage?.warnings || [],
		speed,
		reasoning: reasoningCfg,
		disabledProviders: runtimeState?.disabledProviders ? Array.from(runtimeState.disabledProviders) : [],
		connectedOpencodeSubproviders: runtimeState?.connectedOpencodeSubproviders ? Array.from(runtimeState.connectedOpencodeSubproviders) : [],
		models: deduplicated,
		tiers,
		recommended: {
			coordinator,
			primaryImplementer: primaryImpl,
			secondaryImplementer: secondarySubImpl,
			budgetImplementer: budgetImpl,
			crossFamilyReviewer: reviewer,
			fastRecon,
		},
	};
}

function formatQuotaStatus(resolved) {
	const parts = Object.entries(resolved.quotaStatus).map(([prov, q]) => {
		if (q.status === "no-subscription") return `\`${prov}\`: **No subscription**`;
		if (q.status === "disabled") return `\`${prov}\` ($${q.planMonthlyUsd}/mo configured): **Provider disabled**`;
		const planTag = q.planMonthlyUsd ? `$${q.planMonthlyUsd}/mo plan` : "custom limit";
		const dollars = q.spendingIncomplete ? "spending unknown/incomplete" : `$${q.spent7dUsd}`;
		const tokens = q.tokensIncomplete ? "token usage unknown/incomplete" : `${q.tokens7dM}M tok`;
		const label = q.customLimit
			? q.unit === "tokens" ? `${tokens} / ${q.weeklyLimit} (${dollars} eq)` : `${dollars} / $${String(q.weeklyLimit).replace(/^\$/, "")} custom eq cap (${tokens})`
			: `${dollars} eq (${tokens})`;
		const creditNote = prov === "codex" || q.creditsBalance != null
			? `; credits: ${q.creditsBalance == null ? "unknown" : q.creditsBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })}${q.hasCreditHeadroom ? " (available; quota-based demotion bypassed)" : " (no credit headroom applied)"}` : "";
		const resetNote = q.resetsAt ? `, resets ${q.resetsAt}` : "";
		const observedNote = q.observedAt ? `, observed ${q.observedAt}, window ${q.windowMinutes ?? "unknown"} minutes` : "";
		const sourceNote = q.sourceFile ? `, source: \`${q.sourceFile}\`` : "";
		const usage = q.percentUsed === null ? "usage unknown" : `${q.percentUsed}% used / ${q.percentRemaining}% remaining (${q.customLimit ? "custom cap" : "server-reported"})`;
		const windows = (q.windows || []).map((w) => `${w.windowMinutes}m: ${w.usedPercent}% used, resets ${new Date(w.resetsAtSec * 1000).toISOString()}`).join("; ");
		return `\`${prov}\` (${planTag}): **${usage}**${creditNote}${observedNote}${resetNote}${sourceNote}; local API-equivalent estimate: ${label}${windows ? `; windows: ${windows}` : ""}${q.error ? `; ${q.error}` : ""}${q.blocked ? " **[BLOCKED]**" : q.throttled ? " **[THROTTLED]**" : ""}`;
	});
	for (const [provider, status] of Object.entries(resolved.apiBudgetStatus || {})) {
		parts.push(`\`${provider}\` metered API: $${status.monthlyUsd}/calendar month UTC; local recorded spend ${status.spentUsd === null ? "unknown/incomplete" : `$${status.spentUsd.toFixed(2)}`}${status.blocked ? ` **[BLOCKED: ${status.reason}]**` : ""}`);
	}
	return `- **Subscription Headroom & API Budgets:** ${parts.join(" | ")}${resolved.blockedProviders?.length ? `\n- **Blocked until reset or verified unblock:** ${resolved.blockedProviders.join(", ")}` : ""}`;
}

export function formatMarkdown(resolved) {
	const lines = [
		`### Active Model Pool (Mode: \`${resolved.budget?.mode || "balanced"}\`)`,
		"",
	];
	if (resolved.disabledProviders?.length) {
		lines.push(`- **Disabled T3 Providers (skipped):** \`${resolved.disabledProviders.join("`, `")}\``);
	}
	lines.push(formatQuotaStatus(resolved));
	lines.push(`- **Speed:** ${resolved.speed}; pass each model's resolved \`options\` through T3 \`target.options\` after checking live capabilities.`);
	for (const warning of resolved.warnings || []) lines.push(`- **Telemetry warning:** ${warning}`);
	lines.push("");
	lines.push("| Capability Tier | Provider | Model ID | Billing | Cost ($/M In/Out/Cache) | Reasoning | Dispatch options | Family |");
	lines.push("| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |");
	for (const [tierName, entries] of Object.entries(resolved.tiers)) {
		for (const item of entries) {
			const c = item.cost || { input: 0, output: 0, cacheRead: 0 };
			lines.push(`| \`@${tierName}\` | \`${item.providerInstanceId}\` | \`${item.id}\` | \`${item.billing}\` | $${c.input} / $${c.output} / $${c.cacheRead} | \`${item.reasoning}\` | \`${JSON.stringify(item.options)}\` | \`${item.family}\` |`);
		}
	}
	lines.push("");
	lines.push("### Recommended Cost-Optimized Routing");
	if (resolved.recommended.coordinator) {
		const c = resolved.recommended.coordinator;
		lines.push(`- **Coordinator (Main Thread):** \`${c.providerInstanceId}:${c.id}\` (\`${c.reasoning}\`, \`${c.billing}\`)`);
	}
	if (resolved.recommended.fastRecon) {
		const f = resolved.recommended.fastRecon;
		lines.push(`- **Fast Recon / Narrow Search (\`@fast\`):** \`${f.providerInstanceId}:${f.id}\` (\`${f.reasoning}\`, $${f.cost?.input}/$${f.cost?.output})`);
	}
	if (resolved.recommended.budgetImplementer) {
		const b = resolved.recommended.budgetImplementer;
		lines.push(`- **Routine / Boilerplate / Tests (\`@workhorse\` budget):** \`${b.providerInstanceId}:${b.id}\` (\`${b.reasoning}\`, $${b.cost?.input}/$${b.cost?.output})`);
	}
	if (resolved.recommended.primaryImplementer) {
		const impl = resolved.recommended.primaryImplementer;
		lines.push(`- **Primary Feature / UI / Integration (\`@workhorse\`):** \`${impl.providerInstanceId}:${impl.id}\` (\`${impl.reasoning}\`, \`${impl.billing}\`)`);
	}
	if (resolved.recommended.secondaryImplementer) {
		const sec = resolved.recommended.secondaryImplementer;
		lines.push(`- **Secondary Parallel Slice (\`@workhorse\` load-balanced):** \`${sec.providerInstanceId}:${sec.id}\` (\`${sec.reasoning}\`, \`${sec.billing}\`)`);
	}
	if (resolved.recommended.crossFamilyReviewer) {
		const rev = resolved.recommended.crossFamilyReviewer;
		lines.push(`- **Independent Reviewer (\`@reviewer\`):** \`${rev.providerInstanceId}:${rev.id}\` (\`${rev.reasoning}\`, family: \`${rev.family}\`)`);
	}
	return lines.join("\n");
}

export function formatUsageReport(runtimeState, resolved) {
	const usage = runtimeState?.usage;
	if (!usage) return `${formatQuotaStatus(resolved)}\n\nNo local usage telemetry found.`;

	const models = Object.values(usage.byModel || {}).sort((a, b) => b.usdTotal - a.usdTotal);
	const totalTurns7d = models.reduce((s, m) => s + m.turns7d, 0) || 1;
	const totalUsd7d = models.reduce((s, m) => s + m.usd7d, 0) || 0.01;

	const lines = [
		"## Task-Router Usage, Cost & Subscription ROI Report",
		formatQuotaStatus(resolved),
		"",
		"### 1. Per-Model Breakdown (Rolling 7 Days & All-Time)",
		"",
		"| Provider | Model | Billing | 7d Turns (% Share) | 7d Tokens (In / Cache / Out) | 7d Cost / API-Eq (% Share) | All-Time Cost / Eq |",
		"| :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
	];
	for (const warning of usage.warnings || []) lines.push(`Telemetry warning: ${warning}`);

	for (const m of models) {
		const turnPct = Math.round((m.turns7d / totalTurns7d) * 100);
		const costPct = Math.round((m.usd7d / totalUsd7d) * 100);
		const tokM = (m.tokens7d / 1e6).toFixed(1);
		const inM = (m.inTok7d / 1e6).toFixed(1);
		const cacheM = (m.cacheRead7d / 1e6).toFixed(1);
		const outM = (m.outTok7d / 1e6).toFixed(2);
		const tokenTag = m.unknownTokens7d ? "unknown/incomplete" : `${tokM}M (${inM}M / ${cacheM}M / ${outM}M)`;
		const costTag = m.unknownCost7d ? "unknown/incomplete" : m.billing === "api" ? `$${m.usd7d.toFixed(2)} locally recorded` : `$${m.usd7d.toFixed(2)} sub-eq`;
		lines.push(`| \`${m.provider}\` | \`${m.model}\` | \`${m.billing}\` | ${m.turns7d} (${turnPct}%) | ${tokenTag} | **${costTag}** (${m.unknownCost7d ? "unknown" : `${costPct}%`}) | ${m.unknownCost ? "unknown/incomplete" : `$${m.usdTotal.toFixed(2)}`} |`);
	}

	const astraEntry = models.find((m) => m.model === "gpt-6-astra");
	const solIfReplacedUsd = astraEntry ? (astraEntry.inTok7d / 1e6) * 2 + (astraEntry.cacheRead7d / 1e6) * 0.1 + (astraEntry.outTok7d / 1e6) * 10 : 0;
	const currentCodex7d = usage.byProvider?.codex?.usd7d || 0;
	const codexCostsIncomplete = Boolean(usage.byProvider?.codex?.unknownCost7d) || !Number.isFinite(currentCodex7d)
		|| models.some((m) => m.provider === "codex" && m.unknownCost7d);
	const optimizedCodex7d = astraEntry ? currentCodex7d - astraEntry.usd7d + solIfReplacedUsd : currentCodex7d;
	const total7dInTok = models.reduce((s, m) => s + m.inTok7d, 0);
	const total7dCacheTok = models.reduce((s, m) => s + m.cacheRead7d, 0);
	const total7dOutTok = models.reduce((s, m) => s + m.outTok7d, 0);
	const googleArgonWeeklyApiCost = (total7dInTok / 1e6) * 2 + (total7dCacheTok / 1e6) * 0.1 + (total7dOutTok / 1e6) * 10;

	lines.push("");
	lines.push("### 2. Model Cost Scenario (API-equivalent estimates, not subscription quota)");
	lines.push(`- **Current 7d Codex API-equivalent cost:** **${codexCostsIncomplete ? "unknown/incomplete" : `$${currentCodex7d.toFixed(2)}`}**. Local logs do not establish which sessions were coordinators.`);
	lines.push(`- **If the same Astra token volume used Sol instead:** **${codexCostsIncomplete || astraEntry?.unknownTokens7d ? "unavailable (usage incomplete)" : `$${optimizedCodex7d.toFixed(2)}`}** total estimated Codex cost. This is a pricing scenario, not evidence of equal task quality or included subscription capacity.`);
	lines.push("");
	lines.push("| Configured plan option | Monthly subscriptions | Included capacity |", "| :--- | :--- | :--- |");
	for (const [openai, claude] of [[200, 0], [100, 100], [20, 100], [20, 20]]) lines.push(`| openai=${openai}, claude=${claude} | $${openai + claude}/mo | Verify provider dashboards; cannot derive from API prices |`);
	lines.push(`\nGoogle API token-price scenario: ${(models.some((m) => m.unknownTokens7d) || Object.values(usage.byProvider || {}).some((provider) => provider.unknownTokens7d)) ? "unavailable (token usage incomplete)" : `~$${Math.round(googleArgonWeeklyApiCost * 4.3)}/month at the observed token volume`}. Subscription fees, metered API spend, and quota percentages are separate.`);

	return lines.join("\n");
}

function mergeConfig(base, override) {
	const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
	if (!isObject(base) || !isObject(override)) return override;
	return { ...base, ...Object.fromEntries(Object.entries(override).map(([key, value]) => [key, mergeConfig(base[key], value)])) };
}

export function loadConfig(customPath, homeDir = os.homedir(), skillRoot = SKILL_ROOT) {
	const readConfig = (file) => {
		try {
			const config = JSON.parse(fs.readFileSync(file, "utf8"));
			if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("expected a JSON object");
			if (!Object.hasOwn(config, "models") && Object.hasOwn(config, "select")) config.models = config.select;
			delete config.select;
			return config;
		} catch (error) {
			throw new Error(`Cannot load configuration ${file}: ${error.message}`);
		}
	};
	const bundledPath = ["model.json", "models.json"].map((name) => path.join(skillRoot, name)).find((file) => fs.existsSync(file));
	if (!bundledPath) throw new Error(`No bundled model.json or models.json found in ${skillRoot}`);
	const defaults = readConfig(bundledPath);
	const candidates = [
		path.join(homeDir, ".config", "task-router", "user.json"),
		path.join(homeDir, ".codex", "task-router", "user.json"),
		path.join(homeDir, ".config", "task-router", "model.json"),
		path.join(homeDir, ".config", "task-router", "models.json"),
		path.join(homeDir, ".codex", "task-router", "model.json"),
		path.join(homeDir, ".codex", "task-router", "models.json"),
	];
	const overridePath = customPath ?? candidates.find((file) => fs.existsSync(file));
	return overridePath == null ? defaults : mergeConfig(defaults, readConfig(overridePath));
}

function parseLimitsArg(raw, flag) {
	if (typeof raw !== "string" || !raw.trim() || raw.startsWith("--")) throw new Error(`${flag} requires provider=value`);
	const out = {};
	for (const part of raw.split(",")) {
		const match = /^([^=]+)=([^=]+)$/.exec(part);
		if (!match) throw new Error(`${flag} requires provider=value for every entry`);
		const [, k, v] = match;
		const provider = normalizeProvider(k.trim());
		if (!["codex", "claudeAgent", ...(flag === "--weekly-limit" ? ["opencode"] : [])].includes(provider)) throw new Error(`${flag}: unknown provider`);
		const clean = v.trim();
		const value = weeklyLimitValue(clean, provider);
		const tokens = /[mk]$/i.test(clean);
		if (flag === "--plan" && tokens) throw new Error("--plan accepts monthly USD, not token counts");
		out[provider] = tokens ? clean.toUpperCase() : value;
	}
	return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const args = process.argv.slice(2);
	const configIdx = args.indexOf("--config");
	const catalogIdx = args.indexOf("--catalog");
	const harnessIdx = args.indexOf("--harness");
	const budgetIdx = args.indexOf("--budget");
	const planIdx = args.indexOf("--plan");
	const limitIdx = args.indexOf("--weekly-limit");
	const blockIdx = args.indexOf("--block");
	const unblockIdx = args.indexOf("--unblock");
	const autoThrottle = args.includes("--throttle") ? true : undefined;
	const staticOnly = args.includes("--static");
	const showReport = args.includes("--report");
	const asJson = args.includes("--json");

	if (configIdx !== -1 && (!args[configIdx + 1] || args[configIdx + 1].startsWith("--"))) throw new Error("--config requires a file path");
	if (catalogIdx !== -1 && (!args[catalogIdx + 1] || args[catalogIdx + 1].startsWith("--"))) throw new Error("--catalog requires a file path");
	const liveCatalog = catalogIdx === -1 ? null : catalogFromCapabilities(JSON.parse(fs.readFileSync(args[catalogIdx + 1], "utf8")));
	const config = loadConfig(configIdx !== -1 ? args[configIdx + 1] : null);
	const planOverrides = planIdx !== -1 ? parseLimitsArg(args[planIdx + 1], "--plan") : undefined;
	const weeklyOverrides = limitIdx !== -1 ? parseLimitsArg(args[limitIdx + 1], "--weekly-limit") : undefined;
	const effectivePlans = { codex: 20, claudeAgent: 20, ...normalizePlans(config.plans), ...normalizePlans(planOverrides) };
	const activeHarnesses = harnessIdx !== -1 ? args[harnessIdx + 1].split(",").map((h) => normalizeProvider(h.trim())) : null;
	if (blockIdx !== -1) {
		const raw = args[blockIdx + 1];
		if (!raw || raw.startsWith("--")) throw new Error("--block requires provider[=future-ISO-reset]");
		const split = raw.indexOf("=");
		recordProviderBlock(normalizeProvider(split < 0 ? raw : raw.slice(0, split)), split < 0 ? null : raw.slice(split + 1));
	}
	if (unblockIdx !== -1) {
		const raw = args[unblockIdx + 1];
		if (!raw || raw.startsWith("--")) throw new Error("--unblock requires a provider");
		clearProviderBlock(normalizeProvider(raw));
	}
	const runtimeState = staticOnly ? null : discoverRuntimeState();
	if (runtimeState && effectivePlans.claudeAgent > 0 && !runtimeState.disabledProviders.has("claudeAgent")
		&& (!activeHarnesses || activeHarnesses.includes("claudeAgent"))) {
		runtimeState.usage ??= { byProvider: {}, byModel: {}, liveRateLimits: {} };
		runtimeState.usage.liveRateLimits.claudeAgent = await readClaudeQuota();
	}
	const catalogModels = liveCatalog ?? (runtimeState ? runtimeState.catalog : CANONICAL_MODELS);
	const options = {
		budgetMode: budgetIdx !== -1 ? args[budgetIdx + 1] : undefined,
		plans: planOverrides,
		weeklyLimits: weeklyOverrides,
		autoThrottle,
	};

	const resolved = resolveModels(config, catalogModels, activeHarnesses, runtimeState, options);
	if (showReport) {
		console.log(formatUsageReport(runtimeState, resolved));
	} else {
		console.log(asJson ? JSON.stringify(resolved, null, 2) : formatMarkdown(resolved));
	}
}
