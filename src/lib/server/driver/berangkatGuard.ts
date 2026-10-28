// src/lib/server/driver/berangkatGuard.ts
// SJH-15 — syarat server agar driver boleh "Berangkat" (membuat trip aktif, kendaraan "Dipinjam").
// "Terima tugas" boleh kapan saja; "Berangkat" hanya setelah SJ sah & lolos gerbang.

import { directusServerJson } from '$lib/server/directus';

export const BERANGKAT_SJ_FIELDS =
	'id,nomor_sj,status,print_count,approval_status,security_verified_at,track_stage,delegation_status,' +
	'vehicle_id,category,delivery_address,fleet_booking_id,fleet_trip_id,delegated_driver_id';

/** Bagian murni — mudah diuji. */
export function evaluateBerangkat(
	sj: { print_count?: any; approval_status?: string | null; security_verified_at?: string | null; vehicle_id?: any },
	butuhSatpam: boolean
): string[] {
	const blockers: string[] = [];
	if (!(Number(sj?.print_count) >= 1)) blockers.push('SJ belum dicetak resmi oleh admin logistik.');
	if (sj?.approval_status && !['disetujui', 'tidak_perlu'].includes(sj.approval_status)) blockers.push('SJ belum disetujui admin.');
	if (butuhSatpam && !sj?.security_verified_at) blockers.push('SJ belum diloloskan satpam di gerbang.');
	if (!sj?.vehicle_id) blockers.push('Kendaraan belum ditentukan. Hubungi admin Fleet.');
	return blockers;
}

/**
 * Kategori SJ butuh satpam? surat_jalan_category_config.requires_security_check lewat kode kategori
 * (query terpisah per relasi, Aturan #2). Gagal baca -> true (jangan longgarkan keamanan diam-diam),
 * dan dicatat keras.
 */
export async function sjButuhSatpam(categoryId: number | string | null | undefined): Promise<boolean> {
	if (categoryId == null || categoryId === '') return false;
	try {
		const cat = (await directusServerJson<{ data: any }>(`/items/stock_activity_types/${categoryId}?fields=code`))?.data;
		if (!cat?.code) return false;
		const cfg = (await directusServerJson<{ data: any[] }>(
			`/items/surat_jalan_category_config?filter[kode][_eq]=${encodeURIComponent(cat.code)}&fields=requires_security_check&limit=1`
		))?.data?.[0];
		return !!cfg?.requires_security_check;
	} catch (e) {
		console.error('[berangkatGuard] gagal baca konfigurasi kategori SJ, anggap butuh satpam:', e instanceof Error ? e.message : e);
		return true;
	}
}
