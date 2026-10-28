// src/lib/services/departmentApi.ts
// R1 (Audit Konfigurabilitas Lifecycle, 16 Sep 2026): daftar departemen dinamis dari
// koleksi Directus `department` (sudah ada, dipakai command_center) — menggantikan
// DEPARTMENTS hardcode 19 nama di procurement/ajukan/+page.svelte. Cache sessionStorage
// TTL 1 jam, departemen jarang berubah (hemat API sesuai instruksi umum).

import { secureDirectusJson } from './secureDirectus';

const CACHE_KEY = 'departments.v1';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 jam

function readCache(): string[] | null {
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

function writeCache(data: string[]) {
	if (typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
	} catch {
		/* storage penuh/nonaktif — abaikan */
	}
}

/** Nama departemen aktif, diurutkan sort/nama. Gagal-lunak: fallback ke daftar lama di caller bila array kosong. */
export async function getActiveDepartmentNames(forceRefresh = false): Promise<string[]> {
	if (!forceRefresh) {
		const cached = readCache();
		if (cached) return cached;
	}
	try {
		const res = await secureDirectusJson<any>(
			'/items/department?filter[is_active][_eq]=true&sort=sort,nama_department&fields=nama_department&limit=-1'
		);
		const names = (res?.data || []).map((d: any) => d.nama_department).filter(Boolean);
		if (names.length === 0) return [];
		writeCache(names);
		return names;
	} catch (e) {
		console.warn('[departmentApi] gagal memuat daftar departemen, form jatuh ke fallback statis:', e);
		return [];
	}
}
