// src/lib/services/fleetExpenseTypeApi.ts
// R2 (Audit Konfigurabilitas Lifecycle, 16 Sep 2026): jenis biaya lapangan dinamis dari
// koleksi Directus `fleet_expense_type` — menggantikan JENIS_OPTIONS hardcode
// (bbm/tol/parkir/lain) di biaya-lapangan/+page.svelte. Cache sessionStorage TTL 1 jam.
// CATATAN: gate & UI khusus (odometer wajib utk 'bbm', dst) tetap merujuk kode spesifik
// — menambah jenis baru di Directus TIDAK otomatis memicu perilaku itu, itu memang benar
// (logika bisnis tetap eksplisit per-kode, hanya daftar pilihannya yang jadi dinamis).

import { secureDirectusJson } from './secureDirectus';

export interface FleetExpenseTypeOption {
	value: string;
	label: string;
	emoji: string;
}

const CACHE_KEY = 'fleetExpenseTypes.v1';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 jam

const FALLBACK: FleetExpenseTypeOption[] = [
	{ value: 'bbm', label: 'BBM', emoji: '⛽' },
	{ value: 'tol', label: 'Tol', emoji: '🛣️' },
	{ value: 'parkir', label: 'Parkir', emoji: '🅿️' },
	{ value: 'lain', label: 'Lain-lain', emoji: '📋' }
];

function readCache(): FleetExpenseTypeOption[] | null {
	if (typeof sessionStorage === 'undefined') return null;
	try {
		const raw = sessionStorage.getItem(CACHE_KEY);
		if (!raw) return null;
		const { at, data } = JSON.parse(raw);
		if (Date.now() - at > CACHE_TTL_MS) return null;
		return data;
	} catch {
		return null;
	}
}

function writeCache(data: FleetExpenseTypeOption[]) {
	if (typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
	} catch {
		/* storage penuh/nonaktif — abaikan */
	}
}

/** Jenis biaya lapangan aktif. Gagal-lunak: fallback 4 jenis lama bila proxy error/kosong. */
export async function getActiveFleetExpenseTypes(forceRefresh = false): Promise<FleetExpenseTypeOption[]> {
	if (!forceRefresh) {
		const cached = readCache();
		if (cached) return cached;
	}
	try {
		const res = await secureDirectusJson<any>(
			'/items/fleet_expense_type?filter[is_active][_eq]=true&sort=sort,id&fields=key,label,emoji&limit=-1'
		);
		const rows = (res?.data || [])
			.filter((r: any) => r.key && r.label)
			.map((r: any) => ({ value: r.key, label: r.label, emoji: r.emoji || '📋' }));
		if (rows.length === 0) return FALLBACK;
		writeCache(rows);
		return rows;
	} catch (e) {
		console.warn('[fleetExpenseTypeApi] gagal memuat jenis biaya, form jatuh ke fallback statis:', e);
		return FALLBACK;
	}
}
