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
	{ providerInstanceId: "codex", id: "gpt-6-astra", label: "GPT-6-Astra", family: "openai", tiers: ["frontier"], generation: "current", reasoningOptions: ["low", "medium", "high", "xhigh", "max", "ultra"], notes: "Frontier intelligence for hardest architecture, security, and review" },
	{ providerInstanceId: "codex", id: "gpt-6.1-sol", label: "GPT-6.1-Sol", family: "openai", tiers: ["workhorse", "long_context"], generation: "current", reasoningOptions: ["low", "medium", "high", "xhigh", "max", "ultra"], notes: "Primary coding workhorse (500k context) and integrator" },
	{ providerInstanceId: "codex", id: "gpt-6-luna", label: "GPT-6-Luna", family: "openai", tiers: ["fast"], generation: "current", reasoningOptions: ["low", "medium", "high", "xhigh", "max"], notes: "Fast, low-cost recon and narrow checks" },
	{ providerInstanceId: "codex", id: "gpt-6-sol", label: "GPT-6-Sol", family: "openai", tiers: ["workhorse"], generation: "legacy", reasoningOptions: ["low", "medium", "high", "xhigh", "max", "ultra"], notes: "Superseded by gpt-6.1-sol" },
	{ providerInstanceId: "codex", id: "gpt-5.6-sol", label: "GPT-5.6-Sol", family: "openai", tiers: ["workhorse"], generation: "legacy", reasoningOptions: ["low", "medium", "high", "xhigh", "max", "ultra"], notes: "Legacy 5.6 generation" },
	{ providerInstanceId: "codex", id: "gpt-5.6-terra", label: "GPT-5.6-Terra", family: "openai", tiers: ["workhorse"], generation: "legacy", reasoningOptions: ["low", "medium", "high", "xhigh", "max", "ultra"], notes: "Legacy 5.6 generation" },
	{ providerInstanceId: "codex", id: "gpt-5.6-luna", label: "GPT-5.6-Luna", family: "openai", tiers: ["fast"], generation: "legacy", reasoningOptions: ["low", "medium", "high", "xhigh", "max"], notes: "Legacy 5.6 generation" },
	{ providerInstanceId: "claudeAgent", id: "claude-opus-5-5", label: "Claude Opus 5.5", family: "anthropic", tiers: ["frontier", "long_context"], generation: "current", reasoningOptions: ["low", "medium", "high", "xhigh", "max", "ultracode", "ultrathink"], notes: "Frontier reasoning, complex refactors, and adversarial review" },
	{ providerInstanceId: "claudeAgent", id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", family: "anthropic", tiers: ["workhorse"], generation: "current", reasoningOptions: ["low", "medium", "high", "xhigh", "max", "ultrathink"], notes: "Fast UI/DOM/SPA implementation and browser verification" },
	{ providerInstanceId: "claudeAgent", id: "claude-haiku-5-5", label: "Claude Haiku 5.5", family: "anthropic", tiers: ["fast"], generation: "current", reasoningOptions: ["low", "medium", "high", "xhigh", "max", "ultrathink"], notes: "Fast read-only exploration and narrow checks" },
	{ providerInstanceId: "claudeAgent", id: "claude-fable-5-1", label: "Claude Fable 5.1", family: "anthropic", tiers: ["workhorse"], generation: "current", reasoningOptions: ["low", "medium", "high", "xhigh", "max", "ultracode", "ultrathink"], notes: "Specialized creative/writing model" },
	{ providerInstanceId: "claudeAgent", id: "claude-opus-5", label: "Claude Opus 5", family: "anthropic", tiers: ["frontier"], generation: "legacy", reasoningOptions: ["low", "medium", "high", "xhigh", "max"], notes: "Superseded by claude-opus-5-5" },
	{ providerInstanceId: "claudeAgent", id: "claude-opus-4-8", label: "Claude Opus 4.8", family: "anthropic", tiers: ["frontier"], generation: "legacy", reasoningOptions: ["low", "medium", "high", "xhigh", "max"], notes: "Superseded by claude-opus-5-5" },
	{ providerInstanceId: "opencode", id: "google/gemini-4-argon", label: "Gemini 4 Argon", family: "google", tiers: ["frontier", "workhorse", "long_context"], generation: "current", reasoningOptions: ["low", "medium", "high"], notes: "Broad multi-file synthesis, long-context recon, and cross-family review" },
	{ providerInstanceId: "opencode", id: "opencode/gemini-3.8-flash", label: "Gemini 3.8 Flash", family: "google", tiers: ["fast"], generation: "current", reasoningOptions: ["low", "medium", "high"], notes: "Fast search, doc checks, and lightweight tasks" },
	{ providerInstanceId: "opencode", id: "cloudflare-workers-ai/@cf/zai-org/glm-5.3", label: "GLM 5.3", family: "zai", tiers: ["workhorse"], generation: "current", reasoningOptions: ["low", "high", "max"], notes: "Open-weight coding workhorse" },
	{ providerInstanceId: "opencode", id: "cloudflare-workers-ai/@cf/zai-org/glm-5.3-flash", label: "GLM 5.3 Flash", family: "zai", tiers: ["fast"], generation: "current", reasoningOptions: ["low", "high", "max"], notes: "Fast open-weight recon and boilerplate" },
	{ providerInstanceId: "opencode", id: "opencode/kimi-k3", label: "Kimi K3", family: "moonshot", tiers: ["long_context", "workhorse"], generation: "current", reasoningOptions: ["low", "high", "max"], notes: "Deep long-context codebase and log analysis" },
	{ providerInstanceId: "opencode", id: "cloudflare-workers-ai/@cf/deepseek-ai/deepseek-v4-pro-0813", label: "DeepSeek V4 Pro", family: "deepseek", tiers: ["workhorse"], generation: "current", reasoningOptions: ["low", "high", "max"], notes: "Algorithmic and backend coding workhorse" },
	{ providerInstanceId: "opencode", id: "cloudflare-workers-ai/@cf/deepseek-ai/deepseek-v4-flash-0731", label: "DeepSeek V4 Flash", family: "deepseek", tiers: ["fast"], generation: "current", reasoningOptions: ["low", "high", "max"], notes: "Fast algorithmic and narrow code checks" },
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
	if (known) {
		return {
			...known,
			providerInstanceId: model.providerInstanceId || known.providerInstanceId,
			id: model.id,
			label: model.label || known.label,
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
				catalog.push({ providerInstanceId: "codex", id: m.slug, label: m.display_name || m.slug, reasoningOptions });
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
					catalog.push({
						providerInstanceId: "opencode",
						id: fullId,
						label: modelInfo?.name || fullId,
						reasoningOptions: effortValues.length > 0 ? effortValues : [],
					});
				}
			}
		} catch {}
	}

	return {
		disabledProviders,
		hiddenModelsByProvider,
		favorites,
		modelOrder,
		connectedOpencodeSubproviders,
		catalog: catalog.length > 0 ? catalog : CANONICAL_MODELS,
	};
}

