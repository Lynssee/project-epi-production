// src/lib/server/fleetCheckinGate.ts
// Peminjaman 09 §3.3 (keputusan Lead K5 = opsi A) — gate G7 "pengembalian site visit wajib punya check-in"
// HANYA berlaku bila booking punya proyek (project_id) ATAU kategorinya wajib proyek (wajib_project=true).
// Kunjungan tanpa proyek tidak punya jalur check-in (check-in hanya ke proyek/prospek/WO), jadi gate itu
// tadinya PASTI memblokir dan selalu butuh dispensasi. Ini PELONGGARAN (bukan gate baru); kasusnya tetap
// dicatat sebagai anomali `[TANPA_CHECKIN_NONPROYEK]` untuk rekonsiliasi.
//
// LOGIKA INI HARUS IDENTIK dengan sisi ERP (erp-epi fleetBookingApi.returnBooking) — ubah keduanya bersamaan.

import { directusServerJson } from '$lib/server/directus';

export interface GateBooking {
	project_id?: number | string | null;
	kategori_kunjungan?: string | null;
}

/** Apakah gate check-in G7 berlaku untuk booking site_visit ini. */
export async function checkinGateApplies(booking: GateBooking): Promise<boolean> {
	if (booking.project_id) return true;
	if (!booking.kategori_kunjungan) return false;
	try {
		const r = await directusServerJson<{ data: { wajib_project?: boolean | number }[] }>(
			`/items/fleet_visit_category?filter[kode][_eq]=${encodeURIComponent(String(booking.kategori_kunjungan))}&fields=wajib_project&limit=1`
		);
		return !!r?.data?.[0]?.wajib_project;
	} catch (e) {
		// Gagal membaca kategori → fail-safe ke perilaku lama (gate berlaku), tetapi DILOG (Aturan #1).
		console.error('[fleetCheckinGate] gagal membaca fleet_visit_category — gate G7 tetap berlaku:', e);
		return true;
	}
}

/** Sudah ada baris site_checkin untuk booking ini? */
export async function bookingHasCheckin(bookingId: string | number): Promise<boolean> {
	const f = encodeURIComponent(JSON.stringify({ booking_id: { _eq: String(bookingId) } }));
	const r = await directusServerJson<{ data: { id: string }[] }>(`/items/site_checkin?filter=${f}&fields=id&limit=1`).catch((e) => {
		console.error('[fleetCheckinGate] gagal cek site_checkin:', e);
		return { data: [] as { id: string }[] };
	});
	return !!r?.data?.length;
}
