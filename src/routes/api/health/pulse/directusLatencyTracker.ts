// src/routes/api/health/pulse/directusLatencyTracker.ts
// Tracker pasif latensi Directus upstream di memori server untuk Dashboard Lapangan.
// Memisahkan ping koneksi murni dari durasi query data berat.
//
// Fase 1 (rencana monitoring fetch & optimasi): selain EMA, tracker merekam PROFIL fetch
// per koleksi & per halaman (Referer) + ring buffer query lambat. Semua di memori proses
// (tanpa tulis ke Directus -> tidak ada write-amplification), dibatasi ukurannya, dan
// dibaca on-demand lewat GET /api/health/pulse?profile=1 (khusus Super Admin / IT).
// Kembar src/routes/api/health/pulse/directusLatencyTracker.js di erp-epi.
//
// Status cache:
//   HIT       -- dilayani cache (tidak menyentuh Directus) -> TIDAK masuk EMA/rata-rata upstream
//   MISS      -- menempuh round-trip ke Directus
//   COALESCED -- menumpang request identik yang sedang berjalan -> TIDAK masuk EMA (hindari hitung ganda)
//   BYPASS    -- tulis (POST/PATCH/DELETE) atau pembacaan paksa segar

export type CacheStatus = 'HIT' | 'MISS' | 'COALESCED' | 'BYPASS';

const CFG = {
	slowMs: 500, // fetch >= ini masuk log lambat
	cacheHitMaxMs: 15, // GET secepat ini dianggap HIT cache (round-trip Cloudflare SIN ~180 ms, tak mungkin sub-15 ms)
	ringSize: 200,
	maxKeys: 150 // batas jumlah koleksi / route terlacak; yang paling sepi dibuang
};

/** Ubah ambang profiler (dipanggil dari pembaca app_settings). Nilai tak valid diabaikan. */
export function configureProfiler(partial: { slowMs?: number; cacheHitMaxMs?: number } = {}): void {
	const slow = Number(partial.slowMs);
	if (Number.isFinite(slow) && slow >= 50 && slow <= 60_000) CFG.slowMs = Math.round(slow);
	const hit = Number(partial.cacheHitMaxMs);
	if (Number.isFinite(hit) && hit >= 1 && hit <= 200) CFG.cacheHitMaxMs = Math.round(hit);
}

let lastPingMs: number | null = null;
let lastQueryMs: number | null = null;
let emaQueryMs: number | null = null;
let lastRecordedAt: number | null = null;

/**
 * Catat durasi request Directus upstream (dalam milidetik).
 */
export function recordDirectusLatency(ms: number, isPing = false): void {
	if (typeof ms !== 'number' || isNaN(ms) || ms < 0) return;
	const rounded = Math.round(ms);
	lastRecordedAt = Date.now();
	if (isPing) {
		lastPingMs = rounded;
		return;
	}
	lastQueryMs = rounded;
	if (emaQueryMs === null) {
		emaQueryMs = rounded;
	} else if (rounded <= 4000) {
		// Alpha = 0.35: tanggap terhadap fluktuasi sinyal lapangan, abaikan spike > 4 detik
		emaQueryMs = Math.round(0.35 * rounded + 0.65 * emaQueryMs);
	}
}

/**
 * Ambil statistik latensi Directus terbaru dari memori.
 */
export function getDirectusLatencyStats(): {
	pingMs: number | null;
	currentMs: number | null;
	emaMs: number | null;
	lastRecordedAt: number | null;
} {
	return {
		pingMs: lastPingMs,
		currentMs: lastQueryMs,
		emaMs: emaQueryMs,
		lastRecordedAt
	};
}

// ---------------------------------------------------------------------------
// Profil fetch (koleksi, halaman, query lambat)
// ---------------------------------------------------------------------------

interface CollectionBucket { calls: number; hit: number; coalesced: number; upstream: number; sumMs: number; maxMs: number; errors: number; unbounded: number; wildcard: number; bytes: number }
interface RouteBucket { calls: number; hit: number; upstream: number; sumMs: number; maxMs: number; slow: number; unbounded: number; wildcard: number; bytes: number }
interface SlowEntry {
	at: string; method: string; collection: string; path: string; route: string; durMs: number; status: number; bytes: number;
	cache: CacheStatus; limit: string | null; fields: string | null; params: string[]; unboundedLimit: boolean; wildcardFields: boolean;
}

const byCollection = new Map<string, CollectionBucket>();
const byRoute = new Map<string, RouteBucket>();
const slowRing: SlowEntry[] = [];
const totals = { calls: 0, hit: 0, miss: 0, coalesced: 0, bypass: 0, errors: 0, startedAt: Date.now() };

