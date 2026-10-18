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

const CANONICAL_MODELS = [
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
	{ providerInstanceId: "opencode", id: "opencode/glm-5.3", label: "GLM-5.3", family: "zai", tiers: ["workhorse"], generation: "current", reasoningOptions: ["low", "high", "max"], notes: "Open-weight coding workhorse" },
	{ providerInstanceId: "opencode", id: "opencode/glm-5.3-flash", label: "GLM-5.3-Flash", family: "zai", tiers: ["fast"], generation: "current", reasoningOptions: ["low", "high", "max"], notes: "Fast open-weight recon and boilerplate" },
	{ providerInstanceId: "opencode", id: "opencode/kimi-k3", label: "Kimi K3", family: "moonshot", tiers: ["long_context", "workhorse"], generation: "current", reasoningOptions: ["low", "high", "max"], notes: "Deep long-context codebase and log analysis" },
	{ providerInstanceId: "opencode", id: "opencode/deepseek-v4-pro", label: "DeepSeek V4 Pro", family: "deepseek", tiers: ["workhorse"], generation: "current", reasoningOptions: ["low", "high", "max"], notes: "Algorithmic and backend coding workhorse" },
	{ providerInstanceId: "opencode", id: "opencode/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", family: "deepseek", tiers: ["fast"], generation: "current", reasoningOptions: ["low", "high", "max"], notes: "Fast algorithmic and narrow code checks" },
];

export function normalizeProvider(raw) {
	const key = String(raw || "").trim().toLowerCase();
	return PROVIDER_ALIASES[key] || raw;
}

export function globToRegExp(pattern) {
	const escaped = String(pattern).trim().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`, "i");
}

export function matchesPattern(modelId, pattern) {
	const cleanPattern = String(pattern).trim().toLowerCase();
	const fullId = String(modelId).toLowerCase();
	const shortId = fullId.includes("/") ? fullId.split("/").pop() : fullId;
	if (cleanPattern === "all" || cleanPattern === "*") return true;
	if (cleanPattern.includes("*")) {
		const regex = globToRegExp(cleanPattern);
		return regex.test(fullId) || regex.test(shortId);
	}
	return fullId === cleanPattern || shortId === cleanPattern || fullId.includes(cleanPattern) || shortId.includes(cleanPattern);
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

export function canonicalBaseKey(modelId) {
	const lower = String(modelId).toLowerCase();
	const leaf = lower.includes("/") ? lower.split("/").pop() : lower;
	return leaf.replace(/-free$/, "").replace(/-(0731|0813)$/, "").replace(/\./g, "-");
}

export function gatewayPriority(modelId, providerInstanceId) {
	if (providerInstanceId === "codex" || providerInstanceId === "claudeAgent") return 1;
	const lower = String(modelId).toLowerCase();
	if (lower.endsWith("-free")) return 5;
	if (lower.startsWith("google/") || lower.startsWith("anthropic/") || lower.startsWith("openai/")) return 2;
	if (lower.startsWith("opencode/")) return 3;
	if (lower.startsWith("cloudflare-ai-gateway/")) return 4;
	if (lower.startsWith("cloudflare-workers-ai/")) return 4;
	if (lower.startsWith("github-copilot/")) return 6;
	return 4;
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
	const family = lower.includes("gpt") ? "openai" : lower.includes("claude") ? "anthropic" : lower.includes("gemini") ? "google" : lower.includes("glm") ? "zai" : lower.includes("kimi") ? "moonshot" : lower.includes("deepseek") ? "deepseek" : "other";
	const isLegacy = /gpt-5\.|gpt-6-sol$|claude-opus-4|claude-opus-5$/.test(lower);
	const tiers = lower.includes("astra") || lower.includes("opus") ? ["frontier"] : lower.includes("flash") || lower.includes("haiku") || lower.includes("luna") || lower.includes("mini") || lower.includes("nano") ? ["fast"] : lower.includes("kimi") ? ["long_context", "workhorse"] : ["workhorse"];
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

export function resolveModels(config, catalogModels = CANONICAL_MODELS, activeHarnesses = null) {
	const defaults = { latestGenerationOnly: true, preferDirectProvider: true, crossFamilyReview: true, ...(config?.defaults || {}) };
	const reasoningCfg = { frontier: "high", workhorse: "medium", reviewer: "high", fast: "medium", ...(config?.reasoning || {}) };
	const rulesByProvider = parseSelectRules(config?.select || []);
	const enriched = catalogModels.map((m) => classifyModel(m));

	const filtered = enriched.filter((model) => {
		if (activeHarnesses && !activeHarnesses.includes(model.providerInstanceId)) return false;
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
			if (!existing || gatewayPriority(model.id, model.providerInstanceId) < gatewayPriority(existing.id, existing.providerInstanceId)) {
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

	return { defaults, reasoning: reasoningCfg, models: deduplicated, tiers, recommended: { primaryImplementer: primaryImpl, crossFamilyReviewer: reviewer } };
}

export function formatMarkdown(resolved) {
	const lines = [
		"### Active Model Pool (Resolved from `model.json`)",
		"",
		"| Capability Tier | Provider | Model ID | Default Reasoning | Family | Best Used For |",
		"| :--- | :--- | :--- | :--- | :--- | :--- |",
	];
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

function loadCatalogFromCapabilities(capsJson) {
	if (!capsJson || !Array.isArray(capsJson.providers)) return CANONICAL_MODELS;
	const discovered = [];
	for (const provider of capsJson.providers) {
		if (provider.canRunChildTask === false) continue;
		for (const model of provider.models || []) {
			const reasoningOpt = (model.options || []).find((o) => o.id === "reasoningEffort" || o.id === "effort" || o.id === "variant");
			const reasoningOptions = reasoningOpt?.options?.map((o) => o.id) || [];
			discovered.push({ providerInstanceId: provider.providerInstanceId, id: model.id, label: model.label, reasoningOptions });
		}
	}
	for (const canonical of CANONICAL_MODELS) {
		const providerActive = capsJson.providers.some((p) => p.providerInstanceId === canonical.providerInstanceId && p.canRunChildTask !== false);
		const alreadyPresent = discovered.some((d) => d.providerInstanceId === canonical.providerInstanceId && canonicalBaseKey(d.id) === canonicalBaseKey(canonical.id));
		if (providerActive && !alreadyPresent) discovered.push(canonical);
	}
	return discovered.length > 0 ? discovered : CANONICAL_MODELS;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const args = process.argv.slice(2);
	const configIdx = args.indexOf("--config");
	const catalogIdx = args.indexOf("--catalog");
	const harnessIdx = args.indexOf("--harness");
	const asJson = args.includes("--json");

	const config = loadConfig(configIdx !== -1 ? args[configIdx + 1] : null);
	const catalogModels = catalogIdx !== -1 ? loadCatalogFromCapabilities(JSON.parse(fs.readFileSync(args[catalogIdx + 1], "utf8"))) : CANONICAL_MODELS;
	const activeHarnesses = harnessIdx !== -1 ? args[harnessIdx + 1].split(",").map((h) => normalizeProvider(h.trim())) : null;

	const resolved = resolveModels(config, catalogModels, activeHarnesses);
	console.log(asJson ? JSON.stringify(resolved, null, 2) : formatMarkdown(resolved));
}
