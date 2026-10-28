// src/lib/server/currentProjectResolver.ts
// §7B #3 (implementation_plan_panduan + video generator.md): "proyek aktif
// hari ini" untuk karyawan biasa (BUKAN Manpower Leader — itu sudah punya
// projectScope.ts sendiri). Karyawan ESS tidak punya field project_id
// langsung di absensi_harian; rantainya lewat lokasi absen:
//   absensi_harian.lokasi_absensi_id -> lokasi_absensi.proyek_id
// Fail-soft di tiap langkah: kalau belum absen hari ini, atau lokasi
// absennya tidak terhubung ke proyek manapun, hasilnya null (BUKAN error) —
// dipakai fitur non-kritis (tampil/tidaknya SOP proyek), bukan gerbang akses.

import { directusServerJson } from '$lib/server/directus';

function todayStr(): string {
	return new Date().toISOString().slice(0, 10);
}

export async function getCurrentProjectId(karyawanId: number): Promise<number | null> {
	try {
		const absensiRes = await directusServerJson<{ data: any[] }>(
			`/items/absensi_harian?filter[karyawan_id][_eq]=${karyawanId}&filter[tanggal][_eq]=${todayStr()}&fields=lokasi_absensi_id&limit=1`
		);
		const lokasiId = absensiRes?.data?.[0]?.lokasi_absensi_id;
		if (!lokasiId) return null;

		const lokasiRes = await directusServerJson<{ data: any }>(
			`/items/lokasi_absensi/${lokasiId}?fields=proyek_id`
		);
		const proyekId = lokasiRes?.data?.proyek_id;
		return proyekId ?? null;
	} catch {
		return null;
	}
}
