// src/lib/server/ess/polaKerjaResolver.ts
// Wrapper server (I/O) untuk resolvePolaKerja() — ambil karyawan.pola_kerja, lalu bila kosong
// cocokkan karyawan.divisi ke department.nama_department untuk pola_kerja_default. karyawan
// TIDAK punya FK department_id asli (hanya kolom teks `divisi`) — pola pencocokan sama seperti
// erp-epi/src/lib/services/hrdEmployeeApi.js.

import { directusServerJson } from '$lib/server/directus';
import { resolvePolaKerja, type PolaKerja } from '$lib/utils/resolvePolaKerja';

export async function resolveKaryawanPolaKerja(karyawanId: number): Promise<PolaKerja> {
	const kRes = await directusServerJson<{ data: { pola_kerja: string | null; divisi: string | null } }>(
		`/items/karyawan/${karyawanId}?fields=pola_kerja,divisi`
	);
	const karyawan = kRes?.data;
	if (karyawan?.pola_kerja) {
		return resolvePolaKerja({ karyawanPolaKerja: karyawan.pola_kerja });
	}
	if (!karyawan?.divisi) return resolvePolaKerja({});

	try {
		const dRes = await directusServerJson<{ data: { pola_kerja_default: string | null }[] }>(
			`/items/department?filter[nama_department][_eq]=${encodeURIComponent(karyawan.divisi)}&fields=pola_kerja_default&limit=1`
		);
		const dept = dRes?.data?.[0];
		return resolvePolaKerja({ karyawanPolaKerja: karyawan?.pola_kerja, departmentPolaKerjaDefault: dept?.pola_kerja_default });
	} catch {
		return resolvePolaKerja({ karyawanPolaKerja: karyawan?.pola_kerja });
	}
}
