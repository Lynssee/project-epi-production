// src/lib/server/ess/polaKerjaResolver.ts
// Wrapper server (I/O) untuk resolvePolaKerja() — ambil karyawan.pola_kerja, lalu bila kosong
// cocokkan karyawan.divisi ke department.nama_department untuk pola_kerja_default. karyawan
// TIDAK punya FK department_id asli (hanya kolom teks `divisi`) — pola pencocokan sama seperti
// erp-epi/src/lib/services/hrdEmployeeApi.js.

import { directusServerJson } from '$lib/server/directus';
import { resolvePolaKerja, type PolaKerja } from '$lib/utils/resolvePolaKerja';

const POLA_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_POLA_CACHE = 500;
const polaKerjaCache = new Map<string, { at: number; value: PolaKerja }>();
const polaKerjaInflight = new Map<string, Promise<PolaKerja>>();
const deptPolaCache = new Map<string, { at: number; value: string | null }>();
const deptPolaInflight = new Map<string, Promise<string | null>>();

export function clearPolaKerjaCache() {
	polaKerjaCache.clear();
	polaKerjaInflight.clear();
	deptPolaCache.clear();
	deptPolaInflight.clear();
}

async function getDepartmentPolaDefault(divisi: string): Promise<string | null> {
	const key = divisi.trim().toLowerCase();
	if (!key) return null;
	const now = Date.now();
	const cached = deptPolaCache.get(key);
	if (cached && now - cached.at < POLA_CACHE_TTL_MS) return cached.value;
	const running = deptPolaInflight.get(key);
	if (running) return running;

	const pending = (async (): Promise<string | null> => {
		try {
			const dRes = await directusServerJson<{ data: { pola_kerja_default: string | null }[] }>(
				`/items/department?filter[nama_department][_eq]=${encodeURIComponent(divisi)}&fields=pola_kerja_default&limit=1`
			);
			const val = dRes?.data?.[0]?.pola_kerja_default ?? null;
			deptPolaCache.set(key, { at: Date.now(), value: val });
			return val;
		} catch {
			return null;
		}
	})().finally(() => {
		if (deptPolaInflight.get(key) === pending) deptPolaInflight.delete(key);
	});

	deptPolaInflight.set(key, pending);
	return pending;
}

export async function resolveKaryawanPolaKerja(
	karyawanId: number,
	known?: { polaKerja?: string | null; divisi?: string | null }
): Promise<PolaKerja> {
	const key = String(karyawanId);
	const now = Date.now();
	const cached = polaKerjaCache.get(key);
	if (cached && now - cached.at < POLA_CACHE_TTL_MS) return cached.value;

	const running = polaKerjaInflight.get(key);
	if (running) return running;

	const pending = (async (): Promise<PolaKerja> => {
		let karyawanPola: string | null;
		let karyawanDivisi: string | null;
		if (known && known.polaKerja !== undefined) {
			karyawanPola = known.polaKerja ?? null;
			karyawanDivisi = known.divisi ?? null;
		} else {
			const kRes = await directusServerJson<{ data: { pola_kerja: string | null; divisi: string | null } }>(
				`/items/karyawan/${karyawanId}?fields=pola_kerja,divisi`
			);
			karyawanPola = kRes?.data?.pola_kerja ?? null;
			karyawanDivisi = kRes?.data?.divisi ?? null;
		}

		let value: PolaKerja;
		if (karyawanPola) {
			value = resolvePolaKerja({ karyawanPolaKerja: karyawanPola });
		} else if (!karyawanDivisi) {
			value = resolvePolaKerja({});
		} else {
			const deptDefault = await getDepartmentPolaDefault(karyawanDivisi);
			value = resolvePolaKerja({
				karyawanPolaKerja: karyawanPola,
				departmentPolaKerjaDefault: deptDefault
			});
		}

		if (polaKerjaCache.size >= MAX_POLA_CACHE) {
			const oldest = polaKerjaCache.keys().next().value;
			if (oldest !== undefined) polaKerjaCache.delete(oldest);
		}
		polaKerjaCache.set(key, { at: Date.now(), value });
		return value;
	})().finally(() => {
		if (polaKerjaInflight.get(key) === pending) polaKerjaInflight.delete(key);
	});

	polaKerjaInflight.set(key, pending);
	return pending;
}