/** Klasifikasi cache berdasar durasi, untuk proxy yang tidak tahu pasti (cache ada di lapisan lain). */
export function classifyCache(method: string | undefined, durMs: number, bypass = false): CacheStatus {
	const m = String(method || 'GET').toUpperCase();
	if (bypass || (m !== 'GET' && m !== 'HEAD')) return 'BYPASS';
	return durMs <= CFG.cacheHitMaxMs ? 'HIT' : 'MISS';
}

/** items/<koleksi>[/id] -> koleksi; selain itu segmen pertama (files, assets, users, ...). */
export function collectionOf(path: string | undefined): string {
	const parts = String(path || '').split('/').filter(Boolean);
	if (parts[0] === 'items' && parts[1]) return parts[1];
	return parts[0] || '(root)';
}

/**
 * Deteksi pola overfetch dari query string. Hanya mengembalikan NILAI limit/fields dan
 * DAFTAR NAMA parameter lain -- nilai filter tidak disimpan (bisa memuat email/nama).
 */
export function parseQueryShape(search: string | undefined) {
	const out = { unboundedLimit: false, wildcardFields: false, limit: null as string | null, fields: null as string | null, params: [] as string[] };
	try {
		const sp = new URLSearchParams(String(search || '').replace(/^\?/, ''));
		for (const [k, v] of sp.entries()) {
			if (k === 'limit') {
				out.limit = v;
				if (v === '-1') out.unboundedLimit = true;
			} else if (k === 'fields' || k === 'fields[]') {
				out.fields = out.fields ? `${out.fields},${v}` : v;
				if (v.split(',').some((f) => f.trim() === '*' || f.trim().endsWith('.*'))) out.wildcardFields = true;
			} else {
				out.params.push(k.length > 40 ? `${k.slice(0, 40)}…` : k);
			}
		}
	} catch {
		/* query tak terbaca -> tanpa flag */
	}
	return out;
}

/** Seragamkan id numerik / uuid / hex panjang di pathname agar /projects/12 dan /projects/57 jadi satu route. */
export function normalizeRoute(pathname: string | null | undefined): string {
	if (!pathname || typeof pathname !== 'string') return '(tanpa referer)';
	return (
		pathname
			.split('/')
			.map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) || /^[0-9a-f]{16,}$/i.test(seg) ? ':id' : seg))
			.join('/')
			.slice(0, 160) || '/'
	);
}

/** Pathname dari header Referer, null bila tak ada / tak valid. */
export function refererPath(request: Request): string | null {
	try {
		const ref = request?.headers?.get?.('referer');
		return ref ? new URL(ref).pathname : null;
	} catch {
		return null;
	}
}

function evictLeastBusy(map: Map<string, { calls: number }>): void {
	if (map.size <= CFG.maxKeys) return;
	let victim: string | null = null;
	let min = Infinity;
	for (const [k, v] of map) {
		if (v.calls < min) {
			min = v.calls;
			victim = k;
		}
	}
	if (victim !== null) map.delete(victim);
}

function bucket<T extends { calls: number }>(map: Map<string, T>, key: string, init: () => T): T {
	let b = map.get(key);
	if (!b) {
		b = init();
		map.set(key, b);
		evictLeastBusy(map);
	}
	return b;
}

export interface DirectusRequestRecord {
	method?: string;
	path: string;
	search?: string;
	referer?: string | null;
	durMs: number;
	status?: number;
	bytes?: number;
	cache?: CacheStatus;
}

/**
 * Catat satu request proxy Directus. EMA hanya diperbarui oleh request yang benar-benar menempuh
 * upstream (bukan HIT/COALESCED). Tidak pernah melempar.
 */
