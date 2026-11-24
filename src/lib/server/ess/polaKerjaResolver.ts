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

export function clearPolaKerjaCache() {
	polaKerjaCache.clear();
	polaKerjaInflight.clear();
}

export async function resolveKaryawanPolaKerja(karyawanId: number): Promise<PolaKerja> {
	const key = String(karyawanId);
	const now = Date.now();
	const cached = polaKerjaCache.get(key);
	if (cached && now - cached.at < POLA_CACHE_TTL_MS) return cached.value;

	const running = polaKerjaInflight.get(key);
	if (running) return running;

	const pending = (async (): Promise<PolaKerja> => {
		const kRes = await directusServerJson<{ data: { pola_kerja: string | null; divisi: string | null } }>(
			`/items/karyawan/${karyawanId}?fields=pola_kerja,divisi`
		);
		const karyawan = kRes?.data;
		let value: PolaKerja;
		if (karyawan?.pola_kerja) {
			value = resolvePolaKerja({ karyawanPolaKerja: karyawan.pola_kerja });
		} else if (!karyawan?.divisi) {
			value = resolvePolaKerja({});
		} else {
			try {
				const dRes = await directusServerJson<{ data: { pola_kerja_default: string | null }[] }>(
					`/items/department?filter[nama_department][_eq]=${encodeURIComponent(karyawan.divisi)}&fields=pola_kerja_default&limit=1`
				);
				const dept = dRes?.data?.[0];
				value = resolvePolaKerja({
					karyawanPolaKerja: karyawan?.pola_kerja,
					departmentPolaKerjaDefault: dept?.pola_kerja_default
				});
			} catch {
				value = resolvePolaKerja({ karyawanPolaKerja: karyawan?.pola_kerja });
			}
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