export function resolveModels(config, catalogModels = CANONICAL_MODELS, activeHarnesses = null, runtimeState = null) {
	const defaults = { latestGenerationOnly: true, preferDirectProvider: true, crossFamilyReview: true, respectRuntimeSettings: true, ...(config?.defaults || {}) };
	const reasoningCfg = { frontier: "high", workhorse: "medium", reviewer: "high", fast: "medium", ...(config?.reasoning || {}) };
	const rulesByProvider = parseSelectRules(config?.select || []);
	const enriched = catalogModels.map((m) => classifyModel(m));

	const filtered = enriched.filter((model) => {
		if (activeHarnesses && !activeHarnesses.includes(model.providerInstanceId)) return false;
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

	const tiers = { frontier: [], workhorse: [], long_context: [], fast: [] };
	for (const model of deduplicated) {
		for (const tier of model.tiers) {
			if (!tiers[tier]) continue;
			const desiredEffort = tier === "frontier" ? reasoningCfg.frontier : tier === "fast" ? reasoningCfg.fast : tier === "long_context" ? "high" : reasoningCfg.workhorse;
			tiers[tier].push({
				providerInstanceId: model.providerInstanceId,
				id: model.id,
				label: model.label,
				family: model.family,
				reasoning: pickReasoning(desiredEffort, model.reasoningOptions),
				notes: model.notes,
			});
		}
	}

	const primaryImpl = tiers.workhorse[0] || tiers.frontier[0] || tiers.fast[0] || null;
	const reviewerPool = [...tiers.frontier, ...tiers.workhorse];
	const crossFamilyReviewer = defaults.crossFamilyReview && primaryImpl ? reviewerPool.find((m) => m.family !== primaryImpl.family) || reviewerPool[0] : reviewerPool[0] || null;
	const reviewer = crossFamilyReviewer ? { ...crossFamilyReviewer, reasoning: pickReasoning(reasoningCfg.reviewer, crossFamilyReviewer.reasoningOptions || ["high"]) } : null;

	return {
		defaults,
		reasoning: reasoningCfg,
		disabledProviders: runtimeState?.disabledProviders ? Array.from(runtimeState.disabledProviders) : [],
		connectedOpencodeSubproviders: runtimeState?.connectedOpencodeSubproviders ? Array.from(runtimeState.connectedOpencodeSubproviders) : [],
		models: deduplicated,
		tiers,
		recommended: { primaryImplementer: primaryImpl, crossFamilyReviewer: reviewer },
	};
}

export function formatMarkdown(resolved) {
	const lines = [
		"### Active Model Pool (Resolved from `model.json` + Live Connections)",
		"",
	];
	if (resolved.disabledProviders?.length) {
		lines.push(`- **Disabled T3 Providers (skipped):** \`${resolved.disabledProviders.join("`, `")}\``);
	}
	if (resolved.connectedOpencodeSubproviders?.length) {
		lines.push(`- **Connected OpenCode Gateways:** \`${resolved.connectedOpencodeSubproviders.join("`, `")}\``);
	}
	if (resolved.disabledProviders?.length || resolved.connectedOpencodeSubproviders?.length) lines.push("");
	lines.push("| Capability Tier | Provider | Model ID | Default Reasoning | Family | Best Used For |");
	lines.push("| :--- | :--- | :--- | :--- | :--- | :--- |");
	for (const [tierName, entries] of Object.entries(resolved.tiers)) {
		for (const item of entries) {
			lines.push(`| \`@${tierName}\` | \`${item.providerInstanceId}\` | \`${item.id}\` | \`${item.reasoning}\` | \`${item.family}\` | ${item.notes || "-"} |`);
		}
	}
	lines.push("");
	lines.push("### Default Cross-Family Pairing");
	if (resolved.recommended.primaryImplementer) {
		const impl = resolved.recommended.primaryImplementer;
		lines.push(`- **Primary Implementer (` + "`@workhorse`" + `):** \`${impl.providerInstanceId}:${impl.id}\` (\`${impl.reasoning}\` reasoning, family: \`${impl.family}\`)`);
	}
	if (resolved.recommended.crossFamilyReviewer) {
		const rev = resolved.recommended.crossFamilyReviewer;
		lines.push(`- **Independent Reviewer (` + "`@reviewer`" + `):** \`${rev.providerInstanceId}:${rev.id}\` (\`${rev.reasoning}\` reasoning, family: \`${rev.family}\`)`);
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

if (import.meta.url === `file://${process.argv[1]}`) {
	const args = process.argv.slice(2);
	const configIdx = args.indexOf("--config");
	const harnessIdx = args.indexOf("--harness");
	const staticOnly = args.includes("--static");
	const asJson = args.includes("--json");

	const config = loadConfig(configIdx !== -1 ? args[configIdx + 1] : null);
	const runtimeState = staticOnly ? null : discoverRuntimeState();
	const catalogModels = runtimeState ? runtimeState.catalog : CANONICAL_MODELS;
	const activeHarnesses = harnessIdx !== -1 ? args[harnessIdx + 1].split(",").map((h) => normalizeProvider(h.trim())) : null;

	const resolved = resolveModels(config, catalogModels, activeHarnesses, runtimeState);
	console.log(asJson ? JSON.stringify(resolved, null, 2) : formatMarkdown(resolved));
}
