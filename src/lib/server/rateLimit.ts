// src/lib/server/rateLimit.ts
// Fase 3 keamanan pondasi (rencana "Package & Fitur Addons" §5) — rate limiter
// in-memory per-process, fixed-window. Sama seperti erp-epi-1's rateLimit.js:
// best-effort, reset saat restart, tidak konsisten lintas banyak instance —
// cukup untuk app ini yang jalan sebagai 1 proses Node (adapter-node, bukan cluster).

const buckets = new Map<string, number[]>();

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupStaleBuckets(now: number) {
	if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
	lastCleanup = now;
	for (const [key, timestamps] of buckets) {
		if (timestamps.every((t) => now - t > CLEANUP_INTERVAL_MS)) buckets.delete(key);
	}
}

export function isRateLimited(key: string, opts: { windowMs: number; max: number }): boolean {
	const { windowMs, max } = opts;
	const now = Date.now();
	cleanupStaleBuckets(now);
	const timestamps = (buckets.get(key) || []).filter((t) => now - t < windowMs);
	timestamps.push(now);
	buckets.set(key, timestamps);
	return timestamps.length > max;
}
