#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export const CANONICAL_MODELS = [
	{ providerInstanceId: "codex", id: "gpt-6-astra", label: "GPT-6-Astra", family: "openai", billing: "subscription", cost: { input: 10, output: 50, cacheRead: 1 }, tiers: ["frontier"], generation: "current", reasoningOptions: ["low", "medium", "high", "xhigh", "max", "ultra"], notes: "Heavy frontier (5x Sol quota burn) — reserve for bounded hard slices/review, avoid as coordinator" },
	{ providerInstanceId: "codex", id: "gpt-6.1-sol", label: "GPT-6.1-Sol", family: "openai", billing: "subscription", cost: { input: 2, output: 10, cacheRead: 0.1 }, tiers: ["workhorse", "long_context"], generation: "current", reasoningOptions: ["low", "medium", "high", "xhigh", "max", "ultra"], notes: "Primary subscription workhorse (500k context, 0.10/M cache read) — ideal Coordinator & Integrator" },
	{ providerInstanceId: "codex", id: "gpt-6-luna", label: "GPT-6-Luna", family: "openai", billing: "subscription", cost: { input: 0.1, output: 0.5, cacheRead: 0.01 }, tiers: ["fast"], generation: "current", reasoningOptions: ["low", "medium", "high", "xhigh", "max"], notes: "Ultra-low quota burn (0.01/M cache read) — fast recon, search, and doc/config checks" },
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

export function scanUsageTelemetry(homeDir = os.homedir(), nowMs = Date.now()) {
	const usagePath = path.join(homeDir, ".t3", "userdata", "usage-scan-cache-v5.json");
	if (!fs.existsSync(usagePath)) return null;
	try {
		const data = JSON.parse(fs.readFileSync(usagePath, "utf8"));
		const sevenDaysAgo = nowMs - 7 * 86400 * 1000;
		const thirtyDaysAgo = nowMs - 30 * 86400 * 1000;
		const byProvider = {};
		const byModel = {};

		for (const fileEntry of Object.values(data.files || {})) {
			const rawProv = fileEntry.p || "unknown";
			const prov = rawProv === "claude" ? "claudeAgent" : rawProv;
			for (const row of fileEntry.r || []) {
				const [ts, mIdx, , inTok = 0, cacheRead = 0, , outTok = 0] = row;
				const modelSlug = data.models?.[mIdx] || "unknown";
				const known = CANONICAL_MODELS.find((c) => canonicalBaseKey(c.id) === canonicalBaseKey(modelSlug));
				const rates = known?.cost || { input: 2, output: 10, cacheRead: 0.1 };
				const turnCostUsd = (inTok / 1e6) * (rates.input || 0) + (cacheRead / 1e6) * (rates.cacheRead || 0) + (outTok / 1e6) * (rates.output || 0);

				if (!byProvider[prov]) byProvider[prov] = { usd7d: 0, usd30d: 0, usdTotal: 0, turns7d: 0, turnsTotal: 0 };
				byProvider[prov].usdTotal += turnCostUsd;
				byProvider[prov].turnsTotal += 1;
				if (ts >= thirtyDaysAgo) byProvider[prov].usd30d += turnCostUsd;
				if (ts >= sevenDaysAgo) {
					byProvider[prov].usd7d += turnCostUsd;
					byProvider[prov].turns7d += 1;
				}

				if (!byModel[modelSlug]) byModel[modelSlug] = { usd7d: 0, usd30d: 0, usdTotal: 0, turns7d: 0, turnsTotal: 0 };
				byModel[modelSlug].usdTotal += turnCostUsd;
				byModel[modelSlug].turnsTotal += 1;
				if (ts >= thirtyDaysAgo) byModel[modelSlug].usd30d += turnCostUsd;
				if (ts >= sevenDaysAgo) {
					byModel[modelSlug].usd7d += turnCostUsd;
					byModel[modelSlug].turns7d += 1;
				}
			}
		}
		return { byProvider, byModel };
	} catch {
		return null;
	}
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
	const codexCachePath = path.join(homeDir, ".codex", "models_cache.json");
	if (fs.existsSync(codexCachePath)) {
		try {
			const codexCache = JSON.parse(fs.readFileSync(codexCachePath, "utf8"));
			for (const m of codexCache.models || []) {
				if (m.visibility && m.visibility !== "list") continue;
				const reasoningOptions = (m.supported_reasoning_levels || []).map((r) => r.effort).filter(Boolean);
				catalog.push({ providerInstanceId: "codex", id: m.slug, label: m.display_name || m.slug, billing: "subscription", reasoningOptions });
			}
		} catch {}
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
		hiddenModelsByProvider,
		favorites,
		modelOrder,
		connectedOpencodeSubproviders,
		usage,
		catalog: catalog.length > 0 ? catalog : CANONICAL_MODELS,
	};
}

