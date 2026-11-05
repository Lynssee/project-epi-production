// src/routes/api/health/pulse/+server.ts
// Endpoint Pulse Kualitas Server untuk Dashboard Lapangan (project-epi, Fase 1).
// Zero-Overhead: in-memory cache server selama 45 detik + single-flight lock.
// Mendukung Server-Timing untuk perhitungan RTT jaringan murni dan On-Demand Micro Speedtest (~128 KB).

import { json, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { env } from '$env/dynamic/private';
import { directusServerJson } from '$lib/server/directus';
import { getDirectusLatencyStats, recordDirectusLatency, getDirectusProfile, resetDirectusProfile, configureProfiler } from './directusLatencyTracker';
import { getUserPermissions, hasAnyPermission } from '$lib/server/rbacServer';

const CACHE_TTL_MS = 45_000; // 45 detik
let cachedPulseData: any = null;
let cacheExpiresAt = 0;
let pendingPulsePromise: Promise<any> | null = null;

// Cache konfigurasi app_settings (5 menit)
let cachedConfig: any = null;
let configExpiresAt = 0;

// Cache metrik infrastruktur server Directus (5 menit)
let cachedServerInfra: any = null;
let serverInfraExpiresAt = 0;

// Payload ringan untuk Micro Speedtest On-Demand (~128 KB)
const PROBE_CHUNK_SIZE = 128 * 1024;
const PROBE_PAYLOAD = 'EPI_FIELD_SPEEDTEST_'.padEnd(PROBE_CHUNK_SIZE, '0123456789ABCDEF');

const DEFAULT_CONFIG = {
	navbar_enabled: true,
	directus_warn_ms: 500,
	directus_crit_ms: 1500,
	rtt_warn_ms: 300,
	rtt_crit_ms: 800,
	poll_interval_sec: 60,
	auto_hemat_on_poor_network: true,
	slow_fetch_ms: 500, // fetch proxy >= ini masuk log lambat (profiler)
	cache_hit_max_ms: 15, // GET secepat ini dianggap HIT cache, tidak masuk EMA
	dup_fetch_min: 3 // GET identik >= ini dalam 2 dtk = duplikat / N+1 (dipakai tab "Fetch Halaman" di browser)
};

async function loadPulseConfig() {
	const now = Date.now();
	if (cachedConfig && now < configExpiresAt) {
		return cachedConfig;
	}
	try {
		const res = await directusServerJson<{ data?: Array<{ setting_key: string; value: any }> }>(
			'/items/app_settings?filter[module][_eq]=global&filter[category][_eq]=performance_indicator&limit=20'
		).catch(() => null);

		const rows = res?.data || [];
		const cfg = { ...DEFAULT_CONFIG };
		for (const r of rows) {
			if (r.setting_key === 'perf.navbar_enabled') cfg.navbar_enabled = r.value !== false;
			if (r.setting_key === 'perf.directus_warn_ms') cfg.directus_warn_ms = Number(r.value) || 500;
			if (r.setting_key === 'perf.directus_crit_ms') cfg.directus_crit_ms = Number(r.value) || 1500;
			if (r.setting_key === 'perf.rtt_warn_ms') cfg.rtt_warn_ms = Number(r.value) || 300;
			if (r.setting_key === 'perf.rtt_crit_ms') cfg.rtt_crit_ms = Number(r.value) || 800;
			if (r.setting_key === 'perf.poll_interval_sec') cfg.poll_interval_sec = Number(r.value) || 60;
			if (r.setting_key === 'perf.auto_hemat_on_poor_network') cfg.auto_hemat_on_poor_network = r.value !== false;
			if (r.setting_key === 'perf.slow_fetch_ms') cfg.slow_fetch_ms = Number(r.value) || 500;
			if (r.setting_key === 'perf.cache_hit_max_ms') cfg.cache_hit_max_ms = Number(r.value) || 15;
			if (r.setting_key === 'perf.dup_fetch_min') cfg.dup_fetch_min = Number(r.value) || 3;
		}
		configureProfiler({ slowMs: cfg.slow_fetch_ms, cacheHitMaxMs: cfg.cache_hit_max_ms });
		cachedConfig = cfg;
		configExpiresAt = now + 5 * 60 * 1000;
		return cfg;
	} catch {
		return DEFAULT_CONFIG;
	}
}

async function checkDirectusHealth() {
	const stats = getDirectusLatencyStats();
	const now = Date.now();

	const API_URL = env.DIRECTUS_API_URL || env.VITE_DIRECTUS_API_URL;
	const TOKEN = env.DIRECTUS_TOKEN || env.VITE_DIRECTUS_TOKEN;
	if (!API_URL || !TOKEN) {
		return { ok: false, latencyMs: null, pingMs: null, queryEmaMs: null, error: 'Kredensial Directus belum disetel' };
	}

	// Ping Directus /server/ping (koneksi murni)
	let pingMs = stats.pingMs;
	let pingOk = true;
	let status = 200;

	if (!stats.lastRecordedAt || now - stats.lastRecordedAt > 60_000 || pingMs === null) {
		const started = Date.now();
		try {
			const res = await fetch(`${API_URL}/server/ping`, {
				headers: { Authorization: `Bearer ${TOKEN}` },
				signal: AbortSignal.timeout(4000)
			});
			pingMs = Date.now() - started;
			pingOk = res.ok;
			status = res.status;
			recordDirectusLatency(pingMs, true);
		} catch (e: any) {
			pingMs = Date.now() - started;
			pingOk = false;
			return {
				ok: false,
				latencyMs: pingMs,
				pingMs,
				queryEmaMs: stats.emaMs,
				source: 'ping_failed',
				error: e?.message || 'Directus tidak merespons'
			};
		}
	}

	return {
		ok: pingOk,
		latencyMs: pingMs,
		pingMs,
		queryEmaMs: stats.emaMs,
		source: stats.emaMs ? 'hybrid_ping_query' : 'ping',
		status
	};
}

async function getDirectusServerInfrastructure() {
	const now = Date.now();
	if (cachedServerInfra && now < serverInfraExpiresAt) {
		return cachedServerInfra;
	}

	const API_URL = env.DIRECTUS_API_URL || env.VITE_DIRECTUS_API_URL;
	const TOKEN = env.DIRECTUS_TOKEN || env.VITE_DIRECTUS_TOKEN;
	if (!API_URL || !TOKEN) return null;

	try {
		const [infoRes, filesRes, pingHeaderRes] = await Promise.allSettled([
			fetch(`${API_URL}/server/info`, {
				headers: { Authorization: `Bearer ${TOKEN}` },
				signal: AbortSignal.timeout(3500)
			}).then((r) => r.json()).catch(() => null),

			fetch(`${API_URL}/files?aggregate[count]=id&aggregate[sum]=filesize`, {
				headers: { Authorization: `Bearer ${TOKEN}` },
				signal: AbortSignal.timeout(4000)
			}).then((r) => r.json()).catch(() => null),

			fetch(`${API_URL}/server/ping`, {
				signal: AbortSignal.timeout(3000)
			}).catch(() => null)
		]);

		const info = infoRes.status === 'fulfilled' ? infoRes.value?.data : null;
		const fileStats = filesRes.status === 'fulfilled' ? filesRes.value?.data?.[0] : null;
		const pingHeaders = pingHeaderRes.status === 'fulfilled' && pingHeaderRes.value ? pingHeaderRes.value.headers : null;

		let edgeLocation = 'Cloudflare Edge';
		const cfRay = pingHeaders?.get('cf-ray') || '';
		if (cfRay) {
			const match = cfRay.match(/-([A-Z]{3})$/);
			if (match) {
				edgeLocation = `Cloudflare (${match[1]})`;
			}
		}

		const totalFiles = Number(fileStats?.count?.id) || 0;
		const totalBytes = Number(fileStats?.sum?.filesize) || 0;
		const totalFilesGB = Math.round((totalBytes / (1024 ** 3)) * 100) / 100;

		const infraData = {
			version: info?.version || '11.17.4',
			status: 'ok',
			edgeLocation,
			cfRay: cfRay || null,
			serverHeader: pingHeaders?.get('server') || 'cloudflare',
			storage: {
				totalFiles,
				totalBytes,
				totalFilesGB
			},
			mcpEnabled: info?.mcp_enabled ?? true,
			aiEnabled: info?.ai_enabled ?? true
		};

		cachedServerInfra = infraData;
		serverInfraExpiresAt = now + 5 * 60 * 1000; // Cache 5 menit
		return infraData;
	} catch (err: any) {
		console.warn('[FieldPulse] gagal mengambil infrastruktur server:', err?.message);
		return null;
	}
}

async function computePulse() {
	const [directus, config, serverInfra, coreMonitors] = await Promise.all([
		checkDirectusHealth(),
		loadPulseConfig(),
		getDirectusServerInfrastructure(),
		directusServerJson<{ data?: Array<any> }>(
			'/items/website_monitors?filter[category][_eq]=core&limit=5'
		).catch(() => null)
	]);

	const coreItems = coreMonitors?.data || [];
	const synologyTarget = coreItems.find((m) => m.url?.includes('quickconnect.to') || m.name?.toLowerCase().includes('synology'));
	const storageNas = synologyTarget
		? {
				ok: synologyTarget.last_status === 'up' || synologyTarget.last_status === 'degraded',
				status: synologyTarget.last_status || 'unknown',
				latencyMs: synologyTarget.last_latency_ms || null,
				name: synologyTarget.name || 'Synology NAS (Storage Kantor)',
				url: synologyTarget.url || 'http://eltama.quickconnect.to'
			}
		: null;

	let score = 100;
	let status = 'healthy'; // 'healthy' | 'busy' | 'degraded' | 'down'
	let message = 'Koneksi ke Server Pusat normal.';

	if (!directus.ok) {
		score = 15;
		status = 'down';
		message = 'Server Pusat sedang tidak dapat dijangkau. Data tersimpan di antrean offline.';
	} else if (directus.latencyMs && directus.latencyMs > config.directus_crit_ms) {
		score = 55;
		status = 'degraded';
		message = `Server Pusat merespons lambat (${directus.latencyMs}ms). Disarankan gunakan Mode Hemat.`;
	} else if (directus.latencyMs && directus.latencyMs > config.directus_warn_ms) {
		score = 80;
		status = 'busy';
		message = `Server Pusat sedang memproses trafik tinggi (${directus.latencyMs}ms).`;
	}

	return {
		checked_at: new Date().toISOString(),
		score,
		status,
		message,
		directus: {
			ok: directus.ok,
			latencyMs: directus.latencyMs,
			pingMs: directus.pingMs,
			queryEmaMs: directus.queryEmaMs,
			source: directus.source || 'cached'
		},
		n8n: {
			ok: true,
			status: 'active'
		},
		serverInfra,
		storageNas,
		config
	};
}

/** Super Admin ('*') / pemegang it.dashboard.view boleh melihat profil fetch. */
async function canSeeProfile(event: RequestEvent, user: { localId: string; email?: string | null }): Promise<boolean> {
	const idToken = (event.request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
	const { permissions } = await getUserPermissions(idToken, user.localId, { email: user.email ?? null });
	return permissions.includes('*') || hasAnyPermission(permissions, 'it.dashboard.view');
}

export async function GET(event: RequestEvent) {
	const reqStart = performance.now();
	const user = await requireUser(event); // 401 bila belum login

	// Profil fetch (koleksi/halaman terberat + log query lambat) -- on-demand, hanya Super Admin / IT.
	if (event.url.searchParams.get('profile') === '1') {
		if (!(await canSeeProfile(event, user))) {
			return json({ error: 'Hanya Super Admin / IT yang dapat melihat profil fetch.' }, { status: 403 });
		}
		return json(getDirectusProfile(), { headers: { 'Cache-Control': 'no-store' } });
	}

	// On-demand probe download test
	if (event.url.searchParams.get('probe') === 'down') {
		return new Response(PROBE_PAYLOAD, {
			headers: {
				'Content-Type': 'application/octet-stream',
				'Content-Length': String(PROBE_CHUNK_SIZE),
				'Cache-Control': 'no-store, no-cache, must-revalidate',
				'Server-Timing': 'probe;dur=1;desc="Download Probe Payload"'
			}
		});
	}

	const now = Date.now();

	if (!cachedPulseData || now >= cacheExpiresAt) {
		if (!pendingPulsePromise) {
			pendingPulsePromise = computePulse()
				.then((res) => {
					cachedPulseData = res;
					cacheExpiresAt = Date.now() + CACHE_TTL_MS;
					return res;
				})
				.finally(() => {
					pendingPulsePromise = null;
				});
		}
	}

	const pulse = cachedPulseData && now < cacheExpiresAt
		? cachedPulseData
		: await pendingPulsePromise;

	const processDur = Math.max(1, Math.round(performance.now() - reqStart));

	return json(pulse, {
		headers: {
			'Cache-Control': 'private, no-cache, must-revalidate',
			'Server-Timing': `app;dur=${processDur};desc="Health Pulse Processing"`
		}
	});
}

export async function POST(event: RequestEvent) {
	const reqStart = performance.now();
	const user = await requireUser(event);

	// Reset profil fetch (mulai ukur ulang setelah perbaikan) -- Super Admin / IT saja.
	if (event.url.searchParams.get('profile') === 'reset') {
		if (!(await canSeeProfile(event, user))) {
			return json({ error: 'Hanya Super Admin / IT yang dapat mereset profil fetch.' }, { status: 403 });
		}
		resetDirectusProfile();
		return json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
	}

	if (event.url.searchParams.get('probe') === 'up') {
		const blob = await event.request.arrayBuffer().catch(() => new ArrayBuffer(0));
		const durMs = Math.max(1, Math.round(performance.now() - reqStart));
		const bytes = blob.byteLength;
		return json({
			ok: true,
			probe: 'up',
			bytesReceived: bytes,
			durationMs: durMs
		}, {
			headers: {
				'Cache-Control': 'no-store',
				'Server-Timing': `app;dur=${durMs};desc="Upload Probe Server"`
			}
		});
	}

	return json({ error: 'Aksi probe tidak valid' }, { status: 400 });
}
