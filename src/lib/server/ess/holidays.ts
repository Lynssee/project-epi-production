// src/lib/server/ess/holidays.ts
// Deteksi hari libur nasional dari koleksi Directus `holidays` (sumber kebenaran tunggal,
// dipakai bersama oleh payroll admin — jangan buat koleksi terpisah untuk modul lembur).

import { directusServerJson } from '$lib/server/directus';

/**
 * Mengecek apakah tanggal (format YYYY-MM-DD) adalah hari libur nasional aktif.
 * Mengembalikan false bila tidak ditemukan ATAU bila koleksi holidays untuk tahun
 * tsb kosong (fallback aman: deteksi weekend saja tetap jalan di overtimeCalculator,
 * tidak melempar error di titik pengajuan lapangan).
 */
export async function isNationalHolidayOn(tanggal: string): Promise<boolean> {
	try {
		const query = new URLSearchParams({
			'filter[date][_eq]': tanggal,
			'filter[is_active][_eq]': 'true',
			fields: 'id',
			limit: '1'
		});
		const result = await directusServerJson<{ data: Array<{ id: number }> }>(
			`/items/holidays?${query.toString()}`
		);
		return !!result?.data?.length;
	} catch (e) {
		console.warn('[holidays] Gagal cek kalender libur, fallback ke deteksi weekend saja:', e);
		return false;
	}
}