export function resolveModels(config, catalogModels = CANONICAL_MODELS, activeHarnesses = null, runtimeState = null, options = {}) {
	const defaults = { latestGenerationOnly: true, preferDirectProvider: true, crossFamilyReview: true, respectRuntimeSettings: true, ...(config?.defaults || {}) };
	const budgetCfg = {
		mode: options.budgetMode || config?.budget?.mode || "balanced",
		coordinatorTier: config?.budget?.coordinatorTier || "workhorse",
		preferSubscriptionOverApi: true,
		blockApiSubproviders: ["openai", "anthropic"],
		weeklyLimitUsdEquivalent: { codex: 45, claudeAgent: 45, ...(config?.budget?.weeklyLimitUsdEquivalent || {}), ...(options.weeklyLimits || {}) },
		autoDowngradeAbovePercent: config?.budget?.autoDowngradeAbovePercent ?? 80,
		...(config?.budget || {}),
	};
	if (options.budgetMode) budgetCfg.mode = options.budgetMode;
	if (options.weeklyLimits) budgetCfg.weeklyLimitUsdEquivalent = { ...budgetCfg.weeklyLimitUsdEquivalent, ...options.weeklyLimits };

	const reasoningCfg = { coordinator: "medium", frontier: "high", workhorse: "medium", reviewer: "high", fast: "medium", ...(config?.reasoning || {}) };
	const rulesByProvider = parseSelectRules(config?.select || []);
	const enriched = catalogModels.map((m) => classifyModel(m));

	const blockedApiSet = new Set((budgetCfg.blockApiSubproviders || []).map((s) => s.toLowerCase()));

	const throttledProviders = new Set();
	const quotaStatus = {};
	for (const [prov, limitUsd] of Object.entries(budgetCfg.weeklyLimitUsdEquivalent || {})) {
		const spent7d = runtimeState?.usage?.byProvider?.[prov]?.usd7d ?? 0;
		const pct = limitUsd > 0 ? Math.round((spent7d / limitUsd) * 100) : 0;
		const throttled = pct >= budgetCfg.autoDowngradeAbovePercent;
		if (throttled) throttledProviders.add(prov);
		quotaStatus[prov] = { spent7dUsd: Number(spent7d.toFixed(2)), weeklyLimitUsd: limitUsd, percentUsed: pct, throttled };
	}

	const filtered = enriched.filter((model) => {
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
				reasoningOptions: model.reasoningOptions,
				notes: model.notes,
			});
		}
	}

	for (const tierKey of Object.keys(tiers)) {
		tiers[tierKey].sort(rankModelForTier);
	}

	const coordinatorCandidates = budgetCfg.mode === "performance" ? [...tiers.frontier, ...tiers.workhorse] : [...tiers.workhorse.filter((m) => m.billing === "subscription"), ...tiers.workhorse, ...tiers.frontier];
	const coordinatorRaw = coordinatorCandidates[0] || tiers.fast[0] || null;
	const coordinator = coordinatorRaw ? { ...coordinatorRaw, reasoning: pickReasoning(reasoningCfg.coordinator, coordinatorRaw.reasoningOptions || ["medium"]) } : null;

	const primaryImpl = tiers.workhorse[0] || tiers.frontier[0] || tiers.fast[0] || null;
	const budgetImpl = [...tiers.workhorse].sort((a, b) => effectiveCostScore(a) - effectiveCostScore(b))[0] || tiers.fast[0] || null;
	const reviewerPool = budgetCfg.mode === "economy" ? [...tiers.workhorse, ...tiers.frontier] : [...tiers.frontier, ...tiers.workhorse];
	const crossFamilyReviewer = defaults.crossFamilyReview && primaryImpl ? reviewerPool.find((m) => m.family !== primaryImpl.family) || reviewerPool[0] : reviewerPool[0] || null;
	const reviewer = crossFamilyReviewer ? { ...crossFamilyReviewer, reasoning: pickReasoning(reasoningCfg.reviewer, crossFamilyReviewer.reasoningOptions || ["high"]) } : null;
	const fastRecon = tiers.fast[0] || null;

	return {
		defaults,
		budget: budgetCfg,
		quotaStatus,
		reasoning: reasoningCfg,
		disabledProviders: runtimeState?.disabledProviders ? Array.from(runtimeState.disabledProviders) : [],
		connectedOpencodeSubproviders: runtimeState?.connectedOpencodeSubproviders ? Array.from(runtimeState.connectedOpencodeSubproviders) : [],
		models: deduplicated,
		tiers,
		recommended: {
			coordinator,
			primaryImplementer: primaryImpl,
			budgetImplementer: budgetImpl,
			crossFamilyReviewer: reviewer,
			fastRecon,
		},
	};
}

