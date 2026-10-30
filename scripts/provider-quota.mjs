import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const quotaCacheFile = (homeDir) => path.join(homeDir, ".config", "task-router", "claude-quota.json");
const QUOTA_CACHE_MAX_AGE_MS = 15 * 60_000;

export async function readClaudeQuota(homeDir = os.homedir(), fetchImpl = fetch, nowMs = Date.now()) {
	const sourceFile = "https://api.anthropic.com/api/oauth/usage";
	try {
		const credentials = JSON.parse(fs.readFileSync(path.join(homeDir, ".claude", ".credentials.json"), "utf8"));
		const oauth = credentials.claudeAiOauth;
		if (!oauth?.accessToken || (Number.isFinite(oauth.expiresAt) && oauth.expiresAt <= nowMs)) {
			return { error: "Claude OAuth login missing or expired; check claude /usage", sourceFile };
		}
		// Use the same read-only endpoint as Claude /usage; never refresh or log credentials.
		const response = await fetchImpl(sourceFile, {
			headers: { Authorization: `Bearer ${oauth.accessToken}`, "anthropic-beta": "oauth-2025-04-20" },
			signal: AbortSignal.timeout(5000),
		});
		if (response.status === 429) {
			// Back-to-back resolver runs get rate-limited; reuse the last reading, which keeps its original observed time.
			try {
				const cached = JSON.parse(fs.readFileSync(quotaCacheFile(homeDir), "utf8"));
				if (nowMs - cached.eventTsMs < QUOTA_CACHE_MAX_AGE_MS) return cached;
			} catch {}
		}
		if (!response.ok) return { error: `Claude quota request failed (HTTP ${response.status}); check claude /usage`, sourceFile };
		const data = await response.json();
		const windows = [["five_hour", 300], ["seven_day", 10080]].flatMap(([name, windowMinutes]) => {
			const value = data[name];
			const resetsAtSec = Date.parse(value?.resets_at) / 1000;
			return Number.isFinite(value?.utilization) && value.utilization >= 0 && value.utilization <= 100 && resetsAtSec * 1000 > nowMs
				? [{ usedPercent: value.utilization, windowMinutes, resetsAtSec }]
				: [];
		});
		if (!windows.length) return { error: "Claude quota response has no current usage windows", sourceFile };
		const weekly = windows.find((w) => w.windowMinutes === 10080);
		const quota = {
			usedPercent: weekly?.usedPercent ?? null,
			windowMinutes: weekly?.windowMinutes ?? null,
			resetsAtSec: weekly?.resetsAtSec ?? null,
			windows,
			eventTsMs: nowMs,
			sourceFile,
		};
		try {
			fs.mkdirSync(path.dirname(quotaCacheFile(homeDir)), { recursive: true });
			fs.writeFileSync(quotaCacheFile(homeDir), JSON.stringify(quota), { mode: 0o600 });
		} catch {}
		return quota;
	} catch {
		return { error: "Claude quota unavailable; check claude /usage", sourceFile };
	}
}

const blockFile = (homeDir) => path.join(homeDir, ".config", "task-router", "provider-blocks.json");

export function readProviderBlocks(homeDir = os.homedir(), nowMs = Date.now()) {
	const file = blockFile(homeDir);
	if (!fs.existsSync(file)) return {};
	const blocks = JSON.parse(fs.readFileSync(file, "utf8"));
	if (!blocks || typeof blocks !== "object" || Array.isArray(blocks)) throw new Error(`Invalid provider blocks: ${file}`);
	return Object.fromEntries(Object.entries(blocks).filter(([, until]) => {
		if (until !== null && !Number.isFinite(Date.parse(until))) throw new Error(`Invalid provider block reset in ${file}`);
		return until === null || Date.parse(until) > nowMs;
	}));
}

export function recordProviderBlock(provider, until, homeDir = os.homedir(), nowMs = Date.now()) {
	if (!["codex", "claudeAgent", "opencode", "cloudflare", "anthropic"].includes(provider)) throw new Error(`Unknown block provider: ${provider}`);
	if (until !== null && (!Number.isFinite(Date.parse(until)) || Date.parse(until) <= nowMs)) throw new Error("Block reset must be a future ISO timestamp; omit it when unknown");
	updateProviderBlocks(homeDir, nowMs, (blocks) => { blocks[provider] = until; });
}

function updateProviderBlocks(homeDir, nowMs, update) {
	const file = blockFile(homeDir);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	// Concurrent coordinators must fail visibly instead of overwriting each other's blocks.
	const lockFile = `${file}.lock`;
	const lock = fs.openSync(lockFile, "wx", 0o600);
	try {
		const blocks = readProviderBlocks(homeDir, nowMs);
		update(blocks);
		const tmp = `${file}.${process.pid}.tmp`;
		fs.writeFileSync(tmp, `${JSON.stringify(blocks, null, 2)}\n`, { mode: 0o600 });
		fs.renameSync(tmp, file);
	} finally {
		fs.closeSync(lock);
		fs.unlinkSync(lockFile);
	}
}

export function clearProviderBlock(provider, homeDir = os.homedir()) {
	updateProviderBlocks(homeDir, Date.now(), (blocks) => { delete blocks[provider]; });
}