export function recordDirectusRequest(r: DirectusRequestRecord): void {
	try {
		const durMs = Math.max(0, Math.round(Number(r.durMs) || 0));
		const status = Number(r.status) || 0;
		const cache: CacheStatus = r.cache || classifyCache(r.method, durMs);
		const upstream = cache === 'MISS' || cache === 'BYPASS';
		const isError = status >= 400;
		const bytes = Math.max(0, Number(r.bytes) || 0);
		const shape = parseQueryShape(r.search);
		const collection = collectionOf(r.path);
		const route = normalizeRoute(r.referer);

		totals.calls++;
		if (cache === 'HIT') totals.hit++;
		else if (cache === 'COALESCED') totals.coalesced++;
		else if (cache === 'BYPASS') totals.bypass++;
		else totals.miss++;
		if (isError) totals.errors++;

		if (upstream) recordDirectusLatency(durMs);

		const c = bucket(byCollection, collection, () => ({ calls: 0, hit: 0, coalesced: 0, upstream: 0, sumMs: 0, maxMs: 0, errors: 0, unbounded: 0, wildcard: 0, bytes: 0 }));
		c.calls++;
		c.bytes += bytes;
		if (isError) c.errors++;
		if (shape.unboundedLimit) c.unbounded++;
		if (shape.wildcardFields) c.wildcard++;
		if (cache === 'HIT') c.hit++;
		else if (cache === 'COALESCED') c.coalesced++;
		else {
			c.upstream++;
			c.sumMs += durMs;
			if (durMs > c.maxMs) c.maxMs = durMs;
		}

		const rt = bucket(byRoute, route, () => ({ calls: 0, hit: 0, upstream: 0, sumMs: 0, maxMs: 0, slow: 0, unbounded: 0, wildcard: 0, bytes: 0 }));
		rt.calls++;
		rt.bytes += bytes;
		if (shape.unboundedLimit) rt.unbounded++;
		if (shape.wildcardFields) rt.wildcard++;
		if (cache === 'HIT' || cache === 'COALESCED') rt.hit++;
		else {
			rt.upstream++;
			rt.sumMs += durMs;
			if (durMs > rt.maxMs) rt.maxMs = durMs;
		}

		if (upstream && durMs >= CFG.slowMs) {
			rt.slow++;
			slowRing.push({
				at: new Date().toISOString(),
				method: String(r.method || 'GET').toUpperCase(),
				collection,
				path: String(r.path || '').slice(0, 160),
				route,
				durMs,
				status,
				bytes,
				cache,
				limit: shape.limit,
				fields: shape.fields ? shape.fields.slice(0, 120) : null,
				params: shape.params.slice(0, 12),
				unboundedLimit: shape.unboundedLimit,
				wildcardFields: shape.wildcardFields
			});
			if (slowRing.length > CFG.ringSize) slowRing.shift();
		}
	} catch {
		/* profiler tidak boleh mengganggu request */
	}
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null);

/** Snapshot profil untuk UI (read-only, dihitung saat diminta). */
export function getDirectusProfile({ topN = 20, slowLimit = 50 }: { topN?: number; slowLimit?: number } = {}) {
	const readTotal = totals.hit + totals.miss + totals.coalesced;
	const collections = [...byCollection.entries()]
		.map(([name, c]) => ({
			name,
			calls: c.calls,
			upstreamCalls: c.upstream,
			cacheHitPct: pct(c.hit + c.coalesced, c.hit + c.coalesced + c.upstream),
			avgMs: c.upstream ? Math.round(c.sumMs / c.upstream) : null,
			maxMs: c.maxMs,
			totalMs: c.sumMs,
			errors: c.errors,
			unboundedLimit: c.unbounded,
			wildcardFields: c.wildcard,
			kb: Math.round(c.bytes / 1024)
		}))
		.sort((a, b) => b.totalMs - a.totalMs)
		.slice(0, topN);

	const routes = [...byRoute.entries()]
		.map(([name, r]) => ({
			name,
			calls: r.calls,
			upstreamCalls: r.upstream,
			avgMs: r.upstream ? Math.round(r.sumMs / r.upstream) : null,
			maxMs: r.maxMs,
			totalMs: r.sumMs,
			slow: r.slow,
			unboundedLimit: r.unbounded,
			wildcardFields: r.wildcard,
			kb: Math.round(r.bytes / 1024)
		}))
		.sort((a, b) => b.totalMs - a.totalMs)
		.slice(0, topN);

	return {
		since: new Date(totals.startedAt).toISOString(),
		config: { ...CFG },
		totals: {
			calls: totals.calls,
			hit: totals.hit,
			miss: totals.miss,
			coalesced: totals.coalesced,
			bypass: totals.bypass,
			errors: totals.errors,
			cacheHitPct: pct(totals.hit + totals.coalesced, readTotal)
		},
		collections,
		routes,
		slow: slowRing.slice(-slowLimit).reverse()
	};
}

/** Kosongkan seluruh profil (EMA tidak disentuh). */
export function resetDirectusProfile(): void {
	byCollection.clear();
	byRoute.clear();
	slowRing.length = 0;
	Object.assign(totals, { calls: 0, hit: 0, miss: 0, coalesced: 0, bypass: 0, errors: 0, startedAt: Date.now() });
}