export function formatMarkdown(resolved) {
	const lines = [
		`### Active Model Pool (Mode: \`${resolved.budget?.mode || "balanced"}\`)`,
		"",
	];
	if (resolved.disabledProviders?.length) {
		lines.push(`- **Disabled T3 Providers (skipped):** \`${resolved.disabledProviders.join("`, `")}\``);
	}
	if (resolved.QuotaSummary || Object.keys(resolved.quotaStatus || {}).length) {
		const parts = Object.entries(resolved.quotaStatus).map(([prov, q]) => `\`${prov}\`: $${q.spent7dUsd} / $${q.weeklyLimitUsd} 7d eq (${q.percentUsed}%${q.throttled ? " - THROTTLED" : ""})`);
		lines.push(`- **7-Day Rolling Quota Burn:** ${parts.join(" | ")}`);
	}
	lines.push("");
	lines.push("| Capability Tier | Provider | Model ID | Billing | Cost ($/M In/Out/Cache) | Reasoning | Family |");
	lines.push("| :--- | :--- | :--- | :--- | :--- | :--- | :--- |");
	for (const [tierName, entries] of Object.entries(resolved.tiers)) {
		for (const item of entries) {
			const c = item.cost || { input: 0, output: 0, cacheRead: 0 };
			lines.push(`| \`@${tierName}\` | \`${item.providerInstanceId}\` | \`${item.id}\` | \`${item.billing}\` | $${c.input} / $${c.output} / $${c.cacheRead} | \`${item.reasoning}\` | \`${item.family}\` |`);
		}
	}
	lines.push("");
	lines.push("### Recommended Cost-Optimized Routing");
	if (resolved.recommended.coordinator) {
		const c = resolved.recommended.coordinator;
		lines.push(`- **Coordinator (Main Thread):** \`${c.providerInstanceId}:${c.id}\` (\`${c.reasoning}\`, \`${c.billing}\`) — avoids Astra's 10x cached-token burn`);
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
	if (resolved.recommended.crossFamilyReviewer) {
		const rev = resolved.recommended.crossFamilyReviewer;
		lines.push(`- **Independent Reviewer (\`@reviewer\`):** \`${rev.providerInstanceId}:${rev.id}\` (\`${rev.reasoning}\`, family: \`${rev.family}\`)`);
	}
	return lines.join("\n");
}

function loadConfig(customPath) {
	const candidates = [
		customPath,
		path.join(os.homedir(), ".config", "task-router", "model.json"),
		path.join(os.homedir(), ".config", "task-router", "models.json"),
		path.join(SKILL_ROOT, "model.json"),
		path.join(SKILL_ROOT, "models.json"),
	].filter(Boolean);
	for (const file of candidates) {
		if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
	}
	throw new Error(`No model.json found in ${candidates.join(", ")}`);
}

function parseLimitsArg(raw) {
	const out = {};
	for (const part of String(raw || "").split(",")) {
		const [k, v] = part.split("=");
		if (k && v && !Number.isNaN(Number(v))) out[normalizeProvider(k.trim())] = Number(v);
	}
	return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const args = process.argv.slice(2);
	const configIdx = args.indexOf("--config");
	const harnessIdx = args.indexOf("--harness");
	const budgetIdx = args.indexOf("--budget");
	const limitIdx = args.indexOf("--weekly-limit");
	const staticOnly = args.includes("--static");
	const asJson = args.includes("--json");

	const config = loadConfig(configIdx !== -1 ? args[configIdx + 1] : null);
	const runtimeState = staticOnly ? null : discoverRuntimeState();
	const catalogModels = runtimeState ? runtimeState.catalog : CANONICAL_MODELS;
	const activeHarnesses = harnessIdx !== -1 ? args[harnessIdx + 1].split(",").map((h) => normalizeProvider(h.trim())) : null;
	const options = {
		budgetMode: budgetIdx !== -1 ? args[budgetIdx + 1] : undefined,
		weeklyLimits: limitIdx !== -1 ? parseLimitsArg(args[limitIdx + 1]) : undefined,
	};

	const resolved = resolveModels(config, catalogModels, activeHarnesses, runtimeState, options);
	console.log(asJson ? JSON.stringify(resolved, null, 2) : formatMarkdown(resolved));
}
